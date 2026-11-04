/**
 * Runs Agent work on a member's own computer: asks the server for work, runs it through the same
 * harness adapters the desktop app uses, and sends the events back. All traffic is outbound, and
 * the model keys in this process never go to the server.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSkill } from "@/lib/ai-constants";
import { codexDefaults, listCodexSkills, openCliStream, skillsInText } from "@/lib/cli-agents";
import { clearHarnessDetectCache } from "@/lib/harness/detect-bin";
import { readyWithKeys, signedInHarnesses } from "@/lib/harness/gate";
import { listComposerModels, resolveTurnModel, type ModelAccess } from "@/lib/harness/models";
import { FIRST_CLASS_HARNESS_IDS, getHarnessAdapter, listHarnessDetect } from "@/lib/harness/registry";
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
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Sends events in order, a batch at a time, so a turn's text arrives in step with the model. */
function eventSender(runId: string, abort: AbortController) {
  let pending: TurnEvent[] = [];
  let sending: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;

  const send = async (events: TurnEvent[]) => {
    for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
      try {
        const response = await postJson("/api/runner/events", { runId, events });
        if (response.ok) {
          if (((await response.json()) as { cancelled?: boolean }).cancelled) abort.abort();
          return;
        }
        if (response.status === 401 || response.status === 403) break;
      } catch {
        /* the tunnel is reconnecting */
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    log(`run ${runId}: the server stopped taking events`);
    abort.abort();
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pending.length === 0) return sending;
    const batch = pending;
    pending = [];
    sending = sending.then(() => send(batch));
    return sending;
  };

  return {
    push(event: TurnEvent) {
      pending.push(event);
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    flush,
  };
}

function watchCancel(runId: string, abort: AbortController): () => void {
  const timer = setInterval(() => {
    void serverFetch(`/api/runner/control?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => {
        if (response.ok && ((await response.json()) as { cancelled?: boolean }).cancelled) abort.abort();
      })
      .catch(() => {});
  }, CONTROL_MS);
  return () => clearInterval(timer);
}

// A folder name comes from the server, and it stays one folder under this person's agent folder.
function safeName(value: string, fallback: string): string {
  return /^[\w-]+$/.test(value) ? value : fallback;
}

function mcpShim(toolToken: string) {
  return {
    command: process.execPath,
    args: [path.join(__dirname, "agent-mcp.mjs")],
    env: {
      TACOS_AGENT_URL: SERVER,
      TACOS_AGENT_TOKEN: toolToken,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
  };
}

async function* turnEvents(run: ClaimedRun, payload: TurnPayload, abort: AbortController): AsyncGenerator<TurnEvent> {
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

  yield* adapter.openTurn({
    sessionId: payload.threadId,
    cwd,
    prompt: payload.prompt,
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
    mcp: run.toolToken ? mcpShim(run.toolToken) : null,
  });
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
  const sender = eventSender(run.id, abort);
  const stopWatching = watchCancel(run.id, abort);
  log(`run ${run.id}: ${run.payload.kind} started`);
  try {
    const events = run.payload.kind === "turn" ? turnEvents(run, run.payload, abort) : editEvents(run.payload, abort);
    for await (const event of events) {
      sender.push(event);
      if (event.type === "error" || event.type === "done") break;
    }
    sender.push({ type: "done" });
  } catch (err) {
    sender.push({ type: "error", message: err instanceof Error ? err.message : "The run failed on this computer." });
  } finally {
    stopWatching();
    await sender.flush();
    log(`run ${run.id}: finished`);
  }
}

// Changing a key should show up now, not after the poll in progress runs out.
let pollAbort: AbortController | null = null;

function refresh(): void {
  cached = null;
  clearHarnessDetectCache();
  pollAbort?.abort();
}

async function pollLoop(): Promise<never> {
  while (true) {
    try {
      pollAbort = new AbortController();
      const response = await postJson("/api/runner/poll", { capabilities: await capabilities() }, pollAbort.signal);
      if (response.status === 401) {
        log("the server no longer accepts this token");
        process.exit(3);
      }
      if (!response.ok) throw new Error(`poll answered ${response.status}`);
      const { run } = (await response.json()) as { run: ClaimedRun | null };
      if (run) void execute(run);
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

void pollLoop();
