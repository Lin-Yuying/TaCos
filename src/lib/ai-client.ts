"use client";

import { ENGINE_COOKIE, type AiChatAction, type AiEngine } from "./ai-constants";

// Every model menu in the app (Agent tab, inline editor) reads and writes the same
// preference, so picking a model in one place carries over to the other.
export function readEngineCookie(): AiEngine | null {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${ENGINE_COOKIE}=`));
  const value = entry?.slice(ENGINE_COOKIE.length + 1);
  return value === "api" || value === "codex" || value === "pi" ? value : null;
}

export function rememberEngine(engine: AiEngine) {
  document.cookie = `${ENGINE_COOKIE}=${engine}; path=/; max-age=31536000; samesite=lax`;
}

export type AiChatTurn = { role: "user" | "assistant"; content: string };

// Structured frames the Agent tab renders next to the text: what the agent did, and the
// permission card it is waiting on.
export type AgentStepFrame = {
  key: string;
  kind: "command" | "file" | "tool" | "info";
  title: string;
  detail?: string;
  status: "running" | "done" | "error" | "denied";
};

export type AgentApprovalCard = {
  requestId: string;
  tool: string;
  message: string;
  description: string | null;
  params: string | null;
};

export type AgentFrame =
  | { type: "step"; step: AgentStepFrame }
  | { type: "approval"; request: AgentApprovalCard }
  | { type: "approval_done"; requestId: string; decision: string };

export type AiEditRequest = {
  workspaceId: string;
  action: AiChatAction;
  threadId?: string;
  text: string;
  instruction?: string;
  context?: string;
  history?: AiChatTurn[];
  engine?: AiEngine;
};

// Reads the OpenAI-compatible SSE stream from /api/ai/chat. The route sends the
// provider's bytes through unchanged, so this parser only understands `data:` chunks.
export async function streamAiEdit(
  input: AiEditRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  onFrame?: (frame: AgentFrame) => void
): Promise<string> {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    let message = `AI request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string; hint?: string };
      if (payload.error) message = payload.hint ? `${payload.error} — ${payload.hint}` : payload.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  if (!response.body) throw new Error("The AI provider returned no response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let done = false;
  let sawFrame = false;

  const consume = (event: string) => {
    for (const line of event.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        if (data === "[DONE]") done = true;
        continue;
      }
      let payload: {
        error?: { message?: string };
        tacos?: AgentFrame;
        choices?: {
          delta?: { content?: unknown };
          message?: { content?: unknown };
        }[];
      };
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (payload.error?.message) throw new Error(payload.error.message);
      if (payload.tacos) {
        sawFrame = true;
        onFrame?.(payload.tacos);
      }
      const choice = payload.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.message?.content;
      if (typeof delta === "string" && delta) {
        full += delta;
        onDelta(delta);
      }
    }
  };

  while (!done) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0 && !done) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      consume(event);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (!done && buffer.trim()) consume(buffer);
  if (!full.trim() && !sawFrame) throw new Error("The AI returned an empty response");
  return full;
}
