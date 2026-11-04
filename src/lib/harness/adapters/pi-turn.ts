/**
 * Pi coding-agent turn (H-P4-21).
 * Mounts the TaCos MCP shim. Write cards are mediated in /api/agent/tools (no Pi elicitation).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import { thinkingStep } from "../thinking";
import { ownEndpoint, type OwnEndpoint } from "../own-endpoint";
import type { TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";

const TURN_TIMEOUT_MS = 300_000;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function buildEnv(
  proxy: string | undefined,
  agentDir: string,
  mcpEnv: Record<string, string>,
  keys?: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...keys, PI_CODING_AGENT_DIR: agentDir, ...mcpEnv };
  if (proxy) {
    for (const key of PROXY_KEYS) env[key] = proxy;
  }
  return env;
}

function writeMcpConfig(
  agentDir: string,
  mcp: NonNullable<TurnInput["mcp"]>
): void {
  fs.mkdirSync(agentDir, { recursive: true });
  const config = {
    mcpServers: {
      tacos: {
        command: mcp.command,
        args: mcp.args,
        env: mcp.env ?? {},
        exposure: "direct",
        description: "TaCos project tools for this Agent turn.",
      },
    },
  };
  fs.writeFileSync(path.join(agentDir, "mcp.json"), `${JSON.stringify(config, null, 2)}\n`);
}

// A turn runs on its own agent dir so its MCP config stays out of the user's, but Pi reads
// sign-ins and models from that dir too. It gets only the viewer's own API: this machine's
// login must not answer and bill instead.
function writeOwnModels(agentDir: string, own: OwnEndpoint | null): void {
  const target = path.join(agentDir, "models.json");
  fs.rmSync(/* turbopackIgnore: true */ path.join(agentDir, "auth.json"), { force: true });
  fs.rmSync(/* turbopackIgnore: true */ target, { force: true });
  if (!own) return;
  // Names the variable, never the key: Pi reads the value from this turn's environment.
  const provider = {
    baseUrl: own.endpoint.baseUrl,
    api: "openai-completions",
    apiKey: `$${own.endpoint.envVar}`,
    models: own.endpoint.models.map((id) => ({ id })),
  };
  fs.writeFileSync(target, `${JSON.stringify({ providers: { [own.endpoint.id]: provider } }, null, 2)}\n`);
}

/** The raw text stays in the turn log; it can quote part of the key. */
export function explainPiError(message: string): string {
  if (/^401\b|authentication fails|invalid.*api key|api key.*invalid|unauthorized/i.test(message)) {
    return "The provider rejected the API key for this model. Replace it in Settings → Model API, or pick another model.";
  }
  return message;
}

export async function* openPiTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = findHarnessBinary("pi");
  if (!binary) {
    yield { type: "error", message: "Pi is not installed on this machine." };
    yield { type: "done" };
    return;
  }

  const agentDir = path.join(input.cwd, ".tacos-pi-agent");
  if (input.mcp) {
    writeMcpConfig(agentDir, input.mcp);
  } else {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "mcp.json"), `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
  }
  const own = ownEndpoint(input);
  writeOwnModels(agentDir, own);

  const args = [
    "--print",
    "--mode",
    "json",
    "--no-session",
    "--no-builtin-tools",
    "--system-prompt",
    input.prompt.system,
    input.prompt.body,
  ];
  // Pi's ids are provider/model, and the model part may itself contain a slash.
  if (input.model) {
    const slash = input.model.indexOf("/");
    if (slash > 0) args.unshift("--provider", input.model.slice(0, slash), "--model", input.model.slice(slash + 1));
    else args.unshift("--model", input.model);
  }
  if (input.effort) {
    args.unshift("--thinking", input.effort);
  }

  const queue: TurnEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (event: TurnEvent) => {
    queue.push(event);
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
    // tools/route also waits on this requestId. answerAgentApproval notifies every waiter.
    void waitForAgentApproval(card.requestId, { signal: input.signal }).then((raw) => {
      const decision = raw === "accept" ? "allow" : "deny";
      push({ type: "approval_done", requestId: card.requestId, decision });
    });
  });

  let child: ChildProcess | null = null;
  let finished = false;
  let stderr = "";
  let turnError: string | null = null;
  let thinkingCount = 0;

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
      env: buildEnv(input.proxy, agentDir, input.mcp?.env ?? {}, own ? { [own.endpoint.envVar]: own.key } : undefined),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    finish(err instanceof Error ? err.message : "Could not start Pi.");
  }

  const timer = setTimeout(() => finish("Pi took longer than five minutes."), TURN_TIMEOUT_MS);

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
    finish("Pi did not provide a stream.");
  }

  if (child?.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      log?.write(chunk);
    });
  }

  child?.on("error", (err) => finish(`Could not start Pi: ${err.message}`));
  child?.on("exit", (code) => {
    if (!finished) {
      const detail = stderr.trim()
        ? stderr.trim().split("\n").slice(-3).join(" ")
        : `Pi exited with code ${code ?? "unknown"}.`;
      finish(detail);
    }
  });

  function handleLine(line: string) {
    let message: {
      type?: string;
      assistantMessageEvent?: { type?: string; delta?: unknown };
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
      aborted?: boolean;
      message?: {
        role?: string;
        stopReason?: string;
        errorMessage?: string;
        content?: unknown;
      };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.type === "message_update" && message.assistantMessageEvent?.type === "text_delta") {
      const delta = message.assistantMessageEvent.delta;
      if (typeof delta === "string" && delta) push({ type: "delta", text: delta });
      return;
    }
    if (message.type === "tool_execution_start") {
      push({
        type: "step",
        id: String(message.toolCallId ?? message.toolName ?? "tool"),
        kind: "tool",
        title: String(message.toolName ?? "tool"),
        status: "running",
      });
      return;
    }
    if (message.type === "tool_execution_end") {
      push({
        type: "step",
        id: String(message.toolCallId ?? message.toolName ?? "tool"),
        kind: "tool",
        title: String(message.toolName ?? "tool"),
        status: message.isError ? "error" : "done",
      });
      return;
    }
    if (message.type === "message_end" && message.message?.role === "assistant") {
      const blocks = Array.isArray(message.message.content) ? message.message.content : [];
      for (const block of blocks as { type?: string; thinking?: unknown }[]) {
        if (block.type !== "thinking" || typeof block.thinking !== "string") continue;
        const step = thinkingStep(`thinking-${++thinkingCount}`, block.thinking);
        if (step) push(step);
      }
      return;
    }
    // Pi retries by itself, so only the last turn's outcome counts. It still settles normally
    // after giving up; without this a dead provider reads as an empty reply.
    if (message.type === "turn_end") {
      const ended = message.message;
      turnError = ended?.stopReason === "error" ? ended.errorMessage || "Pi reported an error." : null;
      return;
    }
    if (message.type === "agent_settled") {
      clearTimeout(timer);
      finish(turnError ? explainPiError(turnError) : undefined);
    }
  }

  input.signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      finish("The turn was cancelled.");
    },
    { once: true }
  );
  if (input.signal?.aborted) {
    clearTimeout(timer);
    finish("The turn was cancelled.");
  }

  while (true) {
    while (queue.length > 0) {
      const event = queue.shift()!;
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
}

