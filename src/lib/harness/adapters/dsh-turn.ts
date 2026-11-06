/**
 * DeepSeek Harness (dsh) turn (H-P4-24).
 * Runs `dsh --profile headless --json` with a TaCos patch overlay.
 * The overlay disables dsh builtin tools and inserts the TaCos MCP server
 * through @deepseek-ai/dsh-mcp-client. Write cards are mediated in /api/agent/tools.
 * The DeepSeek key comes from the viewer's Model API settings, else from dsh's own store.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import type { TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";

const TURN_TIMEOUT_MS = 300_000;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

/** dsh headless builtin tools. TaCos disables all of them; the model uses TaCos MCP only. */
export const DSH_BUILTIN_TOOL_IDS = [
  "tool-working-directory",
  "tool-bash",
  "tool-pwsh",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search",
  "tool-skill",
  "tool-subagent-control",
  "tool-subagent-list-agents",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-workflow",
  "tool-web",
] as const;

function buildEnv(
  proxy: string | undefined,
  approval: TurnInput["approval"],
  keys?: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...keys };
  if (proxy) {
    for (const key of PROXY_KEYS) env[key] = proxy;
  }
  // Builtins are off. TaCos mediates MCP writes, so dsh itself stays read-only.
  void approval;
  env.DSH_PERMISSION_MODE = "read-only";
  return env;
}

const q = (value: string) => JSON.stringify(value);

export function buildDshPatch(
  mcp: TurnInput["mcp"],
  selection?: { model: string | null; effort?: string | null },
  emptyStore?: string
): string {
  const lines: string[] = [];
  // dsh documents its own store as beating the environment. Pointing the store somewhere empty
  // keeps a key saved on this machine from answering, and billing, instead of the viewer's.
  if (emptyStore) lines.push("- id: credentials", "  config:", `    path: ${q(emptyStore)}`);
  // headless has no model flag; a session starts on the default-model service's selection.
  if (selection?.model) {
    lines.push(
      "- id: agent-default-model",
      "  config:",
      "    provider: deepseek-official",
      `    model: ${q(selection.model)}`
    );
    if (selection.effort) lines.push(`    reasoningEffort: ${q(selection.effort)}`);
  }
  for (const id of DSH_BUILTIN_TOOL_IDS) {
    lines.push(`- id: ${id}`, "  disabled: true");
  }
  if (mcp) {
    lines.push(
      "- insert:",
      "    - id: mcp-tacos",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      "      config:",
      "        serverName: tacos",
      "        transport: stdio",
      `        command: ${q(mcp.command)}`,
      `        args: [${mcp.args.map(q).join(", ")}]`,
      "        toolCallTimeoutMs: 300000",
      "        env:"
    );
    const env = mcp.env ?? {};
    const keys = Object.keys(env);
    if (keys.length === 0) lines[lines.length - 1] = "        env: {}";
    for (const key of keys) lines.push(`          ${key}: ${q(env[key])}`);
  }
  return `${lines.join("\n")}\n`;
}

function writePatch(cwd: string, input: TurnInput): string {
  const dir = path.join(cwd, ".tacos-dsh");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "patch.yml");
  fs.writeFileSync(file, buildDshPatch(input.mcp ?? null, input, input.keys ? path.join(dir, "no-stored-keys.yaml") : undefined));
  return file;
}

function messageText(input: TurnInput): string {
  const system = input.prompt.system?.trim() ?? "";
  const body = input.prompt.body?.trim() ?? "";
  if (system && body) return `${system}\n\n${body}`;
  return body || system || "Hello";
}

function errorText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as { message?: unknown; error?: unknown };
    return errorText(v.message) ?? errorText(v.error);
  }
  return null;
}

// dsh only reveals a missing key when a turn fails, and a key listed in its credentials file can
// still be refused. So a failure is remembered until that file changes; only its time is read.
const keyMissingAt = globalThis as unknown as { __tacosDshKeyMissingAt?: number };

function credentialsChangedAt(): number {
  try {
    return fs.statSync(path.join(os.homedir(), ".dsh", ".credentials.yaml")).mtimeMs;
  } catch {
    return 0;
  }
}

function noteDshKeyMissing(): void {
  keyMissingAt.__tacosDshKeyMissingAt = credentialsChangedAt();
}

export function dshKeyMissing(): boolean {
  if (process.env.DEEPSEEK_API_KEY) return false;
  return keyMissingAt.__tacosDshKeyMissingAt === credentialsChangedAt();
}

/** Make dsh credential errors diagnosable. */
export function explainDshError(message: string): string {
  if (/MISSING_CREDENTIAL|no API key/i.test(message)) {
    noteDshKeyMissing();
    return "DeepSeek Harness has no API key. Add your DeepSeek key in Settings → Model API.";
  }
  // The raw text quotes the end of the key; it stays in the turn log.
  if (/\bAUTH\b|authentication fails|invalid.*api key/i.test(message)) {
    return "DeepSeek rejected this API key. Replace it in Settings → Model API.";
  }
  if (/TRANSPORT/.test(message)) {
    return "DeepSeek Harness could not get an answer from DeepSeek. Check your key in Settings → Model API, and this machine's network.";
  }
  return message;
}

export async function* openDshTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = findHarnessBinary("dsh");
  if (!binary) {
    yield { type: "error", message: "DeepSeek Harness (dsh) is not installed on this machine." };
    yield { type: "done" };
    return;
  }

  const patchFile = writePatch(input.cwd, input);
  const args = ["--profile", "headless", "--patch", patchFile, "--json"];
  // #79: prefer the saved dsh session; the TaCos thread id only matches for old rows.
  const nativeSession = input.nativeSessionId ?? (/^session-/.test(input.sessionId) ? input.sessionId : null);
  if (nativeSession) {
    args.push("--session-id", nativeSession);
  }
  args.push("-");
  const promptText = messageText(input);

  const queue: TurnEvent[] = [];
  let queuedBytes=0;
  let wake: (() => void) | null = null;
  const push = (event: TurnEvent) => {
    queue.push(event);queuedBytes+=Buffer.byteLength(JSON.stringify(event));
    if(queuedBytes>=1024*1024)child?.stdout?.pause();
    wake?.();
  };

  const unsubscribe = subscribeToolApprovals(input.sessionId, (card) => {
    push({
      type: "approval",
      requestId: card.requestId,
      tool: card.tool,
      message: card.message,
      description: card.description,
      params: card.params,
    });
    void waitForAgentApproval(card.requestId, { signal: input.signal }).then((raw) => {
      const decision = raw === "accept" ? "allow" : "deny";
      push({ type: "approval_done", requestId: card.requestId, decision });
    });
  });

  let child: ChildProcess | null = null;
  let finished = false;
  let stderr = "";
  let announcedSession = input.nativeSessionId ?? "";

  const finish = (error?: string) => {
    if (finished) return;
    finished = true;
    unsubscribe();
    if (error) push({ type: "error", message: error });
    push({ type: "done" });
    child?.kill();
    wake?.();
  };

  try {
    child = spawn(binary, args, {
      cwd: input.cwd,
      env: buildEnv(input.proxy, input.approval, input.keys?.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    finish(err instanceof Error ? err.message : "Could not start DeepSeek Harness.");
  }

  child?.stdin?.end(promptText);

  const timer = setTimeout(() => finish("DeepSeek Harness took longer than its time limit."), input.timeoutMs ?? TURN_TIMEOUT_MS);

  if (child?.stdout) {
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) handleLine(line);
        if (finished) return;
        index = buffer.indexOf("\n");
      }
    });
  } else if (child) {
    finish("DeepSeek Harness did not provide a stream.");
  }

  if (child?.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      if(log){child?.stderr?.pause();void log?.write(chunk).finally(()=>child?.stderr?.resume());}
    });
  }

  child?.on("error", (err) => finish(`Could not start DeepSeek Harness: ${err.message}`));
  child?.on("exit", (code) => {
    if (!finished) {
      const detail = stderr.trim()
        ? stderr.trim().split("\n").slice(-3).join(" ")
        : `DeepSeek Harness exited with code ${code ?? "unknown"}.`;
      finish(code === 0 ? undefined : explainDshError(detail));
    }
  });

  let sawText = false;
  let turnError: string | null = null;

  function handleLine(line: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const type = String(message.type ?? "");
    // #79: dsh names its session in some events; save it so the next turn resumes.
    const sessionCandidate =
      (typeof message.session_id === "string" && message.session_id) ||
      (typeof message.sessionId === "string" && message.sessionId) ||
      (typeof (message.session as { id?: unknown } | undefined)?.id === "string"
        ? ((message.session as { id: string }).id)
        : "");
    if (sessionCandidate && sessionCandidate !== announcedSession) {
      announcedSession = sessionCandidate;
      push({ type: "session", id: sessionCandidate });
    }

    if (type === "delta" || type === "text" || type === "text_delta" || type === "assistant_delta") {
      const text = typeof message.text === "string" ? message.text : typeof message.delta === "string" ? message.delta : "";
      if (text) {
        sawText = true;
        push({ type: "delta", text });
      }
      return;
    }

    if (type === "tool_call" || type === "tool_start" || type === "tool_use") {
      const name = String(message.name ?? message.tool ?? "tool");
      push({ type: "step", id: String(message.id ?? message.callId ?? name), kind: "tool", title: name, status: "running" });
      return;
    }

    if (type === "tool_result" || type === "tool_end") {
      const name = String(message.name ?? message.tool ?? "tool");
      push({
        type: "step",
        id: String(message.id ?? message.callId ?? name),
        kind: "tool",
        title: name,
        status: message.isError || message.is_error || message.error ? "error" : "done",
      });
      return;
    }

    if (type === "status" && message.phase === "turn_end") {
      const reason = message.reason as { kind?: string; error?: unknown } | undefined;
      if (reason?.kind === "error") turnError = errorText(reason.error) ?? "DeepSeek Harness reported an error.";
      return;
    }

    if (type === "final") {
      clearTimeout(timer);
      const text = typeof message.text === "string" ? message.text : "";
      if (text && !sawText) push({ type: "delta", text });
      finish(turnError ? explainDshError(turnError) : undefined);
      return;
    }

    if (type === "error") {
      finish(explainDshError(errorText(message) ?? "DeepSeek Harness reported an error."));
    }
  }

  const onAbort=()=>{clearTimeout(timer);finish("The turn was cancelled.");};
  input.signal?.addEventListener("abort",onAbort,{once:true});
  if (input.signal?.aborted) {
    clearTimeout(timer);
    finish("The turn was cancelled.");
  }

  try {
  while (true) {
    while (queue.length > 0) {
      const event = queue.shift()!;queuedBytes-=Buffer.byteLength(JSON.stringify(event));if(queuedBytes<256*1024)child?.stdout?.resume();
      yield event;
      if (event.type === "done" || event.type === "error") {
        clearTimeout(timer);
        unsubscribe();
        child?.kill();
        return;
      }
    }
    if (finished && queue.length === 0) {
      clearTimeout(timer);
      unsubscribe();
      return;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
  }
  } finally {clearTimeout(timer);unsubscribe();input.signal?.removeEventListener("abort",onAbort);child?.kill();queue.length=0;}

}
