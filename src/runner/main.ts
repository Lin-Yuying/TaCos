/**
 * Runs Agent work on a member's own computer: asks the server for work, runs it through the same
 * harness adapters the desktop app uses, and sends the events back. All traffic is outbound, and
 * the model keys in this process never go to the server.
 */
import { acknowledgeEventBatch,archiveEventBatch,checkEventSpoolCapacity,recoverEventBatches,saveEventBatch } from "./event-spool";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSkill } from "@/lib/ai-constants";
import { codexDefaults, listCodexSkills, openCliStream, skillsInText } from "@/lib/cli-agents";
import { clearHarnessDetectCache, warmHarnessDetectCache } from "@/lib/harness/detect-bin";
import { readyWithKeys, signedInHarnesses } from "@/lib/harness/gate";
import { listComposerModels, resolveTurnModel, type ModelAccess } from "@/lib/harness/models";
import { codexSubscription } from "@/lib/harness/adapters/codex-subscription";
import { FIRST_CLASS_HARNESS_IDS, getHarnessAdapter, listHarnessDetect } from "@/lib/harness/registry";
import { attachTurnFiles, fileName, type TurnFile } from "@/lib/harness/turn-files";
import { turnTimer, writeTurnTiming, type TurnTimer } from "@/lib/harness/turn-timing";
import type { TurnEvent } from "@/lib/harness/types";
import { keysForHarness } from "@/lib/model-endpoint";
import type { ClaimedRun, EditPayload, RunnerCapabilities, TurnPayload } from "@/lib/runner/protocol";
import { readConfig } from "./keys";

const SERVER = (process.env.TACOS_RUNNER_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.TACOS_RUNNER_TOKEN ?? "";
const CAPABILITIES_MS = 30_000;
const RETRY_MS = 3_000;
const CONTROL_MS = 2_000;
const FLUSH_MS = 150;
const SEND_ATTEMPTS = 20;
const API_TIMEOUT_MS = 180_000;

const log = (message: string) => console.log(`[runner] ${message}`);

function serverFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SERVER}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...init.headers },
  });
}

function postJson(pathname: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return serverFetch(pathname, { method: "POST", body: JSON.stringify(body), signal });
}

function accessFor(harnessApis: ReturnType<typeof keysForHarness>): ModelAccess {
  return { endpoints: harnessApis?.endpoints ?? [], signedIn: signedInHarnesses() };
}

let cached: { at: number; value: RunnerCapabilities } | null = null;

async function capabilities(): Promise<RunnerCapabilities> {
  if (cached && Date.now() - cached.at < CAPABILITIES_MS) return cached.value;
  await warmHarnessDetectCache();
  const config = readConfig();
  const keyed = FIRST_CLASS_HARNESS_IDS.filter((id) => keysForHarness(config.endpoints, id));
  const harnesses = listHarnessDetect();
  const ready = harnesses.map((detect) => readyWithKeys(detect, keyed)).filter((d) => d.ready).map((d) => d.id);
  const value: RunnerCapabilities = {
    harnesses,
    keyed,
    models: await listComposerModels(ready, accessFor(keysForHarness(config.endpoints, "pi"))),
    skills: await listCodexSkills(),
    editModel: config.editProvider ? config.editModel : null,
    codexDefaults: codexDefaults(),
    subscriptions: { codex: await codexSubscription().catch(() => ({
      source: "none" as const,
      plan: null,
      windows: [],
      hint: "Run codex, then /status.",
      checkedAt: new Date().toISOString(),
    })) },
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Sends events in order, a batch at a time, so a turn's text arrives in step with the model. */
function eventSender(runId: string, abort: AbortController, clock: TurnTimer) {
  let pending:TurnEvent[]=[],bytes=0,sequence=0;
  let terminalFailure:Error|null=null;
  let sending:Promise<void>|null=null,timer:NodeJS.Timeout|null=null;
  const send=async(events:TurnEvent[])=>{
    const startedAt=Date.now(),batch=++sequence,body=JSON.stringify({server:SERVER,runId,sequence:batch,events});
    const spool=await saveEventBatch(runId,batch,body);
    const deadline=Date.now()+(abort.signal.aborted?5000:30000);
    for(let attempt=0;attempt<SEND_ATTEMPTS&&Date.now()<deadline;attempt++){
      if(attempt)clock.uploadRetry();
      try{
        const response=await serverFetch("/api/runner/events",{method:"POST",body,signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
        if(response.ok){const ack=await response.json() as {sequence?:number;cancelled?:boolean};
          if(ack.sequence!==undefined&&ack.sequence!==batch)throw new Error("Event acknowledgement mismatch");
          clock.upload(Date.now()-startedAt,Buffer.byteLength(body));
          if(ack.cancelled){await archiveEventBatch(spool);abort.abort();throw new Error(`Run cancelled. Events saved: ${spool}.gz`);}
          await acknowledgeEventBatch(spool);return;
        }
        if(response.status===401||response.status===403)break;
      }catch{/* keep the durable batch for recovery */}
      if(abort.signal.aborted)break;
      await new Promise(resolve=>setTimeout(resolve,Math.min(1000,Math.max(0,deadline-Date.now()))));
    }
    abort.abort();throw new Error(`The server did not acknowledge events. Saved: ${spool}`);
  };
  const flush=():Promise<void>=>{
    if(timer)clearTimeout(timer);timer=null;
    if(terminalFailure)return Promise.reject(terminalFailure);
    if(sending)return sending;
    if(!pending.length)return Promise.resolve();
    sending=(async()=>{while(pending.length){const batch=pending;pending=[];bytes=0;try{await send(batch);}catch(error){terminalFailure=error instanceof Error?error:new Error(String(error));if(pending.length){await saveEventBatch(runId,++sequence,JSON.stringify({server:SERVER,runId,sequence,events:pending}));pending=[];bytes=0;}throw terminalFailure;}}})().finally(()=>{sending=null;});
    return sending;
  };
  return {async push(event:TurnEvent){if(terminalFailure)throw terminalFailure;pending.push(event);bytes+=Buffer.byteLength(JSON.stringify(event));if(bytes>=256*1024||pending.length>=128||sending)await flush();else if(!timer)timer=setTimeout(()=>{void flush().catch(error=>{log(String(error));abort.abort();});},FLUSH_MS);},flush};
}

function watchCancel(runId: string, abort: AbortController): () => void {
  const stopped=new AbortController();let timer:ReturnType<typeof setTimeout>|null=null;
  const tick=async()=>{try{const response=await serverFetch(`/api/runner/control?runId=${encodeURIComponent(runId)}`,{signal:AbortSignal.any([stopped.signal,AbortSignal.timeout(8000)])});if(response.ok&&((await response.json()) as {cancelled?:boolean}).cancelled)abort.abort();}catch{/* next single flight retries */}finally{if(!stopped.signal.aborted)timer=setTimeout(tick,CONTROL_MS);}};
  timer=setTimeout(tick,CONTROL_MS);return()=>{stopped.abort();if(timer)clearTimeout(timer);};
}

// A folder name comes from the server, and it stays one folder under this person's agent folder.
function safeName(value: string, fallback: string): string {
  return /^[\w-]+$/.test(value) ? value : fallback;
}

function mcpShim(toolToken: string, timingFile: string) {
  return {
    command: process.execPath,
    args: [path.join(__dirname, "agent-mcp.mjs")],
    env: {
      TACOS_AGENT_URL: SERVER,
      TACOS_AGENT_TOKEN: toolToken,
      TACOS_TIMING_FILE: timingFile,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  };
}

async function fetchTurnFiles(payload: TurnPayload, dir: string, signal: AbortSignal): Promise<TurnFile[]> {
  const files: TurnFile[] = [];
  for (const attachment of payload.attachments ?? []) {
    const response = await serverFetch(`/api/runner/files/${encodeURIComponent(attachment.id)}`, { signal });
    if (!response.ok) throw new Error(`Could not fetch the attached file ${attachment.name}`);
    // Two files may share a name; the id keeps them apart.
    const folder = path.join(dir, safeName(attachment.id, "file"));
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, fileName(attachment.name, attachment.id));
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    files.push({ name: attachment.name, path: file });
  }
  return files;
}

async function* turnEvents(
  run: ClaimedRun,
  payload: TurnPayload,
  abort: AbortController,
  timingFile: string
): AsyncGenerator<TurnEvent> {
  const adapter = getHarnessAdapter(payload.harness);
  if (!adapter) throw new Error(`${payload.harness} is not available on this computer`);
  const config = readConfig();
  const cwd = path.join(
    os.homedir(),
    ".tacos",
    "agent",
    safeName(run.workspaceId, "workspace"),
    safeName(payload.projectId, "general")
  );
  // A missing cwd makes spawn report ENOENT for the binary, on every harness's first turn here.
  fs.mkdirSync(cwd, { recursive: true });
  const keys = keysForHarness(config.endpoints, payload.harness);
  const access = accessFor(keysForHarness(config.endpoints, "pi"));
  const turnModel = await resolveTurnModel(payload.harness, payload.model, payload.effort, access);
  let skills: AgentSkill[] = [];
  if (payload.harness === "codex" && payload.message.includes("@")) {
    skills = skillsInText(payload.message, await listCodexSkills());
  }
  const defaults = payload.harness === "codex" ? codexDefaults() : { model: "", effort: "" };
  let turnApproved = false;

  const fileDir = path.join(os.tmpdir(), `tacos-attached-${safeName(run.id, "run")}`);
  try {
  const attached = attachTurnFiles(payload.harness, payload.prompt, await fetchTurnFiles(payload, fileDir, abort.signal));
  yield* adapter.openTurn({
    sessionId: payload.threadId,
    cwd,
    prompt: attached.prompt,
    images: attached.images,
    model: turnModel.model || defaults.model || null,
    effort: turnModel.effort || defaults.effort || null,
    approval: payload.approval,
    skills: skills.length > 0 ? skills : undefined,
    autoApproveTools: payload.autoApproveTools,
    neverAutoApproveTools: payload.neverAutoApproveTools,
    isTurnApproved: () => turnApproved || payload.approval !== "ask",
    waitForApproval: async (request) => {
      while (!abort.signal.aborted) {
        const response = await postJson(
          "/api/runner/approval",
          { runId: run.id, requestId: request.requestId },
          abort.signal
        ).catch(() => null);
        if (!response?.ok) return "deny";
        const answer = (await response.json()) as { pending?: boolean; decision?: string; turnApproved?: boolean };
        if (answer.pending) continue;
        turnApproved = Boolean(answer.turnApproved);
        return answer.decision === "accept" ? "allow" : "deny";
      }
      return "deny";
    },
    signal: abort.signal,
    proxy: config.proxy || payload.proxy,
    keys,
    timeoutMs: payload.timeoutMs,
    nativeSessionId: payload.nativeSessionId ?? null,
    mcp: run.toolToken ? mcpShim(run.toolToken, timingFile) : null,
  });
  } finally {
    fs.rmSync(fileDir, { recursive: true, force: true });
  }
}

async function* sseDeltas(stream: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let frame: { choices?: { delta?: { content?: unknown } }[]; error?: { message?: unknown } };
      try {
        frame = JSON.parse(data) as typeof frame;
      } catch {
        continue;
      }
      if (typeof frame.error?.message === "string") {
        yield { type: "error", message: frame.error.message };
        return;
      }
      const delta = frame.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield { type: "delta", text: delta };
    }
  }
}

async function* editEvents(payload: EditPayload, abort: AbortController): AsyncGenerator<TurnEvent> {
  const config = readConfig();
  if (payload.engine !== "api") {
    const proxy = config.proxy || payload.proxy;
    yield* sseDeltas(openCliStream(payload.engine, payload.prompt, { proxy, signal: abort.signal }));
    return;
  }
  const api = config.endpoints.find((endpoint) => endpoint.id === config.editProvider);
  if (!api) {
    yield { type: "error", message: "Add your API key in Settings → Model API." };
    return;
  }
  const response = await fetch(`${api.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({
      model: config.editModel,
      messages: payload.messages,
      stream: true,
      temperature: payload.temperature ?? 0.4,
      max_tokens: payload.maxTokens ?? 2_500,
      ...(payload.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    // A redirect must not carry the key to an address nobody typed.
    redirect: "error",
  });
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
    yield { type: "error", message: `AI provider error (${response.status}) ${detail}`.trim() };
    return;
  }
  yield* sseDeltas(response.body);
}

async function execute(run: ClaimedRun): Promise<void> {
  const abort = new AbortController();
  const timer = turnTimer();
  const timingFile = path.join(os.tmpdir(), `tacos-tool-timing-${safeName(run.id, "run")}.jsonl`);
  const sender = eventSender(run.id, abort, timer);
  const stopWatching = watchCancel(run.id, abort);
  log(`run ${run.id}: ${run.payload.kind} started`);
  try {
    const events =
      run.payload.kind === "turn"
        ? turnEvents(run, run.payload, abort, timingFile)
        : run.payload.kind === "edit"
          ? editEvents(run.payload, abort)
          : (async function* () {
              // A delegation payload is replaced by beginDelegation before it reaches a runner.
              yield { type: "error" as const, message: "This delegated run was not prepared on the server." };
            })();
    for await (const event of events) {
      timer.event(event);
      await sender.push(event);
      if (event.type === "error" || event.type === "done") break;
    }
    await sender.push({ type: "done" });
  } catch (err) {
    await sender.push({ type: "error", message: err instanceof Error ? err.message : "The run failed on this computer." });
  } finally {
    stopWatching();
    await sender.flush();
    const harness = run.payload.kind === "turn" ? run.payload.harness : "";
    log(`run ${run.id}: finished ${JSON.stringify(writeTurnTiming(run.id, run.payload.kind, harness, timer, timingFile))}`);
  }
}

// Changing a key should show up now, not after the poll in progress runs out.
let pollAbort: AbortController | null = null;

function refresh(): void {
  cached = null;
  clearHarnessDetectCache();
  pollAbort?.abort();
}

const MAX_RUNS=Math.max(1,Math.min(8,Math.floor(Number(process.env.TACOS_RUNNER_SLOTS)||2)));
const activeRuns=new Set<Promise<void>>();
async function pollLoop(): Promise<never> {
  while (true) {
    try {
      await checkEventSpoolCapacity();
      if(activeRuns.size>=MAX_RUNS){await Promise.race(activeRuns);continue;}
      pollAbort = new AbortController();
      const response = await postJson("/api/runner/poll", { capabilities: await capabilities(),slots:MAX_RUNS }, pollAbort.signal);
      if (response.status === 401) {
        log("the server no longer accepts this token");
        process.exit(3);
      }
      if (!response.ok) throw new Error(`poll answered ${response.status}`);
      const { run } = (await response.json()) as { run: ClaimedRun | null };
      if(run){const work=execute(run).catch(error=>log(String(error))).finally(()=>activeRuns.delete(work));activeRuns.add(work);}
    } catch (err) {
      if (!pollAbort?.signal.aborted) {
        log(err instanceof Error ? err.message : "poll failed");
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
  }
}

if (!SERVER || !TOKEN) {
  log("TACOS_RUNNER_URL and TACOS_RUNNER_TOKEN are required");
  process.exit(2);
}

const parentPort = (process as unknown as { parentPort?: { on(event: "message", listener: (message: { data: unknown }) => void): void } }).parentPort;
parentPort?.on("message", ({ data }) => {
  if (data === "refresh") refresh();
});
process.on("SIGUSR1", refresh);

void recoverEventBatches(SERVER,async body=>{const response=await serverFetch("/api/runner/events",{method:"POST",body,signal:AbortSignal.timeout(8000)});return response.ok?{ok:true,...await response.json()}:{ok:false};}).catch(error=>log(String(error))).finally(()=>void pollLoop());
