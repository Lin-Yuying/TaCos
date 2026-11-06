import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns, users, workspaceMembers, workspaces } from "@/db/schema";
import { agentContext, agentMessages, agentRuntime, flattenMessages } from "@/lib/ai";
import { answerAgentApproval, type ToolApprovalCard } from "@/lib/agent-sessions";
import {
  appendAgentMessage,
  getHarnessSession,
  loadThreadForTurn,
  setAgentThreadApproval,
  setThreadEngine,
  startTaskChat,
  taskChatOpeningMessage,
} from "@/lib/agent-threads";
import { AGENT_TOOLS } from "@/lib/agent-tools";
import { recordTurn } from "@/lib/agent-turn-record";
import { turnEventsToSse } from "@/lib/harness";
import type { HarnessId, TurnEvent } from "@/lib/harness/types";
import { addComment, getIssueDetail, notify } from "@/lib/issues";
import {
  cancelLiveRun,
  finishRun,
  followRun,
  ownsRun,
  pendingRunApprovals,
  queueHandoffRun,
  runnerViewFor,
} from "@/lib/runner/hub";
import type { TurnPayload } from "@/lib/runner/protocol";
import { isServerMode } from "@/lib/server-mode";
import { TacosError } from "@/lib/tacos-error";

// A task handed to a person's own Agent. It waits on the server until their computer is on, runs
// there with nobody following a stream, and comes back as a comment and a notification.

// The tool token also lasts 30 minutes. The card gets less, so the Agent can still say what it
// did with an unanswered write.
const TURN_MS = Number(process.env.TACOS_HANDOFF_TURN_MS) || 30 * 60_000;
const APPROVAL_WAIT_MS = Number(process.env.TACOS_HANDOFF_APPROVAL_MS) || 25 * 60_000;

const APPROVALS = ["ask", "auto", "full"] as const;
type Approval = (typeof APPROVALS)[number];

type RunRow = typeof agentRuns.$inferSelect;
type QueuedPayload = { kind: "handoff"; harness: HarnessId; message: string };

export type HandoffView = {
  runId: string;
  status: string;
  error: string | null;
  threadId: string | null;
  createdAt: string;
  finishedAt: string | null;
  pending: ToolApprovalCard[];
};

export type HandoffPanel = {
  // Off in the desktop app on its own: there the Agent runs in the open conversation.
  available: boolean;
  online: boolean;
  harnesses: { id: string; label: string }[];
  handoff: HandoffView | null;
};

const OPEN = ["queued", "running"];


async function readyHarnesses(userId: string) {
  const { online, capabilities } = await runnerViewFor(userId);
  const harnesses = (capabilities?.harnesses ?? [])
    .filter((item) => item.ready || capabilities?.keyed.includes(item.id))
    .map((item) => ({ id: item.id as string, label: item.label }));
  return { known: Boolean(capabilities), online, harnesses };
}

async function latestRun(workspaceId: string, issueId: string, userId: string): Promise<RunRow | null> {
  const [row] = await getDb()
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.issueId, issueId), eq(agentRuns.userId, userId)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function handoffPanel(workspaceId: string, issueId: string, userId: string): Promise<HandoffPanel> {
  if (!isServerMode()) return { available: false, online: false, harnesses: [], handoff: null };
  const detail = await getIssueDetail(workspaceId, issueId, userId);
  if (!detail) throw new TacosError("Task not found", 404);
  const { online, harnesses } = await readyHarnesses(userId);
  const row = await latestRun(workspaceId, detail.issue.id, userId);
  return {
    available: true,
    online,
    harnesses,
    handoff: row && {
      runId: row.id,
      status: row.status,
      error: row.error,
      threadId: row.threadId,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      pending: pendingRunApprovals(row.id),
    },
  };
}

export async function handTaskToAgent(
  workspaceId: string,
  issueId: string,
  userId: string,
  input: { harness: string; approval?: string; note?: string }
): Promise<string> {
  if (!isServerMode()) throw new TacosError("Handing a task to your Agent needs a team server", 400);
  const detail = await getIssueDetail(workspaceId, issueId, userId);
  if (!detail) throw new TacosError("Task not found", 404);

  const { known, harnesses } = await readyHarnesses(userId);
  if (!known) {
    throw new TacosError("Your computer has never connected", 409, "Open TaCos on your computer once, then try again.");
  }
  const harness = harnesses.find((item) => item.id === input.harness);
  if (!harness) throw new TacosError("That harness is not ready on your computer", 400);

  const [open] = await getDb()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.issueId, detail.issue.id), eq(agentRuns.userId, userId), inArray(agentRuns.status, OPEN)))
    .limit(1);
  if (open) throw new TacosError("Your Agent already has this task", 409);

  const approval: Approval = APPROVALS.find((mode) => mode === input.approval) ?? "ask";
  // Takes the task for this person, and refuses one that someone else has taken.
  const { thread } = await startTaskChat(workspaceId, detail.issue.id, userId);
  await setThreadEngine(thread.id, harness.id);
  await setAgentThreadApproval(workspaceId, userId, thread.id, approval);

  const note = input.note?.trim();
  const message = [taskChatOpeningMessage(detail.issue.identifier), note]
    .filter(Boolean)
    .join("\n\n");
  await appendAgentMessage({ threadId: thread.id, role: "user", content: message, authorId: userId });
  const payload: QueuedPayload = { kind: "handoff", harness: harness.id as HarnessId, message };
  return queueHandoffRun({
    userId,
    workspaceId,
    threadId: thread.id,
    issueId: detail.issue.id,
    payload: JSON.stringify(payload),
  });
}

/** Called as this person's computer takes the run. Null means the task can no longer run. */
export async function beginHandoff(row: RunRow): Promise<TurnPayload | null> {
  try {
    const queued = JSON.parse(row.payload) as QueuedPayload;
    const db = getDb();
    const [member] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, row.workspaceId), eq(workspaceMembers.userId, row.userId)))
      .limit(1);
    const detail = member ? await getIssueDetail(row.workspaceId, row.issueId!, row.userId) : null;
    if (!detail) throw new TacosError("This task is no longer available to you");
    if (detail.issue.status === "done" || detail.issue.status === "canceled") {
      throw new TacosError("This task was closed while it waited");
    }
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1);
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    const thread = await loadThreadForTurn(row.workspaceId, row.userId, row.threadId!);
    const assistantId = await appendAgentMessage({ threadId: thread.id, role: "assistant", content: "" });
    const messages = agentMessages({
      message: queued.message,
      // The handoff message is the newest one, and it is passed on its own.
      history: thread.messages.slice(0, -1),
      context: await agentContext({
        workspaceId: row.workspaceId,
        userId: row.userId,
        workspaceName: workspace.name,
        workspaceKey: workspace.key,
        userName: user.displayName,
        focusIssueId: thread.focusIssueId,
        ...(thread.projectId
          ? { project: { id: thread.projectId, name: thread.projectName, key: thread.projectKey } }
          : {}),
      }),
    });
    const runtime = await agentRuntime(row.workspaceId);
    const payload: TurnPayload = {
      kind: "turn",
      harness: queued.harness,
      threadId: thread.id,
      projectId: thread.projectId,
      prompt: flattenMessages(messages),
      message: queued.message,
      model: thread.model,
      effort: thread.effort,
      approval: thread.approval,
      nativeSessionId: await getHarnessSession(thread.id, queued.harness),
      autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
      neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
      proxy: runtime.proxy,
      timeoutMs: TURN_MS,
      approvalWaitMs: APPROVAL_WAIT_MS,
    };
    await db.update(agentRuns).set({ payload: JSON.stringify(payload) }).where(eq(agentRuns.id, row.id));
    const events = followRun(row.id, { threadId: thread.id, approvalWaitMs: APPROVAL_WAIT_MS });
    void writeBack(row, detail.issue.identifier, queued.harness, assistantId, events);
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : "This task could not start";
    await finishRun(row.id, "failed", message);
    await noticeHandoffFailed(row).catch(() => {});
    return null;
  }
}

// Runs the turn to its end with nobody reading the stream, then reports back on the task.
async function writeBack(
  row: RunRow,
  identifier: string,
  harness: string,
  messageId: string,
  events: AsyncGenerator<TurnEvent>
): Promise<void> {
  let text = "";
  let failure: string | null = null;
  const base = {
    workspaceId: row.workspaceId,
    userId: row.userId,
    issueId: row.issueId!,
    body: identifier,
    data: { task: identifier },
  };
  async function* watched(): AsyncGenerator<TurnEvent> {
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") failure = event.message;
      if (event.type === "approval") await notify({ ...base, type: "handoff_waiting" }).catch(() => {});
      yield event;
    }
  }
  try {
    const reader = recordTurn(turnEventsToSse(watched()), { threadId: row.threadId!, messageId }).getReader();
    while (!(await reader.read()).done) {
      /* the tap records the turn as it passes */
    }
    const [after] = await getDb().select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, row.id));
    if (after?.status === "cancelled") return;
    if (failure) {
      await notify({ ...base, type: "handoff_failed" });
      return;
    }
    if (text.trim()) {
      await addComment(row.workspaceId, row.issueId!, text, { kind: "agent", label: harness, via: "mcp" }, {
        exceptUser: row.userId,
      });
    }
    await notify({ ...base, type: "handoff_done" });
  } catch (err) {
    await finishRun(row.id, "failed", err instanceof Error ? err.message : "Could not report back on the task");
    await notify({ ...base, type: "handoff_failed" }).catch(() => {});
  }
}

export async function noticeHandoffFailed(row: RunRow): Promise<void> {
  const detail = await getIssueDetail(row.workspaceId, row.issueId!, row.userId);
  await notify({
    workspaceId: row.workspaceId,
    userId: row.userId,
    issueId: row.issueId!,
    type: "handoff_failed",
    body: detail?.issue.identifier ?? "",
  });
}

export async function answerHandoff(runId: string, requestId: string, userId: string, allow: boolean): Promise<void> {
  if (!(await ownsRun(userId, runId))) throw new TacosError("Not your task", 403);
  const card = pendingRunApprovals(runId).find((item) => item.requestId === requestId);
  if (!card || !answerAgentApproval(requestId, allow ? "accept" : "decline")) {
    throw new TacosError("That request is no longer waiting for an answer", 404);
  }
}

export async function cancelHandoff(runId: string, userId: string): Promise<void> {
  if (!(await ownsRun(userId, runId))) throw new TacosError("Not your task", 403);
  const db = getDb();
  const dequeued = await db
    .update(agentRuns)
    .set({ status: "cancelled", finishedAt: new Date().toISOString() })
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "queued")));
  if (dequeued.changes > 0) return;
  if (!cancelLiveRun(runId)) throw new TacosError("This task is not running", 409);
}

/** A person's chat turn must not cross a handed-off turn on the same conversation. */
export async function openHandoffOnThread(threadId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ issueId: agentRuns.issueId })
    .from(agentRuns)
    .where(and(eq(agentRuns.threadId, threadId), inArray(agentRuns.status, OPEN)));
  return rows.some((row) => row.issueId);
}
