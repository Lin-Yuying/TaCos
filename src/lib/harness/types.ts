/** Multi-harness adapter contract (H-P1-05). Authority: docs/harness-contracts.md */


export type HarnessId = "codex" | "pi" | "opencode" | "dsh" | "codebuddy" | "acp";

export type ApprovalMode = "ask" | "auto" | "full";

export type DetectResult = {
  id: HarnessId;
  label: string;
  installed: boolean;
  binary: string | null;
  version: string | null;
  ready: boolean;
  error: string | null;
  hint: string | null;
};

export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  defaultEffort?: string;
  efforts?: { id: string; label: string }[];
};

export type McpStdioConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type ApprovalDecision = "allow" | "deny" | "allow_turn";

export type ApprovalRequest = {
  requestId: string;
  tool: string;
  message: string;
  description?: string;
  params?: unknown;
};

/** One person's model APIs for one turn: env vars to set, and the endpoints Pi should know about. */
export type HarnessKeys = {
  env: Record<string, string>;
  endpoints: { id: string; label: string; baseUrl: string; envVar: string; models: string[] }[];
};

export type TurnImage = { name: string; path: string; mime: string };

export type TurnInput = {
  sessionId: string;
  cwd: string;
  prompt: { system: string; body: string };
  /** Attached images; each adapter hands them over in its own way. */
  images?: TurnImage[];
  model: string | null;
  effort?: string | null;
  approval: ApprovalMode;
  mcp?: McpStdioConfig | null;
  autoApproveTools?: string[];
  /** Delete tools never auto-approve, even when approval is Full (H-P3-19). */
  neverAutoApproveTools?: string[];
  skills?: { name: string; path: string }[];
  isTurnApproved: () => boolean;
  /** Wait for the browser card after the adapter yields an approval event. */
  waitForApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  signal?: AbortSignal;
  proxy?: string;
  keys?: HarnessKeys | null;
  /** Replaces the adapter's five-minute limit on this turn. */
  timeoutMs?: number;
  /** #79: the harness's own session for this thread, when it has one to resume. */
  nativeSessionId?: string | null;
};

/** Tokens one turn reported. Observe-only: no limit reads this. */
export type TurnUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
};

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "step"; id: string; kind?: "command" | "file" | "tool" | "info" | "thinking"; title: string; status: "running" | "done" | "error" | "denied"; detail?: string }
  | {
      type: "approval";
      requestId: string;
      tool: string;
      message: string;
      description?: string;
      params?: unknown;
    }
  | { type: "approval_done"; requestId: string; decision: ApprovalDecision }
  // #79: the harness's own session id, saved so the next turn resumes instead of replaying.
  | { type: "session"; id: string }
  // #79: token counts the adapter could read from its protocol.
  | { type: "usage"; usage: TurnUsage }
  | { type: "error"; message: string }
  | { type: "done" };

/** One window of a subscription's rate limit, as the harness reports it. */
export type SubscriptionWindow = {
  id: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  /** ISO time the window resets, when reported. */
  resetsAt: string | null;
  windowMinutes: number | null;
};

/**
 * A harness's own subscription usage. `none` means it reports nothing: show that, never
 * estimate. Codex fills this from its app-server rate limits; the rest have no source.
 */
export type SubscriptionInfo = {
  source: "app-server" | "cli" | "none";
  plan: string | null;
  windows: SubscriptionWindow[];
  hint: string | null;
  checkedAt: string;
};

export type InstallResult = {
  ok: boolean;
  message: string;
  version?: string | null;
};

export type HarnessAdapter = {
  id: HarnessId;
  label: string;
  detect: () => DetectResult;
  listModels: () => Promise<ModelOption[]>;
  openTurn: (input: TurnInput) => AsyncIterable<TurnEvent>;
  install?: () => Promise<InstallResult>;
  upgrade?: () => Promise<InstallResult>;
  /** #79: plan usage, only for harnesses that actually report it. */
  subscription?: () => Promise<SubscriptionInfo>;
};

export type HarnessStatus = DetectResult & {
  enabled: boolean;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  updateCheckFailed?: boolean;
};

export type HarnessGate = {
  enabledReady: HarnessStatus[];
  anyReady: boolean;
  agentAllowed: boolean;
};

export type HarnessSettingsView = {
  rows: HarnessStatus[];
  gate: HarnessGate;
};

