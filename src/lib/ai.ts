import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { DATA_DIR, getDb } from "@/db/client";
import { aiSettings } from "@/db/schema";
import { listIssues, listProjects, TacosError } from "./issues";
import { PRIORITY_META, STATUS_META } from "./constants";
import {
  AI_EDIT_CHAR_LIMIT,
  presetFor,
  type AgentEngineOption,
  type AiEditAction,
  type AiEngine,
  type AiSettingsView,
  type AiTaskDraft,
} from "./ai-constants";
import { listCliStatuses, normalizeProxy } from "./cli-agents";

const SECRET_FILE = path.join(DATA_DIR, "ai.key");
const SECRET_LABEL = "tacos-ai-v1";
const MAX_BASE_URL = 500;
const MAX_MODEL = 120;
const MAX_KEY = 4_000;
const MAX_PROMPT = AI_EDIT_CHAR_LIMIT;

type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

type ResolvedConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
};

// --- credential encryption -------------------------------------------------

let cachedSecret: Buffer | null = null;

function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  let raw = process.env.TACOS_AI_SECRET?.trim() ?? "";
  if (!raw) {
    try {
      raw = fs.readFileSync(SECRET_FILE, "utf8").trim();
    } catch {
      // First AI save on this machine: create the secret next to the database.
      raw = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SECRET_FILE, `${raw}\n`, { mode: 0o600 });
      try {
        fs.chmodSync(SECRET_FILE, 0o600);
      } catch {
        /* best effort on filesystems without POSIX modes */
      }
    }
  }
  if (!raw) throw new TacosError("The AI credential store is unavailable on this server");
  cachedSecret = crypto.scryptSync(raw, SECRET_LABEL, 32);
  return cachedSecret;
}

function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${body.toString("base64url")}`;
}

function decryptKey(stored: string): string | null {
  try {
    const [version, iv, tag, body] = stored.split(":");
    if (version !== "v1" || !iv || !tag || !body) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secret(),
      Buffer.from(iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

// --- settings --------------------------------------------------------------

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new TacosError("Base URL is required");
  if (trimmed.length > MAX_BASE_URL) throw new TacosError("Base URL is too long");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new TacosError("Base URL must be a full URL, for example https://api.deepseek.com/v1");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TacosError("Base URL must use http or https");
  }
  return trimmed;
}

function normalizeModel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TacosError("Model name is required");
  if (trimmed.length > MAX_MODEL) throw new TacosError("Model name is too long");
  return trimmed;
}

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
  const cli = listCliStatuses();
  if (!row) {
    return {
      configured: false,
      // A workspace that never saved AI settings has not opted out — a CLI that is
      // already signed in on this server should just work.
      enabled: true,
      provider: "deepseek",
      baseUrl: "",
      model: "",
      keyHint: null,
      updatedAt: null,
      engine: "api",
      proxy: "",
      cli,
    };
  }
  const key = decryptKey(row.apiKey);
  return {
    configured: Boolean(key),
    enabled: row.enabled === 1,
    provider: presetFor(row.baseUrl),
    baseUrl: row.baseUrl,
    model: row.model,
    keyHint: key ? `••••${key.slice(-4)}` : null,
    updatedAt: row.updatedAt,
    engine: asEngine(row.engine),
    proxy: row.proxy ?? "",
    cli,
  };
}

function asEngine(value: string | null | undefined): AiEngine {
  return value === "codex" || value === "pi" ? value : "api";
}

// Shared by the Agent tab and the inline editor: the model menu has to agree on which
// engines this viewer may actually run. A CLI signs in on the machine that hosts this
// server, so that machine's subscription serves everyone in the workspace.
export async function aiEngineOptions(workspaceId: string): Promise<AgentEngineOption[]> {
  const ai = await getAiSettingsView(workspaceId);
  return [
    {
      id: "api",
      label: ai.model || "API key",
      detail: ai.keyHint,
      available: ai.enabled && ai.configured,
      hint: "Add a provider and API key in Settings → AI assistant.",
    },
    ...ai.cli.map((status) => ({
      id: status.engine,
      label: status.label,
      detail: status.signedIn ? (status.model ?? status.account) : null,
      available: ai.enabled && status.installed && status.signedIn,
      hint: status.hint,
    })),
  ];
}

// Cheap check used by pages that only need to know whether the sparkle buttons
// should be offered at all.
export async function aiReady(workspaceId: string): Promise<boolean> {
  const row = await readStored(workspaceId);
  return Boolean(row && row.enabled === 1 && decryptKey(row.apiKey));
}

// What the Agent tab should run a turn with, and whether an API key exists for the
// inline editor even when the agent itself is pointed at a local CLI.
export async function agentRuntime(workspaceId: string): Promise<{
  engine: AiEngine;
  proxy: string;
  enabled: boolean;
  apiReady: boolean;
}> {
  const row = await readStored(workspaceId);
  return {
    engine: asEngine(row?.engine),
    proxy: row?.proxy ?? "",
    enabled: row ? row.enabled === 1 : true,
    apiReady: Boolean(row && decryptKey(row.apiKey)),
  };
}

export async function saveAiSettings(
  workspaceId: string,
  input: {
    engine?: AiEngine;
    proxy?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    enabled: boolean;
  }
): Promise<AiSettingsView> {
  const engine = asEngine(input.engine);
  const proxy = normalizeProxy(input.proxy ?? "");
  const existing = await readStored(workspaceId);
  const now = new Date().toISOString();

  if (engine !== "api") {
    // The CLI brings its own login; keep whatever API key is already stored so the
    // inline editor keeps working while the Agent tab uses Codex or Pi.
    await getDb()
      .insert(aiSettings)
      .values({
        workspaceId,
        baseUrl: existing?.baseUrl ?? "",
        model: existing?.model ?? "",
        apiKey: existing?.apiKey ?? "",
        enabled: input.enabled ? 1 : 0,
        updatedAt: now,
        engine,
        proxy,
      })
      .onConflictDoUpdate({
        target: aiSettings.workspaceId,
        set: { engine, proxy, enabled: input.enabled ? 1 : 0, updatedAt: now },
      });
    return getAiSettingsView(workspaceId);
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl ?? "");
  const model = normalizeModel(input.model ?? "");
  const typedKey = input.apiKey?.trim() ?? "";
  if (typedKey.length > MAX_KEY) throw new TacosError("API key is too long");

  const existingKey = existing ? decryptKey(existing.apiKey) : null;
  const apiKey = typedKey || existingKey;
  if (!apiKey) throw new TacosError("API key is required");

  const encrypted = typedKey ? encryptKey(typedKey) : (existing?.apiKey ?? encryptKey(apiKey));
  await getDb()
    .insert(aiSettings)
    .values({
      workspaceId,
      baseUrl,
      model,
      apiKey: encrypted,
      enabled: input.enabled ? 1 : 0,
      updatedAt: now,
      engine,
      proxy,
    })
    .onConflictDoUpdate({
      target: aiSettings.workspaceId,
      set: {
        baseUrl,
        model,
        apiKey: encrypted,
        enabled: input.enabled ? 1 : 0,
        updatedAt: now,
        engine,
        proxy,
      },
    });
  return getAiSettingsView(workspaceId);
}

async function resolveConfig(
  workspaceId: string,
  override?: { baseUrl?: string; model?: string; apiKey?: string }
): Promise<ResolvedConfig> {
  const row = await readStored(workspaceId);
  const storedKey = row ? decryptKey(row.apiKey) : null;
  if (!row && !override) {
    throw new TacosError(
      "AI is not configured yet",
      400,
      "Add an API key in Settings → AI assistant."
    );
  }
  const baseUrl = normalizeBaseUrl(override?.baseUrl ?? row?.baseUrl ?? "");
  const model = normalizeModel(override?.model ?? row?.model ?? "");
  const apiKey = override?.apiKey?.trim() || storedKey;
  if (!apiKey) {
    throw new TacosError(
      "AI is not configured yet",
      400,
      "Add an API key in Settings → AI assistant."
    );
  }
  return { baseUrl, model, apiKey, enabled: row?.enabled !== 0 };
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
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; json?: boolean } = {}
): Promise<string> {
  const config = await resolveConfig(workspaceId);
  if (!config.enabled) {
    throw new TacosError("AI is turned off for this workspace", 400, "An admin can enable it in Settings.");
  }
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

export async function testAiConnection(
  workspaceId: string,
  override?: { baseUrl?: string; model?: string; apiKey?: string }
): Promise<{ model: string; sample: string }> {
  const config = await resolveConfig(workspaceId, override);
  const response = await sendChat(
    config,
    [
      {
        role: "user",
        content: "This is a connection test. Reply with exactly: ok",
      },
    ],
    {
      stream: false,
      maxTokens: 16,
      temperature: 0,
      signal: withTimeout(undefined, 45_000),
    }
  );
  const payload = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content =
    typeof payload.choices?.[0]?.message?.content === "string"
      ? (payload.choices[0].message.content as string).trim()
      : "";
  return { model: config.model, sample: content.slice(0, 80) };
}

export async function openChatStream(
  workspaceId: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {
  const config = await resolveConfig(workspaceId);
  if (!config.enabled) {
    throw new TacosError("AI is turned off for this workspace", 400, "An admin can enable it in Settings.");
  }
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

const CHAT_RULES = `- You cannot create, edit or delete anything yourself; this conversation is in Chat mode, which is read-only.
- When the user asks you to create or change tasks, docs or the overview, say that this needs Work mode and tell them to flip the Chat / Work toggle in the composer to Work (their message stays in this conversation, so they can repeat the request there). Do not send them to ⌘N or to the AI panel while Work exists — Work does it for them, with one Allow per change.
- Still give the full plan (titles, descriptions, assignees, priorities) so the Work turn can run straight away.`;

const WORK_RULES = `- You can use TaCos tools for the project this conversation is bound to: list_tasks, get_task, get_overview, create_task, update_task, add_comment, update_overview, create_doc, get_doc, update_doc.
- Documents that are too long for the inline editor are yours to rewrite: read the whole page with get_doc, then send the complete new markdown with update_doc. Documents belong to the workspace library rather than one project, so a page whose projectId is null or names another project is still fair game when the user points you at it.
- Read before you write, then make the change the user asked for. Each write pauses for the user's Allow/Deny card in the Agent tab, so do not ask them to confirm twice in chat.
- Only touch the bound project's tasks and comments. Report what you created or changed with task identifiers.
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
  userName: string;
  // A conversation is bound to one project; the context leads with it and lists its tasks.
  project?: { id: string; name: string; key: string };
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
  const lines = [`Workspace: ${input.workspaceName}`, `Signed-in user: ${input.userName}`];
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
  prompt: string;
  context?: string;
  project?: string;
}): Promise<AiTaskDraft[]> {
  const raw = await completeChat(input.workspaceId, taskMessages(input), {
    maxTokens: 1_800,
    temperature: 0.3,
    json: true,
  });
  return parseTaskJson(raw);
}

export async function draftTask(input: {
  workspaceId: string;
  prompt: string;
  project?: string;
  context?: string;
}): Promise<AiTaskDraft> {
  const raw = await completeChat(
    input.workspaceId,
    taskMessages({ ...input, prompt: `${input.prompt}\n\nReturn exactly one task.` }),
    { maxTokens: 1_200, temperature: 0.3, json: true }
  );
  return parseTaskJson(raw)[0];
}
