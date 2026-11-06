import type { AgentSkill, CodexModel } from "@/lib/ai-constants";
import type { DetectResult, HarnessId, SubscriptionInfo, TurnEvent } from "@/lib/harness/types";

// What travels between the server and a member's computer. Nothing here holds a model key.

export type RunnerCapabilities = {
  harnesses: DetectResult[];
  models: Partial<Record<HarnessId, CodexModel[]>>;
  skills: AgentSkill[];
  // Harnesses this person can run on their own APIs.
  keyed: HarnessId[];
  // The model that answers inline edits, when this computer has an API for them.
  editModel: string | null;
  codexDefaults?: { model: string; effort: string };
  // #79: plan usage as this computer last read it. Only harnesses that report it appear.
  subscriptions?: Partial<Record<HarnessId, SubscriptionInfo>>;
};

export type TurnPayload = {
  kind: "turn";
  harness: HarnessId;
  threadId: string;
  projectId: string;
  prompt: { system: string; body: string };
  message: string;
  model: string;
  effort: string;
  approval: "ask" | "auto" | "full";
  autoApproveTools: string[];
  neverAutoApproveTools: string[];
  proxy: string;
  // A task handed to the Agent runs with nobody watching, so it gets longer than a chat turn.
  timeoutMs?: number;
  approvalWaitMs?: number;
  /** File bytes for the member runner to write into the turn folder before `openTurn`. */
  attachments?: { id: string; name: string }[];
  /** #79: the harness's own session for this thread, when one can be resumed. */
  nativeSessionId?: string | null;
};

/**
 * #79: a queued delegation. The server swaps it for a TurnPayload in `beginDelegation`
 * right before the computer runs it, so this only needs enough to find the task and agent.
 */
export type DelegationPayload = {
  kind: "delegation";
  harness: HarnessId;
  agentId: string;
  agentName: string;
  message: string;
};

/** A delegation that runs the built-in API loop on the server; never claimed by a runner. */
export type ApiDelegationPayload = {
  kind: "api-delegation";
  agentId: string;
  agentName: string;
  message: string;
  fallbackFrom?: string;
};

export type EditPayload = {
  kind: "edit";
  // "api" answers from this computer's API; a harness id borrows that CLI's login.
  engine: "api" | "codex" | "pi";
  messages: { role: string; content: string }[];
  prompt: { system: string; body: string };
  proxy: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
};

export type RunPayload = TurnPayload | EditPayload | DelegationPayload | ApiDelegationPayload;

export type ClaimedRun = {
  id: string;
  workspaceId: string;
  payload: RunPayload;
  // Per-turn bearer token for the TaCos tools. Absent on an edit.
  toolToken?: string;
};

export type RunEvents = { runId: string; sequence?: number; events: TurnEvent[] };

/** `~/.tacos/runner/config.json` on a member's computer. The only place that holds their keys. */
export type RunnerConfig = {
  endpoints: { id: string; label: string; baseUrl: string; apiKey: string; models: string[] }[];
  editProvider: string | null;
  editModel: string;
  proxy: string;
};
