import { AGENT_TOOLS, executeAgentTool, namesWriteTarget, NO_WRITE_TARGET, writesElsewhere } from "@/lib/agent-tools";
import { decideToolApproval } from "@/lib/agent-tool-policy";
import { publishToolApproval, waitForAgentApproval, type ToolGrant } from "@/lib/agent-sessions";
import type { TurnEvent, TurnUsage } from "@/lib/harness/types";
import type { AgentApiEndpoint } from "@/lib/agent-api-config";
import {
  addUsage,
  AgentApiError,
  fetchChat,
  modelFor,
  readSse,
  sleep,
  usageOf,
  type ApiChatMessage,
  type ApiStreamChunk,
  type ApiTool,
} from "@/lib/agent-api-client";

// #79: the built-in API agent. It owns the loop (the harness adapters do not), so TaCos
// keeps the same per-turn grant, approval cards and tool route semantics as a CLI turn.
// No budget: iteration count is a process guard, never shown as a limit in the UI.

const DEFAULT_MAX_ITERATIONS = 20;
const REQUEST_TIMEOUT_MS = 120_000;
const RETRY_BASE_MS = 300;

function maxIterations(): number {
  const raw = Number(process.env.TACOS_API_AGENT_MAX_ITERATIONS);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(100, Math.floor(raw)) : DEFAULT_MAX_ITERATIONS;
}

const TOOLS: ApiTool[] = AGENT_TOOLS.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as unknown as Record<string, unknown>,
  },
}));

export type ApiTurnInput = {
  workspaceId: string;
  userId: string;
  threadId: string;
  issueId?: string | null;
  agentId?: string | null;
  endpoints: AgentApiEndpoint[];
  model: string;
  messages: ApiChatMessage[];
  grant: ToolGrant;
  signal?: AbortSignal;
  approvalWaitMs?: number;
  /** Info steps to emit before the first request (for example a compaction notice). */
  prelude?: TurnEvent[];
};

type ToolCall = { id: string; name: string; arguments: string };

function toolResult(text: string): string {
  return text.slice(0, 20_000);
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, error: "The model sent invalid JSON arguments for this tool." };
  }
}

async function* requestStream(input: {
  endpoints: AgentApiEndpoint[];
  model: string;
  messages: ApiChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<
  { kind: "chunk"; chunk: ApiStreamChunk; endpoint: AgentApiEndpoint } | { kind: "error"; error: string }
> {
  let lastError: string = "Could not reach the model API";
  for (const endpoint of input.endpoints) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let sent = false;
      try {
        const response = await fetchChat({
          endpoint,
          model: modelFor(endpoint, input.model),
          messages: input.messages,
          stream: true,
          tools: TOOLS,
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        for await (const chunk of readSse(response)) {
          sent = true;
          yield { kind: "chunk", chunk, endpoint };
        }
        return;
      } catch (err) {
        if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
          if (input.signal?.aborted) throw err;
          lastError = "The model API did not answer in time. Retry the turn.";
          break;
        }
        // Some text already reached the browser; a retry would duplicate it.
        if (sent) {
          lastError = err instanceof Error ? err.message : "The model API stream broke.";
          yield { kind: "error", error: lastError };
          return;
        }
        if (err instanceof AgentApiError) {
          lastError = err.message;
          if (!err.retryable) break;
          if (attempt < 2) await sleep(RETRY_BASE_MS * 2 ** attempt, input.signal);
          continue;
        }
        lastError = err instanceof Error ? err.message : "The model API request failed";
        break;
      }
    }
  }
  yield { kind: "error", error: lastError };
}

function usageEvent(usage: TurnUsage): Extract<TurnEvent, { type: "usage" }> {
  return { type: "usage", usage };
}

export async function* runApiAgentTurn(input: ApiTurnInput): AsyncGenerator<TurnEvent> {
  if (input.endpoints.length === 0) {
    yield {
      type: "error",
      message: "The built-in API agent has no model API configured.",
    };
    return;
  }
  for (const event of input.prelude ?? []) yield event;

  const messages: ApiChatMessage[] = [...input.messages];
  let totalUsage: TurnUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 };
  let reported = false;
  const guard = maxIterations();

  for (let iteration = 0; iteration < guard; iteration++) {
    let text = "";
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    let turnUsage: TurnUsage | null = null;

    for await (const frame of requestStream({
      endpoints: input.endpoints,
      model: input.model,
      messages,
      signal: input.signal,
    })) {
      if (frame.kind === "error") {
        if (reported) yield usageEvent(totalUsage);
        yield { type: "error", message: frame.error };
        return;
      }
      const chunk = frame.chunk;
      if (chunk.usage) turnUsage = usageOf(chunk);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        yield { type: "delta", text: delta.content };
      }
      for (const call of delta.tool_calls ?? []) {
        const known = calls.get(call.index) ?? { id: "", name: "", arguments: "" };
        calls.set(call.index, {
          id: call.id || known.id || `call-${iteration}-${call.index}`,
          name: call.function?.name || known.name,
          arguments: known.arguments + (call.function?.arguments ?? ""),
        });
      }
    }

    if (turnUsage) {
      totalUsage = addUsage(totalUsage, turnUsage);
      reported = true;
      yield usageEvent(totalUsage);
    }

    const toolCalls: ToolCall[] = [...calls.values()].filter((call) => call.name);
    if (toolCalls.length === 0) {
      if (!text.trim()) {
        yield { type: "error", message: "The model API returned an empty response." };
        return;
      }
      yield { type: "done" };
      return;
    }

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of toolCalls) {
      const spec = AGENT_TOOLS.find((tool) => tool.name === call.name);
      if (!spec) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Unknown tool "${call.name}".`,
        });
        yield {
          type: "step",
          id: call.id,
          kind: "tool",
          title: `tacos.${call.name}`,
          status: "error",
          detail: "Unknown tool.",
        };
        continue;
      }
      const parsed = parseArgs(call.arguments);
      if (!parsed.ok) {
        messages.push({ role: "tool", tool_call_id: call.id, content: parsed.error });
        yield {
          type: "step",
          id: call.id,
          kind: "tool",
          title: `tacos.${call.name}`,
          status: "error",
          detail: parsed.error,
        };
        continue;
      }
      if (spec.write && !namesWriteTarget(parsed.value)) {
        messages.push({ role: "tool", tool_call_id: call.id, content: NO_WRITE_TARGET });
        yield {
          type: "step",
          id: call.id,
          kind: "tool",
          title: `tacos.${call.name}`,
          status: "denied",
          detail: NO_WRITE_TARGET,
        };
        continue;
      }

      yield {
        type: "step",
        id: call.id,
        kind: "tool",
        title: `tacos.${call.name}`,
        status: "running",
        detail: JSON.stringify(parsed.value, null, 2).slice(0, 4_000),
      };

      const ctx = {
        workspaceId: input.grant.workspaceId,
        projectId: input.grant.projectId,
        projectKey: input.grant.projectKey,
        userId: input.grant.userId,
        threadId: input.grant.threadId,
      };
      let needsCard = decideToolApproval(spec, input.grant) === "confirm";
      if (!needsCard && spec.write) {
        needsCard = await writesElsewhere(ctx, call.name, parsed.value).catch(() => false);
      }
      if (needsCard) {
        const requestId = `approval-${input.threadId}-${call.id}-${Date.now()}`;
        publishToolApproval(input.threadId, {
          requestId,
          tool: `tacos.${call.name}`,
          message: `Allow tool "${call.name}"?`,
          description: spec.description,
          params: parsed.value,
        });
        // Register the waiter before the card reaches the browser, or a fast answer is lost.
        const waiting = waitForAgentApproval(requestId, {
          signal: input.signal,
          timeoutMs: input.approvalWaitMs,
        });
        yield {
          type: "approval",
          requestId,
          tool: `tacos.${call.name}`,
          message: `Allow tool "${call.name}"?`,
          description: spec.description,
          params: parsed.value,
        };
        const decision = await waiting;
        yield { type: "approval_done", requestId, decision: decision === "accept" ? "allow" : "deny" };
        if (decision !== "accept") {
          messages.push({ role: "tool", tool_call_id: call.id, content: `The person denied tool "${call.name}".` });
          yield {
            type: "step",
            id: call.id,
            kind: "tool",
            title: `tacos.${call.name}`,
            status: "denied",
            detail: "Denied by the person.",
          };
          continue;
        }
      }

      try {
        const result = await executeAgentTool(ctx, call.name, parsed.value);
        const content = toolResult(result.text);
        messages.push({ role: "tool", tool_call_id: call.id, content });
        yield {
          type: "step",
          id: call.id,
          kind: "tool",
          title: `tacos.${call.name}`,
          status: result.isError ? "error" : "done",
          detail: content.slice(0, 4_000),
        };
      } catch (err) {
        const content = err instanceof Error ? err.message : "The tool failed.";
        messages.push({ role: "tool", tool_call_id: call.id, content });
        yield {
          type: "step",
          id: call.id,
          kind: "tool",
          title: `tacos.${call.name}`,
          status: "error",
          detail: content,
        };
      }
    }
  }

  yield {
    type: "error",
    message: "The API agent reached its internal step guard. Retry the turn, or narrow the request.",
  };
}
