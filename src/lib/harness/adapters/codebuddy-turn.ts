/**
 * WorkBuddy / codebuddy turn (H-P4-23).
 * Mounts TaCos MCP via --mcp-config --strict-mcp-config.
 * Disables builtin tools; headless -y pre-authorizes MCP.
 * Write cards are mediated in /api/agent/tools.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import type { TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";

const TURN_TIMEOUT_MS = 300_000;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function buildEnv(proxy: string | undefined, mcpEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...mcpEnv };
  if (proxy) {
    for (const key of PROXY_KEYS) env[key] = proxy;
  }
  return env;
}

function writeMcpConfig(cwd: string, mcp: NonNullable<TurnInput["mcp"]>): string {
  const dir = path.join(cwd, ".tacos-codebuddy");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "mcp.json");
  const config = {
    mcpServers: {
      tacos: {
        command: mcp.command,
        args: mcp.args,
        env: mcp.env ?? {},
      },
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

function messageText(input: TurnInput): string {
  const system = input.prompt.system?.trim() ?? "";
  const body = input.prompt.body?.trim() ?? "";
  if (system && body) return `${system}\n\n${body}`;
  return body || system || "Hello";
}

function permissionMode(approval: TurnInput["approval"]): string {
  // Headless print needs a non-blocking mode. TaCos still mediates MCP writes.
  if (approval === "full") return "bypassPermissions";
  if (approval === "auto") return "acceptEdits";
  return "dontAsk";
}

export async function* openCodebuddyTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = findHarnessBinary("codebuddy");
  if (!binary) {
    yield { type: "error", message: "WorkBuddy (codebuddy) is not installed on this machine." };
    yield { type: "done" };
    return;
  }

  const mcpFile = input.mcp ? writeMcpConfig(input.cwd, input.mcp) : null;
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--tools",
    "",
    "--permission-mode",
    permissionMode(input.approval),
    "-y",
    "--no-session-persistence",
  ];
  if (mcpFile) {
    args.push("--mcp-config", mcpFile, "--strict-mcp-config");
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.prompt.system?.trim()) {
    args.push("--system-prompt", input.prompt.system.trim());
  }
  args.push(messageText(input));

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
      env: buildEnv(input.proxy, input.mcp?.env ?? {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    finish(err instanceof Error ? err.message : "Could not start WorkBuddy.");
  }

  const timer = setTimeout(() => finish("WorkBuddy took longer than five minutes."), TURN_TIMEOUT_MS);

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
    finish("WorkBuddy did not provide a stream.");
  }

  if (child?.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      log?.write(chunk);
    });
  }

  child?.on("error", (err) => finish(`Could not start WorkBuddy: ${err.message}`));
  child?.on("exit", (code) => {
    if (!finished) {
      const detail = stderr.trim()
        ? stderr.trim().split("\n").slice(-3).join(" ")
        : `WorkBuddy exited with code ${code ?? "unknown"}.`;
      finish(code === 0 ? undefined : detail);
    }
  });

  function handleLine(line: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const type = String(message.type ?? "");

    // Partial SSE-style deltas (with --include-partial-messages).
    if (type === "stream_event" || type === "content_block_delta") {
      const event = (message.event as Record<string, unknown> | undefined) ?? message;
      const delta = event.delta as Record<string, unknown> | undefined;
      const text =
        (typeof delta?.text === "string" && delta.text) ||
        (typeof (event as { text?: string }).text === "string" && (event as { text?: string }).text) ||
        "";
      if (text) push({ type: "delta", text });
      return;
    }

    if (type === "assistant") {
      const msg = message.message as { content?: unknown } | undefined;
      const content = msg?.content;
      if (typeof content === "string" && content) {
        push({ type: "delta", text: content });
        return;
      }
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const block = part as { type?: string; text?: string; name?: string; id?: string };
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            push({ type: "delta", text: block.text });
          }
          if (block.type === "tool_use") {
            push({
              type: "step",
              id: String(block.id ?? block.name ?? "tool"),
              kind: "tool",
              title: String(block.name ?? "tool"),
              status: "running",
            });
          }
        }
      }
      return;
    }

    if (type === "user") {
      const msg = message.message as { content?: unknown } | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const block = part as { type?: string; tool_use_id?: string; name?: string; is_error?: boolean };
          if (block.type === "tool_result") {
            push({
              type: "step",
              id: String(block.tool_use_id ?? block.name ?? "tool"),
              kind: "tool",
              title: String(block.name ?? "tool"),
              status: block.is_error ? "error" : "done",
            });
          }
        }
      }
      return;
    }

    if (type === "result") {
      clearTimeout(timer);
      if (message.is_error || message.subtype === "error") {
        const err =
          (typeof message.error === "string" && message.error) ||
          (typeof message.result === "string" && message.result) ||
          "WorkBuddy reported an error.";
        finish(err);
        return;
      }
      finish();
      return;
    }

    if (type === "error") {
      const err =
        (typeof message.error === "string" && message.error) ||
        (typeof message.message === "string" && message.message) ||
        "WorkBuddy reported an error.";
      finish(err);
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
