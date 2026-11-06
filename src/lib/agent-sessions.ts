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
  /** Ask / auto / full for this turn (H-P4-21 Pi mediation). */
  approval: "ask" | "auto" | "full";
  autoApproveTools: string[];
  neverAutoApproveTools: string[];
  /** How long a card waits for an answer; a person may be away from a handed-off task. */
  approvalWaitMs?: number;
};

export type ToolApprovalCard = {
  requestId: string;
  tool: string;
  message: string;
  description?: string;
  params?: unknown;
};

export type ApprovalDecision = "accept" | "decline";

const GRANT_TTL_MS = 30 * 60_000;
export const APPROVAL_TTL_MS = 5 * 60_000;

type Waiter = (decision: ApprovalDecision) => void;

type Store = {
  grants: Map<string, ToolGrant>;
  approvals: Map<string, Set<Waiter>>;
};

const globalStore = globalThis as unknown as { __tacosAgentRuntime?: Store };

function store(): Store {
  if (!globalStore.__tacosAgentRuntime) {
    globalStore.__tacosAgentRuntime = { grants: new Map(), approvals: new Map() };
  }
  return globalStore.__tacosAgentRuntime;
}

export function issueAgentToolGrant(
  input: Omit<ToolGrant, "token" | "expiresAt" | "autoApproveTurn"> & {
    approval?: ToolGrant["approval"];
    autoApproveTools?: string[];
    neverAutoApproveTools?: string[];
  }
): ToolGrant {
  const now = Date.now();
  const grants = store().grants;
  for (const [token, grant] of grants) {
    if (grant.expiresAt <= now) grants.delete(token);
  }
  const grant: ToolGrant = {
    ...input,
    approval: input.approval ?? "ask",
    autoApproveTools: input.autoApproveTools ?? [],
    neverAutoApproveTools: input.neverAutoApproveTools ?? [],
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

/** A turn running in this server's own process for this person. */
export function hasLiveAgentTurn(userId: string): boolean {
  const now = Date.now();
  for (const grant of store().grants.values()) {
    if (grant.userId === userId && grant.expiresAt > now) return true;
  }
  return false;
}

export function revokeAgentToolGrant(token: string): void {
  const grant=store().grants.get(token);store().grants.delete(token);
  if(grant && ![...store().grants.values()].some(other=>other.threadId===grant.threadId && other.expiresAt>Date.now())){
    for(const card of approvalQueues.get(grant.threadId)??[]) { answerAgentApproval(card.requestId,"decline");clearQueuedApproval(card.requestId); }
    approvalQueues.delete(grant.threadId);
  }
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
      clearQueuedApproval(requestId);
      const set = approvals.get(requestId);
      if (set) {
        set.delete(finish);
        if (set.size === 0) approvals.delete(requestId);
      }
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(decision);
    };
    const onAbort = () => finish("decline");
    const timer = setTimeout(() => finish("decline"), options.timeoutMs ?? APPROVAL_TTL_MS);
    if (options.signal?.aborted) return finish("decline");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let set = approvals.get(requestId);
    if (!set) {
      set = new Set();
      approvals.set(requestId, set);
    }
    set.add(finish);
  });
}

export function answerAgentApproval(requestId: string, decision: ApprovalDecision): boolean {
  const set = store().approvals.get(requestId);
  if (!set || set.size === 0) return false;
  // Copy before notify: finish() mutates the set.
  for (const waiter of [...set]) waiter(decision);
  return true;
}


type ApprovalListener = (card: ToolApprovalCard) => void;

const approvalListeners = new Map<string, Set<ApprovalListener>>();
const approvalQueues = new Map<string, ToolApprovalCard[]>();
const queueTimers=new Map<string,ReturnType<typeof setTimeout>>();
function clearQueuedApproval(requestId:string){
  clearTimeout(queueTimers.get(requestId));queueTimers.delete(requestId);
  for(const [threadId,queue] of approvalQueues){const next=queue.filter(card=>card.requestId!==requestId);if(next.length)approvalQueues.set(threadId,next);else approvalQueues.delete(threadId);}
}

/** Publish a tool approval card for a running turn (Pi / non-elicitation harnesses). */
export function publishToolApproval(threadId: string, card: ToolApprovalCard): void {
  const listeners = approvalListeners.get(threadId);
  if (listeners && listeners.size > 0) {
    for (const listener of listeners) listener(card);
    return;
  }
  clearQueuedApproval(card.requestId);
  const queue = approvalQueues.get(threadId) ?? [];
  queue.push(card);
  const timer=setTimeout(()=>{answerAgentApproval(card.requestId,"decline");clearQueuedApproval(card.requestId);},APPROVAL_TTL_MS);timer.unref?.();queueTimers.set(card.requestId,timer);
  approvalQueues.set(threadId, queue);
}

/** Subscribe to tool approval cards for this thread. Returns an unsubscribe function. */
export function subscribeToolApprovals(
  threadId: string,
  listener: ApprovalListener
): () => void {
  const queued = approvalQueues.get(threadId) ?? [];
  approvalQueues.delete(threadId);
  for (const card of queued) {clearQueuedApproval(card.requestId);listener(card); }
  let set = approvalListeners.get(threadId);
  if (!set) {
    set = new Set();
    approvalListeners.set(threadId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) approvalListeners.delete(threadId);
  };
}
