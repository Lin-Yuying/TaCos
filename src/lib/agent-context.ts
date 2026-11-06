import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentMessages } from "@/db/schema";
import { getContextState, loadThreadForTurn, saveContextSummary } from "@/lib/agent-threads";
import type { AgentApiEndpoint } from "@/lib/agent-api-config";
import { fetchChat, modelFor, type ApiChatMessage } from "@/lib/agent-api-client";
import { CONTEXT_COMPACT_CHARS } from "@/lib/agent-context.shared";

// #79: long API-agent threads compact instead of failing on the context limit. Older
// messages become one stored summary; the boundary message id means a later turn only
// summarizes what has not been summarized yet. A failed summary leaves the recent
// history alone — the turn still runs.

const RAW_LIMIT = 120;
const KEEP_RECENT = 14;
const COMPACT_AFTER_MESSAGES = 30;
const COMPACT_AFTER_CHARS = CONTEXT_COMPACT_CHARS;
const MIN_COMPACT_MESSAGES = 6;
const MIN_COMPACT_CHARS = 12_000;
const TRANSCRIPT_CHAR_LIMIT = 60_000;

export type ApiHistory = {
  history: { role: "user" | "assistant"; content: string }[];
  summary: string;
  compacted: number;
  summaryThrough: string | null;
  warning: string | null;
  /** Rough size of what the next request carries, for the context meter. */
  contextChars: number;
};

type RawMessage = { id: string; role: string; content: string; createdAt: string };

async function rawHistory(threadId: string): Promise<RawMessage[]> {
  const rows = await getDb()
    .select({
      id: agentMessages.id,
      role: agentMessages.role,
      content: agentMessages.content,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(RAW_LIMIT);
  return rows.reverse().filter((row) => row.content.trim());
}

async function summarize(input: {
  endpoints: AgentApiEndpoint[];
  model: string;
  previous: string;
  messages: RawMessage[];
  signal?: AbortSignal;
}): Promise<{ summary: string; through: string } | null> {
  if (input.endpoints.length === 0) return null;
  const transcript = input.messages
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.slice(0, 4_000)}`)
    .join("\n\n")
    .slice(0, TRANSCRIPT_CHAR_LIMIT);
  const prompt: ApiChatMessage[] = [
    {
      role: "system",
      content:
        "Summarize this TaCos agent conversation so a later turn can continue from it. Keep: the user's goal, decisions, task identifiers, files/documents touched, tool results that still matter, and open work. Drop small talk and duplicated text. Write compact prose, at most 350 words. Do not invent anything.",
    },
    {
      role: "user",
      content: [
        input.previous ? `Earlier summary:\n${input.previous}` : "",
        `Conversation to fold in:\n${transcript}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  for (const endpoint of input.endpoints) {
    try {
      const response = await fetchChat({
        endpoint,
        model: modelFor(endpoint, input.model),
        messages: prompt,
        stream: false,
        maxTokens: 700,
        temperature: 0.2,
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
      const payload = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      const summary =
        typeof content === "string"
          ? content.trim()
          : Array.isArray(content)
            ? content
                .map((part) =>
                  typeof part === "string"
                    ? part
                    : typeof (part as { text?: unknown })?.text === "string"
                      ? (part as { text: string }).text
                      : ""
                )
                .join("")
                .trim()
            : "";
      if (summary) {
        return { summary: summary.slice(0, 8_000), through: input.messages.at(-1)!.id };
      }
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

/**
 * The history an API-agent turn sends, with compaction applied when the thread is long.
 * Authorization happens through `loadThreadForTurn` before any message is read.
 */
export async function prepareApiHistory(input: {
  workspaceId: string;
  userId: string;
  threadId: string;
  endpoints: AgentApiEndpoint[];
  model: string;
  signal?: AbortSignal;
}): Promise<ApiHistory> {
  const thread = await loadThreadForTurn(input.workspaceId, input.userId, input.threadId, RAW_LIMIT);
  const raw = await rawHistory(input.threadId);
  const state = await getContextState(input.threadId);
  let start = 0;
  if (state.through) {
    const index = raw.findIndex((row) => row.id === state.through);
    start = index >= 0 ? index + 1 : 0;
  }
  let context = raw.slice(start);
  let summary = state.summary;
  let summaryThrough = state.through;
  let warning: string | null = null;
  let compacted = 0;

  const chars = context.reduce((sum, row) => sum + row.content.length, 0);
  const shouldCompact =
    context.length > COMPACT_AFTER_MESSAGES ||
    (chars > COMPACT_AFTER_CHARS && context.length > KEEP_RECENT + MIN_COMPACT_MESSAGES);
  const candidates = shouldCompact ? context.slice(0, Math.max(0, context.length - KEEP_RECENT)) : [];
  const candidateChars = candidates.reduce((sum, row) => sum + row.content.length, 0);
  if (candidates.length >= MIN_COMPACT_MESSAGES && (candidateChars >= MIN_COMPACT_CHARS || context.length > COMPACT_AFTER_MESSAGES)) {
    const folded = await summarize({
      endpoints: input.endpoints,
      model: input.model,
      previous: summary,
      messages: candidates,
      signal: input.signal,
    });
    if (folded) {
      await saveContextSummary(input.threadId, folded.summary, folded.through);
      summary = folded.summary;
      summaryThrough = folded.through;
      compacted = candidates.length;
      const rest = context.slice(candidates.length);
      context = rest;
    } else {
      warning = "Older history could not be summarized; this turn carries the most recent messages only.";
      context = context.slice(-RAW_LIMIT);
    }
  }

  const history = context
    .filter((row) => row.role === "user" || row.role === "assistant")
    .slice(-RAW_LIMIT)
    .map((row) => ({ role: row.role as "user" | "assistant", content: row.content }));

  const promptChars = history.reduce((sum, row) => sum + row.content.length, 0) + summary.length;
  // The thread binding is read for authorization; the caller already has it, but this
  // keeps a private thread from being summarized through someone else's request.
  void thread;
  return {
    history,
    summary,
    compacted,
    summaryThrough,
    warning,
    contextChars: promptChars,
  };
}
