import crypto from "node:crypto";

// Ephemeral, in-process state for a running Agent turn. Two things live here:
//  - tool grants: the bearer token the Codex MCP shim uses to call back into TaCos, so
//    the tool endpoint never trusts a client-supplied thread id;
//  - approval waits: the bridge pauses a write until the person in the Agent tab says
//    Allow or Deny, then resumes it.
// Both are per-turn and die with the server process, which is the intent.

export type ToolGrant = {
  token: string;
  threadId: string;
  workspaceId: string;
  projectId: string;
  projectKey: string;
  userId: string;
  expiresAt: number;
  // Set by "Allow for this turn": later writes in the same turn skip their card.
  autoApproveTurn: boolean;
};

export type ApprovalDecision = "accept" | "decline";

const GRANT_TTL_MS = 30 * 60_000;
export const APPROVAL_TTL_MS = 5 * 60_000;

type Waiter = (decision: ApprovalDecision) => void;

type Store = {
  grants: Map<string, ToolGrant>;
  approvals: Map<string, Waiter>;
};

const globalStore = globalThis as unknown as { __tacosAgentRuntime?: Store };

function store(): Store {
  if (!globalStore.__tacosAgentRuntime) {
    globalStore.__tacosAgentRuntime = { grants: new Map(), approvals: new Map() };
  }
  return globalStore.__tacosAgentRuntime;
}

export function issueAgentToolGrant(
  input: Omit<ToolGrant, "token" | "expiresAt" | "autoApproveTurn">
): ToolGrant {
  const now = Date.now();
  const grants = store().grants;
  for (const [token, grant] of grants) {
    if (grant.expiresAt <= now) grants.delete(token);
  }
  const grant: ToolGrant = {
    ...input,
    token: crypto.randomBytes(32).toString("base64url"),
    expiresAt: now + GRANT_TTL_MS,
    autoApproveTurn: false,
  };
  grants.set(grant.token, grant);
  return grant;
}

export function resolveAgentToolGrant(token: string): ToolGrant | null {
  if (!token) return null;
  const grant = store().grants.get(token) ?? null;
  if (!grant) return null;
  if (grant.expiresAt <= Date.now()) {
    store().grants.delete(token);
    return null;
  }
  return grant;
}

export function revokeAgentToolGrant(token: string): void {
  store().grants.delete(token);
}

// "Allow for this turn": the person trusts the rest of this turn's writes, so the
// bridge stops asking for each one. A new turn issues a new grant, which starts closed.
export function markTurnAutoApprove(threadId: string, userId: string): boolean {
  let marked = false;
  const now = Date.now();
  for (const grant of store().grants.values()) {
    if (grant.threadId === threadId && grant.userId === userId && grant.expiresAt > now) {
      grant.autoApproveTurn = true;
      marked = true;
    }
  }
  return marked;
}

export function requestIdFor(toolCallId: string): string {
  return `approval-${toolCallId}`;
}

// Resolves with the person's answer. A closed tab, an aborted turn or five minutes of
// silence all mean "no": the write never happens without a deliberate Allow.
export function waitForAgentApproval(
  requestId: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ApprovalDecision> {
  const approvals = store().approvals;
  return new Promise<ApprovalDecision>((resolve) => {
    let settled = false;
    const finish = (decision: ApprovalDecision) => {
      if (settled) return;
      settled = true;
      approvals.delete(requestId);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish("decline");
    const timer = setTimeout(() => finish("decline"), options.timeoutMs ?? APPROVAL_TTL_MS);
    if (options.signal?.aborted) return finish("decline");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    approvals.set(requestId, finish);
  });
}

export function answerAgentApproval(requestId: string, decision: ApprovalDecision): boolean {
  const waiter = store().approvals.get(requestId);
  if (!waiter) return false;
  waiter(decision);
  return true;
}
