// Shared with client components: no database or node-only imports here.
export type AiProviderId = "openai" | "deepseek" | "qwen" | "moonshot" | "custom";

export type AiPreset = {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  model: string;
  hint: string;
};

export const AI_PRESETS: AiPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    hint: "Cheap and strong in Chinese; supports streaming.",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "Official OpenAI API.",
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    hint: "Alibaba Cloud DashScope's OpenAI-compatible endpoint.",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    hint: "Kimi's OpenAI-compatible endpoint.",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    model: "",
    hint: "Any endpoint that accepts POST {baseUrl}/chat/completions.",
  },
];

export function presetFor(baseUrl: string): AiProviderId {
  const normalized = baseUrl.replace(/\/+$/, "").toLowerCase();
  const preset = AI_PRESETS.find(
    (entry) => entry.id !== "custom" && entry.baseUrl.replace(/\/+$/, "").toLowerCase() === normalized
  );
  return preset?.id ?? "custom";
}

// One inline rewrite has to fit in a single answer, so anything past this length is the
// Agent's job instead. Shared with the panel so it can say so before the request.
export const AI_EDIT_CHAR_LIMIT = 8_000;

// "api" calls an OpenAI-compatible endpoint with a stored key; the CLI engines
// borrow the ChatGPT / Pi login that already exists on this machine.
export type AiEngine = "api" | "codex" | "pi";
export type CliEngine = "codex" | "pi";
/** Agent composer harness id (no API-as-agent). */
export type AgentHarnessId = "codex" | "pi" | "opencode" | "dsh" | "codebuddy";
export const AGENT_HARNESS_IDS: AgentHarnessId[] = ["codex", "pi", "opencode", "dsh", "codebuddy"];

// The Agent tab reopens on whichever engine the user chose last. It lives in a cookie so
// the server can resolve the default and the chip never hydrates to a stale value.
export const ENGINE_COOKIE = "tacos_agent_engine";

export type CliEngineStatus = {
  engine: CliEngine;
  label: string;
  installed: boolean;
  signedIn: boolean;
  // Where the binary was found, for the settings page.
  binary: string | null;
  // Account or model the CLI reports, e.g. "ChatGPT" or "gpt-6-astra".
  account: string | null;
  model: string | null;
  // What to do next when the engine cannot be used yet.
  hint: string | null;
};

export type AiSettingsView = {
  configured: boolean;
  enabled: boolean;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  // Last few characters only — the full key never leaves the server.
  keyHint: string | null;
  updatedAt: string | null;
  engine: AiEngine;
  proxy: string;
  cli: CliEngineStatus[];
};

export type AiTaskDraft = {
  title: string;
  description: string;
  priority: 0 | 1 | 2 | 3 | 4;
  labels: string[];
};

export type AiEditAction =
  | "polish"
  | "shorten"
  | "expand"
  | "fix"
  | "translate-en"
  | "translate-zh"
  | "continue"
  | "custom";

// What /api/ai/chat accepts: an inline editor action, or a turn of agent chat.
export type AiChatAction = AiEditAction | "agent";

export type AgentEngineOption = {
  id: AiEngine;
  label: string;
  // Model or account shown next to the name.
  detail: string | null;
  available: boolean;
  // Shown in the empty state when the engine cannot be used yet.
  hint: string | null;
};

/** Composer harness picker row (H-P3-17). */
export type AgentHarnessOption = {
  id: AgentHarnessId;
  label: string;
  detail: string | null;
  available: boolean;
  hint: string | null;
  /** Shown when the harness has no OS sandbox (H-P3-20). */
  riskLabel: string | null;
};

// One entry of the Codex model catalogue on this machine.
export type CodexModel = {
  slug: string;
  label: string;
  description: string;
  defaultEffort: string;
  efforts: { id: string; label: string }[];
  priority: number;
  fast: boolean;
};

// A skill Codex would load on this machine, exactly as its own skills/list reports it.
// `name` is what turn/start wants back ("plugin:skill" for marketplace skills).
export type AgentSkill = {
  name: string;
  path: string;
  description: string;
  scope: "user" | "repo" | "system" | "admin";
  // True when the skill is a plain folder in ~/.codex/skills or ~/.agents/skills, which is
  // what the Skill dialog may delete. Plugin, system and repo skills are read-only here.
  managed?: boolean;
};

// Codex's three approval postures, in the order its own menu shows them.
export const AGENT_APPROVALS = [
  { id: "ask", label: "Ask for approval", detail: "Every TaCos write waits for a card." },
  { id: "auto", label: "Approve for me", detail: "Writes go through; risky ones still ask." },
  { id: "full", label: "Full access", detail: "The agent may touch the machine. Delete actions still ask." },
] as const;

export const AI_EDIT_ACTIONS: { id: AiEditAction; label: string }[] = [
  { id: "polish", label: "Improve writing" },
  { id: "shorten", label: "Make shorter" },
  { id: "expand", label: "Expand" },
  { id: "fix", label: "Fix spelling & grammar" },
  { id: "translate-en", label: "Translate to English" },
  { id: "translate-zh", label: "Translate to Chinese" },
];
