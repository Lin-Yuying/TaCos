/**
 * Codex app-server turn (H-P1-10).
 * Chat deltas, MCP tool steps, and mcpServer/elicitation/request approval keys.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { ApprovalDecision, TurnEvent, TurnInput } from "../types";
import type { TurnLog } from "../turn-log";
import { findHarnessBinary } from "../detect-bin";
import { startCodexGateway, type CodexGateway } from "../codex-gateway";
import { ownEndpoint, type OwnEndpoint } from "../own-endpoint";
import { thinkingStep } from "../thinking";

const TURN_TIMEOUT_MS = 300_000;

type CodexItem = {
  id?: string;
  type?: string;
  status?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  query?: string;
  summary?: unknown;
  content?: unknown;
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function mcpConfigArgs(mcp: NonNullable<TurnInput["mcp"]>): string[] {
  const overrides = [
    `mcp_servers.tacos.command=${tomlString(mcp.command)}`,
    `mcp_servers.tacos.args=${tomlArray(mcp.args)}`,
  ];
  for (const [key, value] of Object.entries(mcp.env ?? {})) {
    overrides.push(`mcp_servers.tacos.env.${key}=${tomlString(value)}`);
  }
  return overrides.flatMap((override) => ["-c", override]);
}

// Points Codex at this turn's gateway. Names the variable, never the key.
function ownEndpointArgs({ endpoint, model }: OwnEndpoint, gateway: CodexGateway): string[] {
  const provider = `model_providers.${endpoint.id}`;
  return [
    `${provider}.name=${tomlString(endpoint.label)}`,
    `${provider}.base_url=${tomlString(gateway.baseUrl)}`,
    `${provider}.env_key=${tomlString(endpoint.envVar)}`,
    `${provider}.wire_api="responses"`,
    `model_provider=${tomlString(endpoint.id)}`,
    `model=${tomlString(model)}`,
  ].flatMap((override) => ["-c", override]);
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return "The agent reported an error.";
}

function stderrTail(stderr: string, fallback: string): string {
  const tail = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ");
  return tail || fallback;
}

function connectionHint(message: string): string {
  if (!/Reconnecting|disconnected|reset by peer|timed out/i.test(message)) return message;
  return `${message} — Codex could not reach its provider from this server. Check the network, or set a proxy under Settings → Advanced.`;
}

function stepStatus(
  status: string | undefined,
  completed: boolean
): NonNullable<Extract<TurnEvent, { type: "step" }>["status"]> {
  if (status === "failed") return "error";
  if (status === "declined") return "denied";
  if (status === "completed") return "done";
  return completed ? "done" : "running";
}

function reasoningText(item: CodexItem): string {
  const parts = [item.summary, item.content].flatMap((list) => (Array.isArray(list) ? list : []));
  return parts
    .map((part: unknown) => (typeof part === "string" ? part : String((part as { text?: unknown })?.text ?? "")))
    .filter(Boolean)
    .join("\n\n");
}

function stepFromItem(item: CodexItem, completed: boolean): Extract<TurnEvent, { type: "step" }> | null {
  const id = item.id ?? "";
  if (item.type === "reasoning") return completed ? thinkingStep(id, reasoningText(item)) : null;
  if (item.type === "commandExecution") {
    return {
      type: "step",
      id,
      kind: "command",
      title: item.command ?? "Command",
      detail: JSON.stringify({
        cwd: item.cwd ?? null,
        exitCode: item.exitCode ?? null,
        output: (item.aggregatedOutput ?? "").slice(-4000),
      }),
      status: stepStatus(item.status, completed),
    };
  }
  if (item.type === "fileChange") {
    const paths = (item.changes ?? []).map((change) => change.path ?? "").filter(Boolean);
    return {
      type: "step",
      id,
      kind: "file",
      title: paths.length > 0 ? paths.join(", ") : "File change",
      detail: JSON.stringify({ changes: item.changes ?? [] }),
      status: stepStatus(item.status, completed),
    };
  }
  if (item.type === "mcpToolCall") {
    const refused =
      item.status === "failed" && /\brejected\b|\bdenied\b|\bdeclined\b/i.test(errorText(item.error));
    return {
      type: "step",
      id,
      kind: "tool",
      title: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`,
      detail: JSON.stringify({
        arguments: item.arguments ?? null,
        result: item.result ?? null,
        error: item.error ?? null,
      }),
      status: refused ? "denied" : stepStatus(item.status, completed),
    };
  }
  if (item.type === "webSearch") {
    return { type: "step", id, kind: "info", title: `Search: ${item.query ?? ""}`, status: "done" };
  }
  return null;
}

function cliEnv(proxy: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const value = (proxy ?? "").trim();
  if (value) {
    env.HTTPS_PROXY = value;
    env.HTTP_PROXY = value;
    env.ALL_PROXY = value;
  }
  return env;
}

function toCodexAction(decision: ApprovalDecision): { action: "accept"; content: Record<string, never> } | { action: "decline" } {
  if (decision === "deny") return { action: "decline" };
  return { action: "accept", content: {} };
}

/**
 * Open one Codex app-server turn and yield harness TurnEvent values.
 * Uses mcpServer/elicitation/request for MCP tool approval.
 */
export async function* openCodexTurn(input: TurnInput, log?: TurnLog): AsyncGenerator<TurnEvent> {
  const binary = findHarnessBinary("codex");
  if (!binary) {
    yield { type: "error", message: "Codex is not available on this machine." };
    yield { type: "done" };
    return;
  }

  fs.mkdirSync(input.cwd, { recursive: true });

  const queue: TurnEvent[] = [];
  let notify: (() => void) | null = null;
  let finished = false;
  let failed: string | null = null;
  let text = "";
  let stderr = "";
  let lastError = "";
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | null = null;

  const push = (event: TurnEvent) => {
    queue.push(event);
    notify?.();
  };

  const finish = (error?: string) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    if (error) failed = connectionHint(error);
    else if (!text.trim()) failed = lastError ? connectionHint(lastError) : "Codex returned an empty reply.";
    child?.kill();
    notify?.();
  };

  timer = setTimeout(
    () => finish("This work turn took longer than its time limit and was stopped."),
    input.timeoutMs ?? TURN_TIMEOUT_MS
  );

  const args = ["app-server", "-c", "notify=[]", "-c", "plugins={}"];
  const own = ownEndpoint(input);
  let gateway: CodexGateway | null = null;
  if (own) {
    try {
      gateway = await startCodexGateway(own, input.proxy);
    } catch (err) {
      yield { type: "error", message: err instanceof Error ? err.message : "Could not start Codex." };
      yield { type: "done" };
      return;
    }
    args.push(...ownEndpointArgs(own, gateway));
  }
  if (!own && input.model) args.push("-c", `model=${tomlString(input.model)}`);
  // The default effort comes from this machine's Codex config and means nothing to someone else's API.
  if (input.effort && !own) args.push("-c", `model_reasoning_effort=${tomlString(input.effort)}`);
  if (input.mcp) args.push(...mcpConfigArgs(input.mcp));
  else args.push("-c", "mcp_servers={}");

  let proc: ChildProcess;
  try {
    proc = spawn(binary, args, {
      cwd: input.cwd,
      env: {
        ...cliEnv(input.proxy),
        // The gateway is on this machine: a proxy must not stand between Codex and it.
        ...(own && gateway
          ? { [own.endpoint.envVar]: gateway.key, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    gateway?.close();
    yield { type: "error", message: err instanceof Error ? err.message : "Could not start Codex." };
    yield { type: "done" };
    return;
  }
  child = proc;
  proc.once("close", () => gateway?.close());
  if (!proc.stdout || !proc.stderr) {
    yield { type: "error", message: "Codex did not provide a stream." };
    yield { type: "done" };
    return;
  }

  const send = (message: unknown) => {
    try {
      if (proc.stdin?.writable) proc.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      /* process exited */
    }
  };

  const emitStep = (item: CodexItem, completed: boolean) => {
    const update = stepFromItem(item, completed);
    if (update) push(update);
  };

  // Codex asks before an MCP tool. Map elicitation to harness approval keys.
  const answer = (id: number | string, method: string, params: Record<string, unknown>) => {
    if (method !== "mcpServer/elicitation/request") {
      send({ jsonrpc: "2.0", id, result: { decision: "denied" } });
      return;
    }
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    if (meta.codex_approval_kind !== "mcp_tool_call") {
      send({ jsonrpc: "2.0", id, result: { action: "decline" } });
      return;
    }
    // The tool route asks for TaCos's own tools, for every harness. Asking here too means two cards.
    if (params.serverName === "tacos") {
      send({ jsonrpc: "2.0", id, result: { action: "accept", content: {} } });
      return;
    }
    const message = String(params.message ?? "Allow this tool call?");
    const toolName = message.match(/run tool "([^"]+)"/)?.[1] ?? "call";
    // H-P3-19: delete tools always wait for a card, even when approval is Full.
    const forceConfirm = input.neverAutoApproveTools?.includes(toolName);
    if (
      !forceConfirm &&
      (input.autoApproveTools?.includes(toolName) || input.isTurnApproved())
    ) {
      send({ jsonrpc: "2.0", id, result: { action: "accept", content: {} } });
      return;
    }
    const requestId = `${input.sessionId}:${String(id)}`;
    const request = {
      requestId,
      tool: `${String(params.serverName ?? "mcp")}.${toolName}`,
      message,
      description: typeof meta.tool_description === "string" ? meta.tool_description : undefined,
      params: meta.tool_params,
    };
    push({
      type: "approval",
      requestId: request.requestId,
      tool: request.tool,
      message: request.message,
      description: request.description,
      params: request.params,
    });
    void input.waitForApproval(request).then((decision) => {
      if (finished) return;
      send({ jsonrpc: "2.0", id, result: toCodexAction(decision) });
      push({ type: "approval_done", requestId: request.requestId, decision });
    });
  };

  let buffer = "";
  const handle = (line: string) => {
    let message: {
      id?: number | string | null;
      method?: string;
      result?: Record<string, unknown>;
      params?: Record<string, unknown>;
      error?: unknown;
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const method = message.method;
    const params = (message.params ?? {}) as Record<string, unknown>;

    if (method) {
      if (message.id !== undefined && message.id !== null) {
        answer(message.id, method, params);
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        emitStep((params.item ?? {}) as CodexItem, method === "item/completed");
        return;
      }
      if (method === "item/agentMessage/delta") {
        const delta = params.delta;
        if (typeof delta === "string" && delta) {
          text += delta;
          push({ type: "delta", text: delta });
        }
        return;
      }
      if (method === "mcpServer/startupStatus/updated") {
        if (params.name === "tacos" && params.status === "failed") {
          const reason = String(params.error ?? params.failureReason ?? "unknown error");
          push({
            type: "step",
            id: "tacos-mcp",
            kind: "info",
            title: `TaCos tools could not start: ${reason}`,
            status: "error",
          });
        }
        return;
      }
      if (method === "turn/completed") {
        const turn = params.turn as {
          status?: string;
          error?: unknown;
          items?: { type?: string; text?: string }[];
        } | undefined;
        if (turn?.status === "failed") return finish(errorText(turn.error));
        if (!text.trim()) {
          const fallback = turn?.items?.find((item) => item.type === "agent_message")?.text;
          if (typeof fallback === "string" && fallback) {
            text = fallback;
            push({ type: "delta", text: fallback });
          }
        }
        return finish();
      }
      if (method === "error") {
        const detail = params as { error?: unknown; willRetry?: boolean };
        lastError = errorText(detail.error);
        if (!detail.willRetry) return finish(lastError);
        return;
      }
      return;
    }

    if (message.id === 1) {
      if (message.error) return finish(errorText(message.error));
      send({ jsonrpc: "2.0", method: "initialized" });
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "thread/start",
        params: {
          cwd: input.cwd,
          sandbox: input.approval === "full" ? "danger-full-access" : "workspace-write",
          // Full keeps machine sandbox open. MCP still uses on-request so delete tools can ask (H-P3-19).
          approvalPolicy: "on-request",
          ephemeral: true,
          baseInstructions: input.prompt.system,
        },
      });
      return;
    }
    if (message.id === 2) {
      if (message.error) return finish(errorText(message.error));
      const threadId = (message.result?.thread as { id?: string } | undefined)?.id;
      if (!threadId) return finish("Codex did not open a conversation.");
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "turn/start",
        params: {
          threadId,
          input: [
            { type: "text", text: input.prompt.body },
            ...(input.skills ?? []).map((skill) => ({
              type: "skill",
              name: skill.name,
              path: skill.path,
            })),
          ],
        },
      });
      return;
    }
    if (message.id === 3 && message.error) return finish(errorText(message.error));
  };

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
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
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
    log?.write(chunk);
  });
  proc.on("error", (err) => finish(`Could not start Codex: ${err.message}`));
  proc.on("exit", (code) => {
    if (!finished) finish(stderrTail(stderr, `Codex exited with code ${code ?? "unknown"}.`));
  });

  const onAbort = () => {
    finished = true;
    if (timer) clearTimeout(timer);
    proc.kill();
    notify?.();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) {
    onAbort();
  } else {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "tacos", title: "TaCos", version: "0.1.0" } },
    });
  }

  try {
    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
        continue;
      }
      yield queue.shift()!;
    }
    if (failed) yield { type: "error", message: failed };
    else yield { type: "done" };
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
    proc.kill();
  }
}
