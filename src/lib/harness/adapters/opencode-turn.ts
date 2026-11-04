/**
 * OpenCode turn (H-P4-22).
 * Mounts the TaCos MCP shim via OPENCODE_CONFIG_CONTENT.
 * Headless `run` auto-rejects "ask" permissions, so write cards are mediated in /api/agent/tools.
 * Built-in edit/bash stay denied. MCP tools are allowed; TaCos gates writes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import { ownEndpoint } from "../own-endpoint";
import { thinkingStep } from "../thinking";
import type { TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";

const TURN_TIMEOUT_MS = 300_000;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function buildConfig(input: TurnInput): Record<string, unknown> {
  const mcp: Record<string, unknown> = {};
  if (input.mcp) {
    mcp.tacos = {
      type: "local",
      command: [input.mcp.command, ...input.mcp.args],
      enabled: true,
      environment: input.mcp.env ?? {},
    };
  }
  const own = ownEndpoint(input);
  return {
    $schema: "https://opencode.ai/config.json",
    mcp,
    ...(own
      ? {
          provider: {
            [own.endpoint.id]: {
              npm: "@ai-sdk/openai-compatible",
              name: own.endpoint.label,
              // Names the variable, never the key: OpenCode reads the value from this turn's environment.
              options: { baseURL: own.endpoint.baseUrl, apiKey: `{env:${own.endpoint.envVar}}` },
              models: Object.fromEntries(own.endpoint.models.map((id) => [id, { name: id }])),
            },
          },
        }
      : {}),
    // Deny host builtins. Allow MCP (and other) tools so TaCos can mediate writes.
    permission: {
      edit: "deny",
      bash: "deny",
      write: "deny",
      "*": "allow",
    },
  };
}

function buildEnv(input: TurnInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildConfig(input)),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_PERMISSION: JSON.stringify({
      edit: "deny",
      bash: "deny",
      write: "deny",
      "*": "allow",
    }),
  };
  if (input.proxy) {
    for (const key of PROXY_KEYS) env[key] = input.proxy;
  }
  if (input.mcp?.env) {
    Object.assign(env, input.mcp.env);
  }
  const own = ownEndpoint(input);
  if (own) env[own.endpoint.envVar] = own.key;
  return env;
}

function messageText(input: TurnInput): string {
  const system = input.prompt.system?.trim() ?? "";
  const body = input.prompt.body?.trim() ?? "";
  if (system && body) return `${system}\n\n${body}`;
  return body || system || "Hello";
}

/** OpenCode keeps its own keys, so the fix is on its side, not in TaCos. The raw text stays in the turn log. */
export function explainOpencodeError(message: string): string {
  if (/authentication fails|invalid.*api key|api key.*invalid|unauthorized/i.test(message)) {
    return "OpenCode's stored API key was rejected. Run `opencode auth login` to replace it, or pick another model.";
  }
  return message;
}

export async function* openOpencodeTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = findHarnessBinary("opencode");
  if (!binary) {
    yield { type: "error", message: "OpenCode is not installed on this machine." };
    yield { type: "done" };
    return;
  }

  const args = ["run", "--format", "json", "--thinking", "--auto", "--dir", input.cwd, messageText(input)];
  if (input.model) {
    args.splice(1, 0, "--model", input.model);
  }
  if (input.effort) {
    args.splice(1, 0, "--variant", input.effort);
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
    void waitForAgentApproval(card.requestId, { signal: input.signal }).then((raw) => {
      const decision = raw === "accept" ? "allow" : "deny";
      push({ type: "approval_done", requestId: card.requestId, decision });
    });
  });

  let child: ChildProcess | null = null;
  let finished = false;
  let stderr = "";
  let sawText = false;
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
      env: buildEnv(input),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    finish(err instanceof Error ? err.message : "Could not start OpenCode.");
  }

  const timer = setTimeout(() => finish("OpenCode took longer than five minutes."), TURN_TIMEOUT_MS);

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
    finish("OpenCode did not provide a stream.");
  }

  if (child?.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      log?.write(chunk);
    });
  }

  child?.on("error", (err) => finish(`Could not start OpenCode: ${err.message}`));
  // "close", not "exit": the last lines of stdout can still be on their way when it exits.
  child?.on("close", (code) => {
    if (!finished) {
      const detail = stderr.trim()
        ? stderr.trim().split("\n").slice(-3).join(" ")
        : `OpenCode exited with code ${code ?? "unknown"}.`;
      // `opencode run` has no closing event of its own; a clean exit is how a turn ends.
      finish(code === 0 ? undefined : detail);
    }
  });

  function handleLine(line: string) {
    let message: {
      type?: string;
      properties?: Record<string, unknown>;
      part?: {
        text?: unknown;
        tool?: unknown;
        callID?: unknown;
        state?: { status?: unknown };
      };
      error?: string | { name?: string; message?: string; data?: { message?: string } };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const type = message.type ?? "";
    const props = message.properties ?? {};

    // `opencode run --format json` writes whole parts: each text, tool or error line stands alone.
    if (type === "text") {
      const text = message.part?.text;
      if (typeof text === "string" && text.trim()) {
        push({ type: "delta", text: sawText ? `\n\n${text}` : text });
        sawText = true;
      }
      return;
    }

    if (type === "reasoning") {
      const step = thinkingStep(`thinking-${++thinkingCount}`, String(message.part?.text ?? ""));
      if (step) push(step);
      return;
    }

    if (type === "tool_use") {
      const part = message.part;
      const status = part?.state?.status;
      push({
        type: "step",
        id: String(part?.callID ?? part?.tool ?? "tool"),
        kind: "tool",
        title: String(part?.tool ?? "tool"),
        status: status === "error" ? "error" : status === "completed" ? "done" : "running",
      });
      return;
    }

    if (type === "error") {
      const err = message.error;
      const msg = typeof err === "string" ? err : (err?.data?.message ?? err?.message ?? err?.name);
      clearTimeout(timer);
      finish(explainOpencodeError(msg || "OpenCode reported an error."));
      return;
    }

    if (type === "message.part.delta") {
      if (props.field === "text" && typeof props.delta === "string" && props.delta) {
        push({ type: "delta", text: props.delta });
      }
      return;
    }

    if (type === "message.part.updated") {
      const part = props.part as { type?: string; text?: string; callID?: string; tool?: string; state?: { status?: string } } | undefined;
      if (!part) return;
      if (part.type === "text" && typeof part.text === "string" && part.text) {
        // Full text snapshots can duplicate deltas; skip to avoid double stream.
        return;
      }
      if (part.type === "tool") {
        const status = part.state?.status;
        push({
          type: "step",
          id: String(part.callID ?? part.tool ?? "tool"),
          kind: "tool",
          title: String(part.tool ?? "tool"),
          status: status === "error" ? "error" : status === "completed" ? "done" : "running",
        });
      }
      return;
    }

    if (type === "session.next.tool.called" || type === "session.next.tool.success" || type === "session.next.tool.failed") {
      const tool = typeof props.tool === "string" ? props.tool : "tool";
      const id = String(props.callID ?? props.toolCallId ?? tool);
      const status =
        type === "session.next.tool.failed" ? "error" : type === "session.next.tool.success" ? "done" : "running";
      push({ type: "step", id, kind: "tool", title: tool, status });
      return;
    }

    if (type === "session.next.text.delta") {
      const delta = props.delta;
      if (typeof delta === "string" && delta) push({ type: "delta", text: delta });
      return;
    }

    if (type === "session.error") {
      const err = props.error as { message?: string } | string | undefined;
      const msg = typeof err === "string" ? err : err?.message;
      if (msg) push({ type: "error", message: msg });
      return;
    }

    if (type === "session.idle") {
      clearTimeout(timer);
      finish();
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
