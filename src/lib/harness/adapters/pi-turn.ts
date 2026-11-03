/**
 * Pi coding-agent turn (H-P4-21).
 * Mounts the TaCos MCP shim. Write cards are mediated in /api/agent/tools (no Pi elicitation).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import type { TurnEvent, TurnInput } from "../types";

const TURN_TIMEOUT_MS = 300_000;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

function buildEnv(proxy: string | undefined, agentDir: string, mcpEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...mcpEnv };
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

export async function* openPiTurn(input: TurnInput): AsyncGenerator<TurnEvent> {
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
  if (input.model) {
    args.unshift("--model", input.model);
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
      env: buildEnv(input.proxy, agentDir, input.mcp?.env ?? {}),
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
    if (message.type === "agent_settled") {
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

