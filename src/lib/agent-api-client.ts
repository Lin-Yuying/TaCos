import type { AgentApiEndpoint } from "@/lib/agent-api-config";
import type { TurnUsage } from "@/lib/harness/types";

// #79: the OpenAI-compatible calls behind the built-in API agent. One place for the URL,
// auth, retry classification and usage mapping so the loop and its compaction agree.

export type ApiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

export type ApiTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ApiStreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } | null;
  error?: { message?: string } | string;
};

export function chatEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export class AgentApiError extends Error {
  status: number;
  retryable: boolean;
  endpointId: string;
  constructor(message: string, status: number, retryable: boolean, endpointId: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.retryable = retryable;
    this.endpointId = endpointId;
  }
}

function reasonOf(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string; message?: string };
    const raw = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  } catch {
    return detail.replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

export function providerErrorMessage(status: number, detail: string): string {
  const reason = reasonOf(detail);
  if (status === 401 || status === 403) return "The model API rejected this key";
  if (status === 404) return "The model API endpoint was not found";
  if (status === 429) return "The model API is rate-limiting this key";
  if (status === 400 && /tool|function/i.test(reason)) {
    return `The model rejected the tool definitions${reason ? `: ${reason}` : ""}`;
  }
  return reason ? `Model API error (${status}): ${reason}` : `Model API error (${status})`;
}

export async function fetchChat(input: {
  endpoint: AgentApiEndpoint;
  model: string;
  messages: ApiChatMessage[];
  stream: boolean;
  tools?: ApiTool[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(chatEndpoint(input.endpoint.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: input.stream,
        ...(input.stream ? { stream_options: { include_usage: true } } : {}),
        ...(input.tools?.length ? { tools: input.tools, tool_choice: "auto" } : {}),
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      }),
      signal: input.signal,
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) throw err;
    throw new AgentApiError("Could not reach the model API", 0, true, input.endpoint.id);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const status = response.status;
    throw new AgentApiError(
      providerErrorMessage(status, detail),
      status,
      status === 408 || status === 409 || status === 429 || status >= 500,
      input.endpoint.id
    );
  }
  return response;
}

/** Parse an OpenAI-compatible SSE body into chunks. */
export async function* readSse(response: Response): AsyncGenerator<ApiStreamChunk> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        for (const line of block.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            yield JSON.parse(data) as ApiStreamChunk;
          } catch {
            /* a provider keep-alive is not a chunk */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function usageOf(chunk: ApiStreamChunk | null | undefined): TurnUsage | null {
  if (!chunk?.usage) return null;
  const usage = chunk.usage;
  return {
    inputTokens: Number(usage.prompt_tokens ?? 0) || 0,
    outputTokens: Number(usage.completion_tokens ?? 0) || 0,
    cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0) || 0,
    reasoningTokens: Number(usage.completion_tokens_details?.reasoning_tokens ?? 0) || 0,
  };
}

export function addUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The endpoint's model list, or the preferred model when the endpoint has a fixed one. */
export function modelFor(endpoint: AgentApiEndpoint, preferred: string): string {
  if (preferred && endpoint.models.includes(preferred)) return preferred;
  return endpoint.editModel || endpoint.models[0] || preferred || "";
}
