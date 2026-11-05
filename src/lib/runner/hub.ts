import crypto from "node:crypto";
import { and, asc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns, projects, runnerStatus, runnerTokens } from "@/db/schema";
import {
  answerAgentApproval,
  issueAgentToolGrant,
  resolveAgentToolGrant,
  revokeAgentToolGrant,
  subscribeToolApprovals,
  waitForAgentApproval,
  type ToolApprovalCard,
} from "@/lib/agent-sessions";
import type { TurnEvent } from "@/lib/harness/types";
import { TacosError } from "@/lib/tacos-error";
import type { ClaimedRun, RunPayload, RunnerCapabilities } from "./protocol";

// A poll lasts 25 seconds, so a computer that has not asked for 70 seconds has missed two.
const OFFLINE_AFTER_MS = 70_000;
const POLL_MS = 25_000;
const SILENT_RUN_MS = Number(process.env.TACOS_RUNNER_SILENT_MS) || 75_000;
const TOKEN_TTL_MS = 30 * 86_400_000;

type LiveRun = {
  push: (event: TurnEvent) => void;
  cancelled: boolean;
  toolToken?: string;
  lastContact: number;
  pending: Map<string, ToolApprovalCard>;
};

type Hub = {
  live: Map<string, LiveRun>;
  waiters: Map<string, Set<() => void>>;
};

const globalHub = globalThis as unknown as { __tacosRunnerHub?: Hub };

function hub(): Hub {
  if (!globalHub.__tacosRunnerHub) globalHub.__tacosRunnerHub = { live: new Map(), waiters: new Map() };
  return globalHub.__tacosRunnerHub;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issueRunnerToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const db = getDb();
  await db
    .delete(runnerTokens)
    .where(and(eq(runnerTokens.userId, userId), lt(runnerTokens.createdAt, new Date(Date.now() - TOKEN_TTL_MS).toISOString())));
  await db.insert(runnerTokens).values({ tokenHash: hashToken(token), userId, createdAt: new Date().toISOString() });
  return token;
}

export async function runnerUserFor(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  const [row] = await getDb()
    .select({ userId: runnerTokens.userId })
    .from(runnerTokens)
    .where(
      and(
        eq(runnerTokens.tokenHash, hashToken(token)),
        gte(runnerTokens.createdAt, new Date(Date.now() - TOKEN_TTL_MS).toISOString())
      )
    )
    .limit(1);
  return row?.userId ?? null;
}

export async function recordRunnerStatus(userId: string, capabilities: RunnerCapabilities): Promise<void> {
  const lastSeenAt = new Date().toISOString();
  const value = JSON.stringify(capabilities);
  await getDb()
    .insert(runnerStatus)
    .values({ userId, capabilities: value, lastSeenAt })
    .onConflictDoUpdate({ target: runnerStatus.userId, set: { capabilities: value, lastSeenAt } });
}

export type RunnerView = { online: boolean; capabilities: RunnerCapabilities | null };

export async function runnerViewFor(userId: string): Promise<RunnerView> {
  const [row] = await getDb().select().from(runnerStatus).where(eq(runnerStatus.userId, userId)).limit(1);
  if (!row) return { online: false, capabilities: null };
  return {
    online: Date.now() - new Date(row.lastSeenAt).getTime() < OFFLINE_AFTER_MS,
    capabilities: JSON.parse(row.capabilities) as RunnerCapabilities,
  };
}

/** Agent work has nowhere to run while this person's computer is away. */
export async function requireRunnerOnline(userId: string): Promise<RunnerCapabilities> {
  const { online, capabilities } = await runnerViewFor(userId);
  if (!online || !capabilities) {
    throw new TacosError("Your computer is not connected", 409, "Open TaCos on your computer, then try again.");
  }
  return capabilities;
}

function wake(userId: string): void {
  const set = hub().waiters.get(userId);
  if (!set) return;
  hub().waiters.delete(userId);
  for (const waiter of set) waiter();
}

async function nextQueued(userId: string) {
  const [row] = await getDb()
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.userId, userId), eq(agentRuns.status, "queued")))
    .orderBy(asc(agentRuns.createdAt))
    .limit(1);
  return row ?? null;
}

// Issued when the computer takes the run, so a run that waits in the queue does not hold a
// live token, and the token's 30 minutes start when the work starts.
async function grantFor(row: typeof agentRuns.$inferSelect, payload: RunPayload): Promise<string | undefined> {
  if (payload.kind !== "turn") return undefined;
  const [project] = payload.projectId
    ? await getDb().select({ key: projects.key }).from(projects).where(eq(projects.id, payload.projectId)).limit(1)
    : [];
  const grant = issueAgentToolGrant({
    threadId: payload.threadId,
    workspaceId: row.workspaceId,
    projectId: payload.projectId,
    projectKey: project?.key ?? "",
    userId: row.userId,
    approval: payload.approval,
    autoApproveTools: payload.autoApproveTools,
    neverAutoApproveTools: payload.neverAutoApproveTools,
    approvalWaitMs: payload.approvalWaitMs,
  });
  return grant.token;
}

/** Hands the oldest queued run to the computer asking, waiting up to one poll for one to appear. */
export async function claimRun(userId: string, signal: AbortSignal): Promise<ClaimedRun | null> {
  const deadline = Date.now() + POLL_MS;
  while (!signal.aborted) {
    const row = await nextQueued(userId);
    if (row) {
      const taken = await getDb()
        .update(agentRuns)
        .set({ status: "running" })
        .where(and(eq(agentRuns.id, row.id), eq(agentRuns.status, "queued")));
      if (taken.changes === 0) continue;
      // A handed-off task has been waiting for this moment, so its prompt reads the task as it is now.
      let payload = JSON.parse(row.payload) as RunPayload;
      if (row.issueId && !hub().live.has(row.id)) {
        const { beginHandoff } = await import("@/lib/agent-handoff");
        const started = await beginHandoff(row);
        if (!started) continue;
        payload = started;
      }
      const toolToken = await grantFor(row, payload);
      const live = hub().live.get(row.id);
      if (live) {
        live.toolToken = toolToken;
        live.lastContact = Date.now();
      }
      return { id: row.id, workspaceId: row.workspaceId, payload, toolToken };
    }
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await new Promise<void>((resolve) => {
      const set = hub().waiters.get(userId) ?? new Set();
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, left);
      signal.addEventListener("abort", done, { once: true });
      set.add(done);
      hub().waiters.set(userId, set);
    });
  }
  return null;
}

export async function finishRun(runId: string, status: string, error?: string): Promise<void> {
  await getDb()
    .update(agentRuns)
    .set({ status, error: error ?? null, finishedAt: new Date().toISOString() })
    .where(eq(agentRuns.id, runId));
}

/**
 * Queues work for this person's computer and returns it as the events a harness adapter would
 * yield, so the route treats it like any other turn. Tool approval cards start in this process,
 * because the tools run here; everything else comes back from the computer.
 */
export async function startRun(input: {
  userId: string;
  workspaceId: string;
  threadId?: string | null;
  issueId?: string | null;
  payload: RunPayload;
  signal?: AbortSignal;
}): Promise<AsyncGenerator<TurnEvent>> {
  const runId = crypto.randomUUID();
  const events = followRun(runId, input);
  await getDb().insert(agentRuns).values({
    id: runId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    threadId: input.threadId ?? null,
    issueId: input.issueId ?? null,
    payload: JSON.stringify(input.payload),
    status: "queued",
    createdAt: new Date().toISOString(),
  });
  wake(input.userId);
  return events;
}

/** A task handed to the Agent waits here, with nobody following it, until this person's computer asks. */
export async function queueHandoffRun(input: {
  userId: string;
  workspaceId: string;
  threadId: string;
  issueId: string;
  payload: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(agentRuns).values({ id, ...input, status: "queued", createdAt: new Date().toISOString() });
  wake(input.userId);
  return id;
}

export function followRun(
  runId: string,
  input: { threadId?: string | null; signal?: AbortSignal; approvalWaitMs?: number }
): AsyncGenerator<TurnEvent> {
  const queue: TurnEvent[] = [];
  let notify: (() => void) | null = null;
  const push = (event: TurnEvent) => {
    queue.push(event);
    notify?.();
  };
  const live: LiveRun = { push, cancelled: false, lastContact: Date.now(), pending: new Map() };
  hub().live.set(runId, live);

  const unsubscribe = input.threadId
    ? subscribeToolApprovals(input.threadId, (card) => {
        push({
          type: "approval",
          requestId: card.requestId,
          tool: card.tool,
          message: card.message,
          description: card.description,
          params: card.params,
        });
        void waitForAgentApproval(card.requestId, { signal: input.signal, timeoutMs: input.approvalWaitMs }).then((raw) => {
          push({ type: "approval_done", requestId: card.requestId, decision: raw === "accept" ? "allow" : "deny" });
        });
      })
    : () => {};

  const onAbort = () => {
    live.cancelled = true;
    push({ type: "done" });
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  // A computer that goes to sleep sends nothing at all, and the person would wait forever.
  const watchdog = setInterval(() => {
    if (Date.now() - live.lastContact > SILENT_RUN_MS) {
      push({ type: "error", message: "Your computer stopped responding during this turn." });
    }
  }, 5_000);

  async function* events(): AsyncGenerator<TurnEvent> {
    let failure: string | undefined;
    try {
      while (true) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          if (event.type === "error") failure = event.message;
          if (event.type === "approval") live.pending.set(event.requestId, event);
          if (event.type === "approval_done") live.pending.delete(event.requestId);
          yield event;
          if (event.type === "done" || event.type === "error") return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
    } finally {
      clearInterval(watchdog);
      unsubscribe();
      input.signal?.removeEventListener("abort", onAbort);
      if (live.toolToken) revokeAgentToolGrant(live.toolToken);
      // Nothing can use the answer now, so no write stays waiting for one.
      for (const requestId of live.pending.keys()) answerAgentApproval(requestId, "decline");
      if (live.cancelled) {
        // Stays long enough for the computer to read the cancel on its next check.
        setTimeout(() => hub().live.delete(runId), POLL_MS);
        await finishRun(runId, "cancelled");
      } else {
        hub().live.delete(runId);
        await finishRun(runId, failure ? "failed" : "done", failure);
      }
    }
  }
  return events();
}

export async function ownsRun(userId: string, runId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export function pushRunEvents(runId: string, events: TurnEvent[]): void {
  const live = hub().live.get(runId);
  if (!live) return;
  live.lastContact = Date.now();
  for (const event of events) live.push(event);
}

export function runCancelled(runId: string): boolean {
  const live = hub().live.get(runId);
  if (live) live.lastContact = Date.now();
  // Nobody is following this run any more, which means the same thing to the computer.
  return !live || live.cancelled;
}

/** True once the person chose "Allow for this turn", so Codex stops asking. */
export function runTurnApproved(runId: string): boolean {
  const token = hub().live.get(runId)?.toolToken;
  return Boolean(token && resolveAgentToolGrant(token)?.autoApproveTurn);
}

export function pendingRunApprovals(runId: string): ToolApprovalCard[] {
  return [...(hub().live.get(runId)?.pending.values() ?? [])];
}

/** Ends a running turn; the computer reads the cancel on its next check. */
export function cancelLiveRun(runId: string): boolean {
  const live = hub().live.get(runId);
  if (!live) return false;
  live.cancelled = true;
  live.push({ type: "done" });
  return true;
}

/**
 * A run still open when the server starts has lost the person following it. A handed-off task
 * that no computer has taken yet has lost nothing: it keeps waiting.
 */
export async function failInterruptedRuns(): Promise<void> {
  const db = getDb();
  const handoffs = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.status, "running"), isNotNull(agentRuns.issueId)));
  await db
    .update(agentRuns)
    .set({ status: "failed", error: "The server restarted during this run", finishedAt: new Date().toISOString() })
    .where(or(eq(agentRuns.status, "running"), and(eq(agentRuns.status, "queued"), isNull(agentRuns.issueId))));
  if (handoffs.length === 0) return;
  const { noticeHandoffFailed } = await import("@/lib/agent-handoff");
  for (const row of handoffs) await noticeHandoffFailed(row);
}
