/**
 * WorkBuddy / codebuddy turn (H-P4-23).
 * Mounts TaCos MCP via --mcp-config --strict-mcp-config.
 * Builtin tools stay off; headless -y pre-authorizes MCP.
 * Write cards are mediated in /api/agent/tools.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { subscribeToolApprovals, waitForAgentApproval } from "@/lib/agent-sessions";
import { findHarnessBinary } from "../detect-bin";
import { ownEndpoint, type OwnEndpoint } from "../own-endpoint";
import { thinkingStep } from "../thinking";
import type { TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";

const TURN_TIMEOUT_MS = 300_000;
// The login cannot be read ahead of a turn, so it shows up here: as reply text, on a failed result.
const SIGNED_OUT = /^Authentication required/;
const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

// WorkBuddy only accepts a model it finds in a models.json. The turn gets its own config dir, so
// members sharing a project cannot overwrite each other's file and this machine's login stays out.
function writeOwnConfig(own: OwnEndpoint): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-codebuddy-"));
  const model = {
    id: own.model,
    name: own.model,
    vendor: own.endpoint.label,
    // Names the variable, never the key: WorkBuddy reads the value from this turn's environment.
    apiKey: `\${${own.endpoint.envVar}}`,
    url: `${own.endpoint.baseUrl}/chat/completions`,
    supportsToolCall: true,
  };
  fs.writeFileSync(path.join(dir, "models.json"), `${JSON.stringify({ models: [model], availableModels: [own.model] }, null, 2)}\n`);
  return dir;
}

function buildEnv(
  proxy: string | undefined,
  mcpEnv: Record<string, string>,
  own: OwnEndpoint | null,
  configDir: string | null
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...mcpEnv };
  if (own && configDir) {
    // Either of these would win over the models.json key.
    delete env.CODEBUDDY_AUTH_TOKEN;
    delete env.CODEBUDDY_API_KEY;
    env.CODEBUDDY_CONFIG_DIR = configDir;
    env[own.endpoint.envVar] = own.key;
  }
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
    // Recent versions list MCP tools behind these two, so turning them off hides TaCos's tools and
    // the model reports writes it never made. No built-in tool is reachable, and the tool route
    // asks for approval, so nothing here needs a second permission check (which cannot ask anyway).
    "--tools",
    "ToolSearch,DeferExecuteTool",
    "--permission-mode",
    "bypassPermissions",
    "-y",
    "--no-session-persistence",
  ];
  if (mcpFile) {
    args.push("--mcp-config", mcpFile, "--strict-mcp-config");
  }
  const own = ownEndpoint(input);
  const configDir = own && writeOwnConfig(own);
  if (input.model) {
    args.push("--model", own?.model ?? input.model);
  }
  if (input.effort) {
    args.push("--effort", input.effort);
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
  let streamedText = false;
  let thinkingText = "";
  let thinkingCount = 0;

  // After the process exits: it keeps writing logs to this dir until then.
  const removeConfig = () => {
    if (configDir) fs.rmSync(/* turbopackIgnore: true */ configDir, { recursive: true, force: true });
  };

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
      env: buildEnv(input.proxy, input.mcp?.env ?? {}, own, configDir),
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    removeConfig();
    finish(err instanceof Error ? err.message : "Could not start WorkBuddy.");
  }
  child?.once("close", removeConfig);

  const timer = setTimeout(() => finish("WorkBuddy took longer than its time limit."), input.timeoutMs ?? TURN_TIMEOUT_MS);

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
      // A thinking block becomes one row when it ends, ahead of the reply it led to.
      if (delta?.type === "thinking_delta") {
        if (typeof delta.thinking === "string") thinkingText += delta.thinking;
        return;
      }
      if (event.type === "content_block_stop" && thinkingText) {
        const step = thinkingStep(`thinking-${++thinkingCount}`, thinkingText);
        thinkingText = "";
        if (step) push(step);
        return;
      }
      const text =
        (typeof delta?.text === "string" && delta.text) ||
        (typeof (event as { text?: string }).text === "string" && (event as { text?: string }).text) ||
        "";
      if (text) {
        streamedText = true;
        push({ type: "delta", text });
      }
      return;
    }

    if (type === "assistant") {
      const msg = message.message as { content?: unknown } | undefined;
      const content = msg?.content;
      // The finished message repeats text the partial deltas already streamed.
      if (typeof content === "string" && content) {
        if (!streamedText) push({ type: "delta", text: content });
        return;
      }
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part || typeof part !== "object") continue;
          const block = part as { type?: string; text?: string; thinking?: string; name?: string; id?: string };
          // Without partial messages the finished message is the only place thinking shows up.
          if (block.type === "thinking" && thinkingCount === 0 && typeof block.thinking === "string") {
            const step = thinkingStep(`thinking-${++thinkingCount}`, block.thinking);
            if (step) push(step);
          }
          if (!own && block.type === "text" && SIGNED_OUT.test(block.text ?? "")) {
            finish("WorkBuddy is not signed in on this machine. Sign in to WorkBuddy, or add your own API in Settings → Model API.");
            return;
          }
          if (!streamedText && block.type === "text" && typeof block.text === "string" && block.text) {
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
