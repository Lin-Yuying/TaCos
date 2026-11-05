import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiSettings } from "@/db/schema";
import { listIssues, listProjects, TacosError } from "./issues";
import { PRIORITY_META, STATUS_META } from "./constants";
import {
  AI_EDIT_CHAR_LIMIT,
  type AgentEngineOption,
  type AgentHarnessOption,
  type AiEditAction,
  type AiEngine,
  type AiSettingsView,
  type AiTaskDraft,
} from "./ai-constants";
import { listCliStatuses, normalizeProxy } from "./cli-agents";
import { readyWithKeys } from "./harness/gate";
import { harnessViewFor, resolveEditConfig } from "./model-keys";
import { requireRunnerOnline, runnerViewFor, startRun } from "./runner/hub";
import { turnEventsToSse } from "./harness/sse";
import { isServerMode } from "./server-mode";

const MAX_PROMPT = AI_EDIT_CHAR_LIMIT;

type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

type ResolvedConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

// --- settings --------------------------------------------------------------

async function readStored(workspaceId: string) {
  const [row] = await getDb()
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function getAiSettingsView(workspaceId: string): Promise<AiSettingsView> {
  const row = await readStored(workspaceId);
  return {
    updatedAt: row?.updatedAt ?? null,
    engine: asEngine(row?.engine),
    proxy: row?.proxy ?? "",
    cli: listCliStatuses(),
  };
}

function asEngine(value: string | null | undefined): AiEngine {
  return value === "codex" || value === "pi" ? value : "api";
}

// Shared by the Agent tab and the inline editor: the model menu has to agree on which
// engines this viewer may actually run. A CLI signs in on the machine that hosts this
// server, so that machine's subscription serves everyone in the workspace.
export async function aiEngineOptions(workspaceId: string, userId: string): Promise<AgentEngineOption[]> {
  if (isServerMode()) {
    const { online, capabilities } = await runnerViewFor(userId);
    const hint = "Open TaCos on your computer, then try again.";
    return [
      {
        id: "api",
        label: capabilities?.editModel || "API key",
        detail: null,
        available: online && Boolean(capabilities?.editModel),
        hint: capabilities?.editModel ? hint : "Add your API key in Settings → Model API.",
      },
      ...(capabilities?.harnesses ?? [])
        .filter((detect): detect is typeof detect & { id: "codex" | "pi" } => detect.id === "codex" || detect.id === "pi")
        .map((detect) => {
          const status = readyWithKeys(detect, capabilities?.keyed ?? []);
          return {
            id: status.id,
            label: status.label,
            detail: status.version,
            available: online && status.ready,
            hint: status.ready ? hint : status.hint,
          };
        }),
    ];
  }
  const ai = await getAiSettingsView(workspaceId);
  const edit = await resolveEditConfig(userId);
  return [
    {
      id: "api",
      label: edit?.model || "API key",
      detail: edit ? `••••${edit.apiKey.slice(-4)}` : null,
      available: Boolean(edit),
      hint: "Add your API key in Settings → Model API.",
    },
    ...ai.cli.map((status) => ({
      id: status.engine,
      label: status.label,
      detail: status.signedIn ? (status.model ?? status.account) : null,
      available: status.installed && status.signedIn,
      hint: status.hint,
    })),
  ];
}

/** Agent page engines: local CLI harnesses only. The API key is not an Agent engine. */
export async function agentCliEngineOptions(workspaceId: string, userId: string): Promise<AgentEngineOption[]> {
  const all = await aiEngineOptions(workspaceId, userId);
  return all.filter((option) => option.id === "codex" || option.id === "pi");
}

/** Enabled+ready harness options for the Agent composer (H-P3-17). */
export async function listAgentHarnessOptions(workspaceId: string, userId: string): Promise<AgentHarnessOption[]> {
  const { getWorkspaceHarnessGate } = await import("@/lib/harness");
  const gate = await getWorkspaceHarnessGate(workspaceId, ...(await harnessViewFor(userId)));
  return gate.enabledReady.map((row) => ({
    id: row.id,
    label: row.label,
    detail: row.version,
    available: true,
    hint: null,
  }));
}

// Cheap check used by pages that only need to know whether the sparkle buttons
// should be offered at all. A viewer without a key of their own gets none.
export async function aiReady(workspaceId: string, userId: string): Promise<boolean> {
  if (isServerMode()) return Boolean((await runnerViewFor(userId)).capabilities?.editModel);
  return Boolean(await resolveEditConfig(userId));
}

// What the Agent tab should run a turn with.
export async function agentRuntime(workspaceId: string): Promise<{
  engine: AiEngine;
  proxy: string;
}> {
  const row = await readStored(workspaceId);
  return {
    engine: asEngine(row?.engine),
    proxy: row?.proxy ?? "",
  };
}

/** The switches an admin sets for everyone. Keys are personal and live in user_model_keys. */
export async function saveAgentRuntime(
  workspaceId: string,
  input: { proxy?: string }
): Promise<AiSettingsView> {
  const proxy = normalizeProxy(input.proxy ?? "");
  const updatedAt = new Date().toISOString();
  await getDb()
    .insert(aiSettings)
    .values({ workspaceId, baseUrl: "", model: "", apiKey: "", enabled: 1, updatedAt, proxy })
    .onConflictDoUpdate({ target: aiSettings.workspaceId, set: { proxy, updatedAt } });
  return getAiSettingsView(workspaceId);
}

async function resolveConfig(userId: string): Promise<ResolvedConfig> {
  const config = await resolveEditConfig(userId);
  if (!config) {
    throw new TacosError("AI is not configured yet", 400, "Add your API key in Settings → Model API.");
  }
  return config;
}

// On a server the API and its key are on the member's computer, so the call goes through there.
async function runnerChat(
  workspaceId: string,
  userId: string,
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number; json?: boolean; signal?: AbortSignal }
) {
  const capabilities = await requireRunnerOnline(userId);
  if (!capabilities.editModel) {
    throw new TacosError("AI is not configured yet", 400, "Add your API key in Settings → Model API.");
  }
  const { proxy } = await agentRuntime(workspaceId);
  return startRun({
    userId,
    workspaceId,
    payload: {
      kind: "edit",
      engine: "api",
      messages,
      prompt: flattenMessages(messages),
      proxy,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      json: opts.json,
    },
    signal: opts.signal,
  });
}

// --- provider calls --------------------------------------------------------

function endpoint(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}

function providerError(status: number, detail: string): TacosError {
  const snippet = detail.replace(/\s+/g, " ").trim().slice(0, 300);
  const reason = providerReason(detail) ?? snippet;
  if (status === 401 || status === 403) {
    return new TacosError("The AI provider rejected the API key", 502, reason || undefined);
  }
  if (status === 404) {
    return new TacosError(
      "The AI endpoint was not found",
      502,
      "Check the base URL — it usually ends with /v1."
    );
  }
  if (status === 429) {
    return new TacosError("The AI provider is rate-limiting this key", 502, reason || undefined);
  }
  if (status === 402 || /insufficient|quota|balance/i.test(reason)) {
    return new TacosError(
      "The AI provider has no credit left for this key",
      502,
      `${reason} — top up the provider account, or ask a workspace admin to share the Codex login.`
    );
  }
  return new TacosError(
    `AI provider error (${status})`,
    502,
    reason || "The provider returned an unexpected response."
  );
}

// Providers wrap the sentence in an error envelope; the hint is shown verbatim in the UI,
// so unwrap it instead of printing JSON at the user.
function providerReason(detail: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as { error?: unknown; message?: unknown };
  const raw =
    typeof envelope.error === "string"
      ? envelope.error
      : envelope.error && typeof envelope.error === "object"
        ? (envelope.error as { message?: unknown }).message
        : envelope.message;
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, 300) : null;
}

async function sendChat(
  config: ResolvedConfig,
  messages: ChatMessage[],
  opts: { stream: boolean; maxTokens: number; temperature: number; json?: boolean; signal?: AbortSignal }
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: opts.stream,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TacosError("The AI request timed out", 504, "Try again or pick a faster model.");
    }
    throw new TacosError(
      "Could not reach the AI provider",
      502,
      "Check the base URL and this server's network access."
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw providerError(response.status, detail);
  }
  return response;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function completeChat(
  workspaceId: string,
  userId: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean } = {}
): Promise<string> {
  if (isServerMode()) {
    const events = await runnerChat(workspaceId, userId, messages, {
      maxTokens: opts.maxTokens ?? 1_500,
      temperature: opts.temperature ?? 0.4,
      json: opts.json,
      signal: withTimeout(undefined, 90_000),
    });
    let text = "";
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") throw new TacosError(event.message, 502);
    }
    if (text) return text;
    throw new TacosError("The AI provider returned an empty response", 502);
  }
  const config = await resolveConfig(userId);
  const response = await sendChat(config, messages, {
    stream: false,
    maxTokens: opts.maxTokens ?? 1_500,
    temperature: opts.temperature ?? 0.4,
    json: opts.json,
    signal: withTimeout(undefined, 90_000),
  });
  const payload = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  // Some compatible providers return content as an array of parts.
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { text?: unknown })?.text === "string"
            ? (part as { text: string }).text
            : ""
      )
      .join("");
    if (text) return text;
  }
  throw new TacosError("The AI provider returned an empty response", 502);
}

export async function openChatStream(
  workspaceId: string,
  userId: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  if (isServerMode()) {
    const events = await runnerChat(workspaceId, userId, messages, {
      maxTokens: 2_500,
      temperature: 0.4,
      signal: withTimeout(signal, 180_000),
    });
    return turnEventsToSse(events);
  }
  const config = await resolveConfig(userId);
  const response = await sendChat(config, messages, {
    stream: true,
    maxTokens: 2_500,
    temperature: 0.4,
    signal: withTimeout(signal, 180_000),
  });
  if (!response.body) throw new TacosError("The AI provider did not return a stream", 502);
  return response.body;
}

// --- prompts ---------------------------------------------------------------

const EDIT_SYSTEM = `You are an inline editor inside a markdown document.
- Answer with the replacement text only. No preamble, no explanations, no code fences.
- Keep markdown structure (headings, lists, quotes, bold/italic, links, [[page links]], [TASK-12](issue:...) references) unless the instruction asks to change it.
- Keep the author's meaning, facts and language. Only translate when asked.
- Never invent facts, names, dates or numbers.`;

function editInstruction(action: AiEditAction, instruction?: string): string {
  switch (action) {
    case "polish":
      return "Rewrite this passage so it reads naturally and professionally, preserving its meaning and markdown.";
    case "shorten":
      return "Make this passage noticeably shorter and tighter while keeping every key point.";
    case "expand":
      return "Expand this passage with concrete detail and explanation, without inventing facts.";
    case "fix":
      return "Fix spelling, grammar and punctuation. Keep wording and formatting otherwise unchanged.";
    case "translate-en":
      return "Translate this passage into natural English. Keep markdown and task references intact.";
    case "translate-zh":
      return "Translate this passage into natural Simplified Chinese. Keep markdown and task references intact.";
    case "continue":
      return "Continue the document naturally from where it ends. Return only the new continuation, not the existing text.";
    case "custom":
      return instruction?.trim() || "Improve this passage.";
  }
}

export function editMessages(input: {
  action: AiEditAction;
  text: string;
  instruction?: string;
  // Surrounding document, so the model can keep terminology and voice consistent.
  context?: string;
}): ChatMessage[] {
  if (input.text.length > MAX_PROMPT) {
    throw new TacosError("The selection is too long for AI editing", 400, "Select a smaller passage.");
  }
  const parts = [EDIT_SYSTEM, `Task: ${editInstruction(input.action, input.instruction)}`];
  if (input.context?.trim()) {
    parts.push(`Document context (do not rewrite this part, use it for tone and terminology):\n"""\n${input.context.slice(0, 6_000)}\n"""`);
  }
  parts.push(
    input.text.trim()
      ? `Passage to work on:\n"""\n${input.text}\n"""`
      : "The document is currently empty. Write the first version from the task above."
  );
  return [
    { role: "system", content: parts.join("\n\n") },
    { role: "user", content: "Return the replacement text now." },
  ];
}

export function cleanEditOutput(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  // A model occasionally wraps the whole answer in straight quotes.
  if (
    text.length > 1 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("“") && text.endsWith("”")))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

const AGENT_SYSTEM = `You are the Agent inside TaCos, a team task tracker.
- Help the user think, plan and write: split work into tasks, draft titles and descriptions, sum things up, answer questions about how TaCos works.
- Reply in the language the user writes in. Be brief; use short markdown lists rather than long essays.
- Everything you know about the workspace is in the context block below. Never invent projects, people, task ids or numbers — say so when the context does not cover it.
- If the request is unclear, ask one short clarifying question instead of guessing.`;


const WORK_RULES = `- You can use TaCos tools for the project this conversation is bound to: list_tasks, get_task, get_overview, create_task, update_task, add_comment, claim_task, update_overview, create_doc, get_doc, edit_doc, undo_doc_edit, update_doc.
- To change part of a document, read it with get_doc and use edit_doc, which leaves the rest as it is. Documents that are too long for the inline editor are yours to rewrite: read the whole page with get_doc, then send the complete new markdown with update_doc. Documents belong to the workspace library rather than one project, so a page whose projectId is null or names another project is still fair game when the user points you at it.
- Read before you write, then make the change the user asked for. Each write pauses for the user's Allow/Deny card in the Agent tab, so do not ask them to confirm twice in chat.
- You can read everything this person can see: search_workspace finds documents, tasks and comments, and list_workspaces, list_projects, list_tasks, get_task, get_overview and get_doc take workspace and project to read elsewhere.
- Every write tool needs workspace, set to this conversation's workspace key unless the person asked for another. Write to another workspace only when the person asked for it; that write also needs project and always asks them first.
- Unless they ask for another project, only touch the bound project's tasks and comments. Report what you created or changed with task identifiers.
- Shell and file edits in the project folder are allowed inside the sandbox; do not try to reach the TaCos database or anything outside it.`;

const MAX_AGENT_HISTORY = 20;
const MAX_AGENT_TURN = 6_000;

export function agentMessages(input: {
  history?: ChatMessage[];
  message: string;
  context?: string;
}): ChatMessage[] {
  const message = input.message.trim();
  if (!message) throw new TacosError("Write something for the agent first");
  if (message.length > MAX_PROMPT) {
    throw new TacosError("That message is too long for the agent", 400, "Split it into shorter turns.");
  }
  const parts = [AGENT_SYSTEM, WORK_RULES];
  if (input.context?.trim()) {
    parts.push(`Workspace context:\n"""\n${input.context.slice(0, 8_000)}\n"""`);
  }
  const history = (input.history ?? [])
    .filter(
      (turn) =>
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim()
    )
    .slice(-MAX_AGENT_HISTORY)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(-MAX_AGENT_TURN) }));
  return [
    { role: "system", content: parts.join("\n\n") },
    ...history,
    { role: "user", content: message },
  ];
}

const MAX_AGENT_TASKS = 40;

// The local CLIs take a single prompt rather than a message array, so the system
// text and the conversation are folded into one turn.
export function flattenMessages(messages: ChatMessage[]): { system: string; body: string } {
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  const turns = messages.filter((message) => message.role !== "system");
  const last = turns[turns.length - 1];
  const history = turns.slice(0, -1);
  const blocks: string[] = [];
  if (history.length > 0) {
    blocks.push("Conversation so far:");
    for (const turn of history) {
      blocks.push(`${turn.role === "user" ? "User" : "Assistant"}:\n${turn.content}`);
    }
    blocks.push("");
  }
  blocks.push("New message from the user:", last?.content ?? "");
  return { system, body: blocks.join("\n") };
}

// A compact, read-only picture of the workspace so the agent can talk about real
// projects and tasks without the browser sending (or holding) anything.
export async function agentContext(input: {
  workspaceId: string;
  userId: string;
  workspaceName: string;
  workspaceKey: string;
  userName: string;
  // A conversation is bound to one project; the context leads with it and lists its tasks.
  project?: { id: string; name: string; key: string };
  // H-COLLAB-08: the task that this chat works on.
  focusIssueId?: string | null;
}): Promise<string> {
  const [allProjects, allIssues] = await Promise.all([
    listProjects(input.workspaceId, input.userId),
    listIssues(input.workspaceId, { viewerId: input.userId }),
  ]);
  const projects = allProjects;
  const issues = input.project
    ? allIssues.filter((issue) => issue.projectId === input.project?.id)
    : allIssues;
  const open = issues.filter((issue) => issue.status !== "done" && issue.status !== "canceled");
  const lines = [`Workspace: ${input.workspaceName} (key ${input.workspaceKey})`, `Signed-in user: ${input.userName}`];
  if (input.project) {
    lines.push(
      `Bound project: ${input.project.name} (${input.project.key}) — this conversation is about this project.`
    );
  }
  lines.push("", "Projects:");
  if (projects.length === 0) lines.push("- (none yet)");
  for (const project of projects) {
    const bound = input.project?.id === project.id;
    const mine = allIssues.filter((issue) => issue.projectId === project.id);
    const todo = mine.filter((issue) => issue.status === "todo").length;
    const active = mine.filter((issue) => issue.status === "in_progress").length;
    const done = mine.filter((issue) => issue.status === "done").length;
    lines.push(
      `- ${project.name} (${project.key})${bound ? " ← this conversation" : ""} — ${todo + active} open, ${active} in progress, ${done} done`
    );
  }
  lines.push("", input.project ? "Open tasks in this project:" : "Open tasks:");
  if (open.length === 0) lines.push("- (none)");
  for (const issue of open.slice(0, MAX_AGENT_TASKS)) {
    const project = projects.find((candidate) => candidate.id === issue.projectId);
    const priority = PRIORITY_META[issue.priority]?.label ?? "No priority";
    lines.push(
      `- ${issue.identifier} ${issue.title} [${STATUS_META[issue.status].label}, ${priority}]${
        input.project ? "" : project ? ` · ${project.name}` : ""
      }`
    );
  }
  if (open.length > MAX_AGENT_TASKS) {
    lines.push(`- …and ${open.length - MAX_AGENT_TASKS} more open tasks`);
  }
  const focus = input.focusIssueId ? allIssues.find((issue) => issue.id === input.focusIssueId) : undefined;
  if (focus) {
    lines.push(
      "",
      `Focus task: ${focus.identifier} ${focus.title} [${STATUS_META[focus.status].label}]`,
      "The user opened this chat to move this task forward. Work on it first.",
      "Description:",
      focus.description?.trim() || "(empty)"
    );
  }
  return lines.join("\n");
}

const TASK_SYSTEM = `You turn a request or a document passage into concrete work items for a task tracker.
Return strict JSON only, shaped as:
{"tasks":[{"title":"...","description":"...","priority":"none|low|medium|high|urgent","labels":["..."]}]}
Rules:
- 1 to 6 tasks. Each title is short, imperative, and specific.
- description is markdown with context, acceptance criteria or steps; empty string when nothing to add.
- Write titles and descriptions in the same language as the request.
- labels are short lowercase names; use [] when unsure.
- No prose outside the JSON.`;

export function taskMessages(input: { prompt: string; context?: string; project?: string }): ChatMessage[] {
  if (!input.prompt.trim()) throw new TacosError("Describe what the tasks should cover");
  if (input.prompt.length > MAX_PROMPT) throw new TacosError("That request is too long");
  const parts = [TASK_SYSTEM];
  if (input.project) parts.push(`Project: ${input.project}`);
  if (input.context?.trim()) {
    parts.push(`Existing project description / passage:\n"""\n${input.context.slice(0, 8_000)}\n"""`);
  }
  parts.push(`Request:\n${input.prompt.trim()}`);
  return [
    { role: "system", content: parts.join("\n\n") },
    { role: "user", content: "Return the JSON now." },
  ];
}

function asPriority(value: unknown): AiTaskDraft["priority"] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(4, Math.round(value))) as AiTaskDraft["priority"];
  }
  const word = String(value ?? "").toLowerCase();
  if (word === "urgent") return 4;
  if (word === "high") return 3;
  if (word === "medium") return 2;
  if (word === "low") return 1;
  return 0;
}

export function parseTaskJson(raw: string): AiTaskDraft[] {
  let text = raw.trim();
  const fence = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const from = start >= 0 && (arrayStart < 0 || start < arrayStart) ? start : arrayStart;
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (from < 0 || end <= from) {
    throw new TacosError("The AI returned an unexpected format", 502, "Try generating again.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(from, end + 1));
  } catch {
    throw new TacosError("The AI returned invalid JSON", 502, "Try generating again.");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { tasks?: unknown })?.tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : [parsed];
  const tasks: AiTaskDraft[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const title = String(row.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    const description =
      typeof row.description === "string" ? row.description.trim().slice(0, 8_000) : "";
    const labels = Array.isArray(row.labels)
      ? row.labels
          .map((label) =>
            typeof label === "string"
              ? label
              : typeof (label as { name?: unknown })?.name === "string"
                ? (label as { name: string }).name
                : ""
          )
          .map((label) => label.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    tasks.push({
      title,
      description,
      priority: asPriority(row.priority),
      labels: [...new Set(labels)],
    });
    if (tasks.length >= 8) break;
  }
  if (tasks.length === 0) {
    throw new TacosError("The AI did not return any tasks", 502, "Try a more specific request.");
  }
  return tasks;
}

export async function generateTasks(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
  context?: string;
  project?: string;
}): Promise<AiTaskDraft[]> {
  const raw = await completeChat(input.workspaceId, input.userId, taskMessages(input), {
    maxTokens: 1_800,
    temperature: 0.3,
    json: true,
  });
  return parseTaskJson(raw);
}

export async function draftTask(input: {
  workspaceId: string;
  userId: string;
  prompt: string;
  project?: string;
  context?: string;
}): Promise<AiTaskDraft> {
  const raw = await completeChat(
    input.workspaceId,
    input.userId,
    taskMessages({ ...input, prompt: `${input.prompt}\n\nReturn exactly one task.` }),
    { maxTokens: 1_200, temperature: 0.3, json: true }
  );
  return parseTaskJson(raw)[0];
}
