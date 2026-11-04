/** Multi-harness adapter contract (H-P1-05). Authority: docs/harness-contracts.md */

export type HarnessId = "codex" | "pi" | "opencode" | "dsh" | "codebuddy";

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

export type TurnInput = {
  sessionId: string;
  cwd: string;
  prompt: { system: string; body: string };
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
  | { type: "error"; message: string }
  | { type: "done" };

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

