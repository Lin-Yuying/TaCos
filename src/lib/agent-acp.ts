import { spawn, type ChildProcess } from "node:child_process";
import type { ApprovalRequest, TurnEvent, TurnInput } from "@/lib/harness/types";
import type { TurnLog } from "@/lib/harness/turn-log";

// #79: one adapter for agents that speak the Agent Client Protocol (JSON-RPC over stdio).
// It maps ACP sessions and permission requests onto the same TurnEvent and approval cards
// the five hand-written harnesses use, so the Agent tab does not need a new path.

const TURN_TIMEOUT_MS = 300_000;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};
type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
  params?: Record<string, unknown>;
};

function acpMcpServers(input: TurnInput): Record<string, unknown>[] {
  if (!input.mcp) return [];
  return [
    {
      type: "stdio",
      name: "tacos",
      command: input.mcp.command,
      args: input.mcp.args,
      env: Object.entries(input.mcp.env ?? {}).map(([name, value]) => ({ name, value })),
    },
  ];
}

function promptText(input: TurnInput): string {
  const system = input.prompt.system?.trim() ?? "";
  const body = input.prompt.body?.trim() ?? "";
  return system && body ? `${system}\n\n${body}` : body || system;
}

function permissionOption(options: unknown): { allow: string | null; deny: string | null } {
  const list = Array.isArray(options) ? options : [];
  let allow: string | null = null;
  let deny: string | null = null;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const option = raw as { optionId?: unknown; name?: unknown; kind?: unknown };
    const id = typeof option.optionId === "string" ? option.optionId : "";
    if (!id) continue;
    const text = `${String(option.kind ?? "")} ${String(option.name ?? "")}`.toLowerCase();
    if (!allow && /allow|approve|accept|proceed|yes/.test(text)) allow = id;
    if (!deny && /reject|deny|decline|cancel|no/.test(text)) deny = id;
  }
  return { allow, deny };
}

export async function* openAcpTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = (process.env.TACOS_ACP_BIN ?? "").trim();
  if (!binary) {
    yield { type: "error", message: "No ACP agent is configured. Set TACOS_ACP_BIN to an ACP-compatible command." };
    yield { type: "done" };
    return;
  }

  const queue: TurnEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: string | null = null;
  let child: ChildProcess | null = null;
  let stderr = "";
  let sessionId = "";

  const push = (event: TurnEvent) => {
    queue.push(event);
    wake?.();
  };
  const finish = (error?: string) => {
    if (finished) return;
    finished = true;
    if (error) failure = error;
    wake?.();
  };

  try {
    child = spawn(binary, [], {
      cwd: input.cwd,
      env: { ...process.env, ...(input.mcp?.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : "Could not start the ACP agent." };
    yield { type: "done" };
    return;
  }

  const send = (message: unknown) => {
    try {
      child?.stdin?.write(`${JSON.stringify(message)}\n`);
    } catch {
      /* already closed */
    }
  };

  const request = (id: number, method: string, params?: Record<string, unknown>) => {
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
    send(message);
  };

  const timer = setTimeout(() => finish("The ACP agent took longer than its time limit."), input.timeoutMs ?? TURN_TIMEOUT_MS);
  const onAbort = () => {
    if (sessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    finish("The turn was cancelled.");
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) handle(line);
        if (finished && queue.length === 0) break;
        index = buffer.indexOf("\n");
      }
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      if (log) {
        child?.stderr?.pause();
        void log.write(chunk).finally(() => child?.stderr?.resume());
      }
    });
  }
  child.on("error", (err) => finish(err.message));
  child.on("exit", (code) => {
    if (!finished) finish(stderr.trim() ? stderr.trim().split("\n").slice(-3).join(" ") : `ACP agent exited with code ${code ?? "unknown"}.`);
  });

  const answerPermission = (id: number | string, params: Record<string, unknown>) => {
    const toolCall = (params.toolCall ?? {}) as { title?: string; toolCallId?: string; kind?: string };
    const requestId = `approval-${input.sessionId}-${String(toolCall.toolCallId ?? id)}`;
    const options = permissionOption(params.options);
    const card: ApprovalRequest = {
      requestId,
      tool: toolCall.kind ? `acp.${toolCall.kind}` : "acp.tool",
      message: toolCall.title ? `Allow ${toolCall.title}?` : "Allow this agent action?",
      params: params.toolCall,
    };
    const waiting = input.waitForApproval(card);
    push({
      type: "approval",
      requestId: card.requestId,
      tool: card.tool,
      message: card.message,
      description: card.description,
      params: card.params,
    });
    void waiting.then((decision) => {
      if (finished) return;
      const allow = decision === "allow" || decision === "allow_turn";
      const optionId = allow ? options.allow : options.deny;
      if (optionId) {
        send({ jsonrpc: "2.0", id, result: { outcome: { outcome: "selected", optionId } } });
      } else {
        send({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } });
      }
      push({ type: "approval_done", requestId, decision });
    });
  };

  const handle = (line: string) => {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    // The agent asks the client for permission.
    if (message.method === "session/request_permission" && message.id !== undefined && message.id !== null) {
      answerPermission(message.id, message.params ?? {});
      return;
    }
    if (message.method === "session/update") {
      const params = message.params ?? {};
      const update = (params.update ?? {}) as {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
        title?: string;
        kind?: string;
        status?: string;
        toolCallId?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
      };
      const kind = update.sessionUpdate ?? "";
      if (kind === "agent_message_chunk" && update.content?.type === "text" && typeof update.content.text === "string") {
        push({ type: "delta", text: update.content.text });
        return;
      }
      if (kind === "agent_thought_chunk" && typeof update.content?.text === "string") {
        push({
          type: "step",
          id: `thought-${Date.now()}`,
          kind: "thinking",
          title: update.content.text,
          status: "done",
        });
        return;
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        push({
          type: "step",
          id: String(update.toolCallId ?? update.title ?? "tool"),
          kind: "tool",
          title: String(update.title ?? update.kind ?? "tool"),
          status:
            update.status === "failed"
              ? "error"
              : update.status === "completed"
                ? "done"
                : "running",
        });
        return;
      }
      if (kind === "usage" && update.usage) {
        push({
          type: "usage",
          usage: {
            inputTokens: Math.max(0, Number(update.usage.inputTokens) || 0),
            outputTokens: Math.max(0, Number(update.usage.outputTokens) || 0),
            cachedTokens: 0,
            reasoningTokens: 0,
          },
        });
      }
      return;
    }
    if (message.id === 1) {
      if (message.error) return finish(message.error.message ?? "ACP initialize failed.");
      const version = Number(message.result?.protocolVersion ?? 1);
      push({ type: "step", id: "acp-init", kind: "info", title: `ACP agent ready (protocol ${version})`, status: "done" });
      if (input.nativeSessionId) {
        request(2, "session/load", {
          sessionId: input.nativeSessionId,
          cwd: input.cwd,
          mcpServers: acpMcpServers(input),
        });
      } else {
        request(2, "session/new", { cwd: input.cwd, mcpServers: acpMcpServers(input) });
      }
      return;
    }
    if (message.id === 2) {
      if (message.error && input.nativeSessionId) {
        // A stale ACP session starts a new one instead of failing the turn.
        request(2, "session/new", { cwd: input.cwd, mcpServers: acpMcpServers(input) });
        return;
      }
      if (message.error) return finish(message.error.message ?? "ACP agent could not open a session.");
      const id = message.result?.sessionId ?? message.result?.session;
      if (typeof id !== "string" || !id) return finish("ACP agent did not name a session.");
      sessionId = id;
      push({ type: "session", id });
      request(3, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: promptText(input) }],
      });
      return;
    }
    if (message.id === 3) {
      if (message.error) return finish(message.error.message ?? "ACP agent returned an error.");
      const stop = message.result?.stopReason;
      if (stop === "cancelled") return finish("The turn was cancelled.");
      return finish();
    }
  };

  request(1, "initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
  });

  try {
    while (!finished || queue.length > 0) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        yield event;
        if (event.type === "done" || event.type === "error") {
          clearTimeout(timer);
          return;
        }
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        // finish() may have run between the queue check and this assignment.
        if (finished && queue.length === 0) resolve();
      });
      wake = null;
    }
    if (failure) yield { type: "error", message: failure };
    else yield { type: "done" };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    child?.kill();
  }
}
