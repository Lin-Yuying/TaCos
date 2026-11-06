import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns, agentThreads, issueAssignees, issues, users, workspaceMembers, workspaces } from "@/db/schema";
import { agentContext, agentMessages, agentRuntime } from "@/lib/ai";
import {
  answerAgentApproval,
  issueAgentToolGrant,
  pendingApprovalsForThread,
  revokeAgentToolGrant,
  type ToolApprovalCard,
} from "@/lib/agent-sessions";
import { runApiAgentTurn } from "@/lib/agent-api-loop";
import { prepareApiHistory } from "@/lib/agent-context";
import {
  appendAgentMessage,
  getHarnessSession,
  loadThreadForTurn,
  saveHarnessSession,
  setAgentThreadApproval,
  setThreadEngine,
  startAgentThread,
  taskChatOpeningMessage,
} from "@/lib/agent-threads";
import { AGENT_TOOLS } from "@/lib/agent-tools";
import { recordTurn } from "@/lib/agent-turn-record";
import { recordAgentUsage, usageForRun, type UsageTotals } from "@/lib/agent-usage";
import { formatTokens } from "@/lib/agent-usage.shared";
import { turnEventsToSse } from "@/lib/harness";
import type { HarnessId, SubscriptionInfo, TurnEvent } from "@/lib/harness/types";
import { addComment, getIssueDetail, notify, recordEvent, TacosError } from "@/lib/issues";
import { emitAutomationEvent } from "@/lib/automations/dispatch";
import { orderAgentApiEndpoints, resolveAgentApiEndpoints } from "@/lib/agent-api-config";
import {
  cancelLiveRun,
  finishRun,
  followRun,
  ownsRun,
  pendingRunApprovals,
  queueDelegationRun,
  runnerViewFor,
} from "@/lib/runner/hub";
import type { TurnPayload } from "@/lib/runner/protocol";
import { isServerMode } from "@/lib/server-mode";
import {
  agentCoversProject,
  asAgentApproval,
  delegateOptions,
  getAgentView,
  resolveDelegationAgent,
  type AgentOption,
  type AgentView,
  type ResolvedAgent,
} from "@/lib/workspace-agents";

// #79: a task delegated to a named or personal agent. The human assignees keep ownership;
// the run reports back as a comment with a review state (approve / request changes /
// retry), and the Inbox hears about start, review and failure.

const OPEN = ["queued", "running"];
const APPROVAL_WAIT_MS = Number(process.env.TACOS_DELEGATION_APPROVAL_MS) || 25 * 60_000;
const TURN_MS = Number(process.env.TACOS_DELEGATION_TURN_MS) || 30 * 60_000;

type RunRow = typeof agentRuns.$inferSelect;

// In-process API runs can be cancelled from the task panel. The signal is process-local:
// a restart already fails every running row.
const apiAborts = new Map<string, AbortController>();

export type DelegationPayload = {
  kind: "delegation";
  harness: HarnessId;
  agentId: string;
  agentName: string;
  message: string;
};

export type DelegationRunView = {
  runId: string;
  status: string;
  reviewStatus: string | null;
  source: string;
  agentId: string | null;
  agentName: string;
  engine: string;
  model: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  threadId: string | null;
  usage: UsageTotals;
  subscription: SubscriptionInfo | null;
  pending: ToolApprovalCard[];
  /** The harness agent fell back to the API loop because the computer was away. */
  fallback: boolean;
};

export type DelegationPanel = {
  agents: AgentOption[];
  online: boolean;
  run: DelegationRunView | null;
  // The issue's stored delegation state (survives after the latest run ends).
  status: string | null;
  agent: AgentView | null;
  threadId: string | null;
  reviewStatus: string | null;
  canDelegate: boolean;
};

async function loadIssue(workspaceId: string, issueId: string, viewerId: string) {
  const detail = await getIssueDetail(workspaceId, issueId, viewerId);
  if (!detail) throw new TacosError("Task not found", 404);
  return detail;
}

async function runRow(runId: string | null): Promise<RunRow | null> {
  if (!runId) return null;
  const [row] = await getDb().select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  return row ?? null;
}

async function latestRun(workspaceId: string, issueId: string): Promise<RunRow | null> {
  const [row] = await getDb()
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.issueId, issueId), isNotNull(agentRuns.agentId)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return row ?? null;
}

function viewOfRun(row: RunRow, agentName: string): DelegationRunView {
  const pending = row.source === "runner" ? pendingRunApprovals(row.id) : [];
  return {
    runId: row.id,
    status: row.status,
    reviewStatus: row.reviewStatus ?? null,
    source: row.source,
    agentId: row.agentId ?? null,
    agentName,
    engine: "",
    model: row.model,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    threadId: row.threadId,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    subscription: row.subscription ? (JSON.parse(row.subscription) as SubscriptionInfo) : null,
    pending,
    fallback: false,
  };
}

export async function delegationPanel(workspaceId: string, issueId: string, userId: string): Promise<DelegationPanel> {
  const detail = await loadIssue(workspaceId, issueId, userId);
  const issue = detail.issue;
  const agents = await delegateOptions(workspaceId, userId);
  const [online, capabilities] = await Promise.all([
    isServerMode() ? runnerViewFor(userId).then((view) => view.online) : Promise.resolve(true),
    isServerMode() ? runnerViewFor(userId).then((view) => view.capabilities) : Promise.resolve(undefined),
  ]);
  const row = (await runRow(issue.delegationRunId)) ?? (await latestRun(workspaceId, issue.id));
  let agent: AgentView | null = null;
  if (issue.delegatedAgentId) {
    agent = await getAgentView(workspaceId, userId, issue.delegatedAgentId);
  }
  let run: DelegationRunView | null = null;
  if (row) {
    const agentName = (row.agentId ? (await getAgentView(workspaceId, userId, row.agentId))?.name : null) ?? "Agent";
    run = viewOfRun(row, agentName);
    run.usage = await usageForRun(row.id);
    if (row.source === "api") run.pending = pendingApprovalsForThread(row.threadId ?? "");
    const payload = (() => {
      try {
        return JSON.parse(row.payload) as { fallbackFrom?: string; harness?: string; source?: string };
      } catch {
        return {};
      }
    })();
    run.fallback = Boolean(payload.fallbackFrom);
    if (row.source === "api") run.engine = "api";
    else run.engine = payload.harness ?? "";
    if (capabilities && row.source === "runner") {
      const detect = capabilities.harnesses.find((item) => item.id === run?.engine);
      if (detect) run.model = run.model || detect.version || "";
    }
  }
  const closed = issue.status === "done" || issue.status === "canceled";
  return {
    agents,
    online,
    run,
    status: issue.delegationStatus ?? null,
    agent,
    threadId: row?.threadId ?? null,
    reviewStatus: row?.reviewStatus ?? null,
    canDelegate: !closed,
  };
}

async function setIssueDelegation(
  issueId: string,
  patch: {
    agentId?: string | null;
    by?: string | null;
    status?: string | null;
    runId?: string | null;
    at?: string | null;
  }
): Promise<void> {
  await getDb()
    .update(issues)
    .set({
      ...(patch.agentId !== undefined ? { delegatedAgentId: patch.agentId } : {}),
      ...(patch.by !== undefined ? { delegatedBy: patch.by } : {}),
      ...(patch.status !== undefined ? { delegationStatus: patch.status } : {}),
      ...(patch.runId !== undefined ? { delegationRunId: patch.runId } : {}),
      ...(patch.at !== undefined ? { delegatedAt: patch.at } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(issues.id, issueId));
}

async function agentActor(label: string) {
  return { kind: "agent" as const, label, via: "mcp" as const };
}

async function noticeTargets(workspaceId: string, issueId: string, except: (string | null | undefined)[] = []): Promise<{ userId: string; identifier: string; title: string }[]> {
  const db = getDb();
  const [row] = await db.select().from(issues).where(eq(issues.id, issueId)).limit(1);
  if (!row) return [];
  const targets = new Set<string>();
  const assigned = await db
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, issueId));
  for (const entry of assigned) targets.add(entry.userId);
  for (const id of [row.createdBy, row.delegatedBy, row.publishedBy]) if (id) targets.add(id);
  for (const id of except) if (id) targets.delete(id);
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const allowed = new Set(members.map((member) => member.userId));
  return [...targets]
    .filter((id) => allowed.has(id))
    .map((userId) => ({ userId, identifier: row.identifier, title: row.title }));
}

async function notifyDelegation(
  workspaceId: string,
  issueId: string,
  type: "delegation_started" | "delegation_review" | "delegation_failed" | "delegation_changes_requested",
  agentName: string,
  except: (string | null | undefined)[] = []
): Promise<void> {
  for (const target of await noticeTargets(workspaceId, issueId, except)) {
    await notify({
      workspaceId,
      userId: target.userId,
      issueId,
      type,
      body: target.identifier,
      data: { actorName: agentName, task: target.identifier, title: target.title },
    }).catch(() => {});
  }
}

async function openDelegationThread(input: {
  workspaceId: string;
  issueId: string;
  identifier: string;
  title: string;
  projectId: string;
  userId: string;
  agent: ResolvedAgent;
  message: string;
}): Promise<{ threadId: string; messageId: string }> {
  const db = getDb();
  const [existing] = await db
    .select({ id: agentThreads.id })
    .from(agentThreads)
    .where(and(eq(agentThreads.focusIssueId, input.issueId), eq(agentThreads.createdBy, input.userId)))
    .orderBy(desc(agentThreads.updatedAt))
    .limit(1);
  let threadId = existing?.id ?? "";
  if (!threadId) {
    const created = await startAgentThread({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      visibility: "private",
      engine: input.agent.resolvedEngine,
      model: input.agent.model,
      approval: input.agent.approval,
      userId: input.userId,
    });
    threadId = created.id;
    await db
      .update(agentThreads)
      .set({
        focusIssueId: input.issueId,
        agentId: input.agent.id,
        title: `${input.identifier} ${input.title}`.slice(0, 120),
      })
      .where(eq(agentThreads.id, threadId));
  }
  await setThreadEngine(threadId, input.agent.resolvedEngine);
  await setAgentThreadApproval(input.workspaceId, input.userId, threadId, asAgentApproval(input.agent.approval)).catch(() => {});
  const messageId = await appendAgentMessage({
    threadId,
    role: "user",
    content: input.message,
    authorId: input.userId,
  });
  return { threadId, messageId };
}

export async function delegateTask(input: {
  workspaceId: string;
  issueId: string;
  userId: string;
  agentId: string;
  note?: string;
  approval?: string;
  retryOfRunId?: string | null;
}): Promise<DelegationPanel> {
  const detail = await loadIssue(input.workspaceId, input.issueId, input.userId);
  const issue = detail.issue;
  if (issue.status === "done" || issue.status === "canceled") {
    throw new TacosError("This task is already closed", 409);
  }
  const resolved = await resolveDelegationAgent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    agentId: input.agentId,
    allowFallback: true,
  });
  if (!agentCoversProject(resolved, issue.projectId)) {
    throw new TacosError("This agent does not work in this project", 403);
  }
  if (input.approval) resolved.approval = asAgentApproval(input.approval);

  // One live delegation per task.
  const [busy] = await getDb()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.issueId, issue.id), inArray(agentRuns.status, OPEN)))
    .limit(1);
  if (busy) throw new TacosError("This task already has a running agent", 409);

  const note = input.note?.trim();
  const message = [taskChatOpeningMessage(issue.identifier), note].filter(Boolean).join("\n\n");
  const { threadId } = await openDelegationThread({
    workspaceId: input.workspaceId,
    issueId: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    projectId: issue.projectId,
    userId: input.userId,
    agent: resolved,
    message,
  });

  const now = new Date().toISOString();
  const fallbackFrom = resolved.source === "harness" && resolved.runSource === "api" ? resolved.engine : undefined;
  let subscription: string | null = null;
  if (resolved.source === "harness" && resolved.runSource === "runner") {
    const { getHarnessAdapter } = await import("@/lib/harness");
    if (isServerMode()) {
      const { capabilities } = await runnerViewFor(input.userId);
      const snapshot = capabilities?.subscriptions?.[resolved.engine as HarnessId];
      if (snapshot) subscription = JSON.stringify(snapshot);
    } else {
      const snapshot = await getHarnessAdapter(resolved.engine as HarnessId)?.subscription?.();
      if (snapshot) subscription = JSON.stringify(snapshot);
    }
  }
  let runId: string;
  if (resolved.runSource === "runner") {
    const queued: DelegationPayload = {
      kind: "delegation",
      harness: resolved.engine as HarnessId,
      agentId: resolved.id,
      agentName: resolved.name,
      message,
    };
    runId = await queueDelegationRun({
      userId: input.userId,
      workspaceId: input.workspaceId,
      threadId,
      issueId: issue.id,
      agentId: resolved.id,
      model: resolved.model,
      payload: JSON.stringify(queued),
      subscription,
    });
  } else {
    runId = crypto.randomUUID();
    await getDb().insert(agentRuns).values({
      id: runId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      threadId,
      issueId: issue.id,
      payload: JSON.stringify({
        kind: "api-delegation",
        agentId: resolved.id,
        agentName: resolved.name,
        message,
        ...(fallbackFrom ? { fallbackFrom } : {}),
      }),
      status: "running",
      agentId: resolved.id,
      source: "api",
      model: resolved.model,
      subscription,
      createdAt: now,
    });
  }
  await setIssueDelegation(issue.id, {
    agentId: resolved.id,
    by: input.userId,
    status: resolved.runSource === "api" ? "running" : "queued",
    runId,
    at: now,
  });
  const actor = await agentActor(resolved.name);
  await recordEvent(
    issue.id,
    input.retryOfRunId ? "agent_retried" : "agent_delegated",
    {
      agent: resolved.name,
      agentId: resolved.id,
      source: resolved.runSource,
      ...(fallbackFrom ? { fallbackFrom } : {}),
      ...(input.retryOfRunId ? { retryOf: input.retryOfRunId } : {}),
    },
    actor
  );
  const [requester] = await getDb()
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.userId));
  await emitAutomationEvent({
    type: "task.delegated",
    workspaceId: input.workspaceId,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    actorUserId: input.userId,
    actorName: requester?.displayName ?? "A member",
    data: { agentId: resolved.id, agentName: resolved.name, source: resolved.runSource },
    idempotencyKey: `delegation:${runId}`,
  });
  await notifyDelegation(input.workspaceId, issue.id, "delegation_started", resolved.name, [input.userId]);
  if (resolved.runSource === "api") {
    void runApiDelegation(runId).catch(async (err) => {
      await failDelegation(runId, err instanceof Error ? err.message : "The API agent could not start");
    });
  }
  return delegationPanel(input.workspaceId, issue.id, input.userId);
}

export async function undelegateTask(workspaceId: string, issueId: string, userId: string): Promise<void> {
  const detail = await loadIssue(workspaceId, issueId, userId);
  const issue = detail.issue;
  const canCancel =
    issue.assignees.some((person) => person.id === userId) ||
    issue.delegatedBy === userId ||
    issue.createdBy === userId;
  if (!canCancel) throw new TacosError("Only the assignees or the person who delegated can cancel", 403);
  if (issue.delegationRunId) {
    const row = await runRow(issue.delegationRunId);
    if (row && OPEN.includes(row.status)) {
      if (row.source === "api") apiAborts.get(row.id)?.abort();
      const live = row.source === "runner" ? cancelLiveRun(row.id) : false;
      if (!live) {
        await getDb()
          .update(agentRuns)
          .set({ status: "cancelled", finishedAt: new Date().toISOString() })
          .where(and(eq(agentRuns.id, row.id), inArray(agentRuns.status, OPEN)));
      }
    }
  }
  await setIssueDelegation(issue.id, {
    agentId: null,
    by: null,
    status: "cancelled",
    runId: null,
    at: null,
  });
  await recordEvent(issue.id, "agent_undelegated", {}, { kind: "user", userId, displayName: "Member" });
}

export async function reviewDelegation(input: {
  workspaceId: string;
  issueId: string;
  userId: string;
  action: "approve" | "request_changes" | "retry";
  note?: string;
}): Promise<DelegationPanel> {
  const detail = await loadIssue(input.workspaceId, input.issueId, input.userId);
  const issue = detail.issue;
  const row = (await runRow(issue.delegationRunId)) ?? (await latestRun(input.workspaceId, issue.id));
  const reviewer =
    issue.assignees.some((person) => person.id === input.userId) ||
    issue.delegatedBy === input.userId ||
    row?.userId === input.userId;
  if (!reviewer) throw new TacosError("Only the assignees or the person who delegated can review this run", 403);
  if (input.action === "retry") {
    const agentId = issue.delegatedAgentId ?? row?.agentId;
    if (!agentId) throw new TacosError("No agent to retry", 409);
    return delegateTask({
      workspaceId: input.workspaceId,
      issueId: issue.id,
      // The rerun stays with the person who started the delegation: their model API or
      // harness login pays for it. The reviewer still made the decision.
      userId: row?.userId ?? input.userId,
      agentId,
      note: input.note,
      retryOfRunId: row?.id ?? null,
    });
  }
  if (!row) throw new TacosError("There is no agent result to review", 409);
  if (row.status !== "done") throw new TacosError("The agent has not finished", 409);
  if (input.action === "approve") {
    await getDb()
      .update(agentRuns)
      .set({ reviewStatus: "approved" })
      .where(eq(agentRuns.id, row.id));
    await setIssueDelegation(issue.id, { status: "approved" });
    await recordEvent(issue.id, "agent_approved", { agent: row.agentId ?? "" }, { kind: "user", userId: input.userId, displayName: "Member" });
    return delegationPanel(input.workspaceId, issue.id, input.userId);
  }
  // Request changes: mark, then start the same agent again with the reviewer's note.
  await getDb()
    .update(agentRuns)
    .set({ reviewStatus: "changes_requested" })
    .where(eq(agentRuns.id, row.id));
  await setIssueDelegation(issue.id, { status: "changes_requested" });
  await recordEvent(
    issue.id,
    "agent_changes_requested",
    { agent: row.agentId ?? "", note: input.note?.slice(0, 500) ?? "" },
    { kind: "user", userId: input.userId, displayName: "Member" }
  );
  await notifyDelegation(input.workspaceId, issue.id, "delegation_changes_requested", "Agent");
  const agentId = issue.delegatedAgentId ?? row.agentId;
  if (!agentId) return delegationPanel(input.workspaceId, issue.id, input.userId);
  return delegateTask({
    workspaceId: input.workspaceId,
    issueId: issue.id,
    userId: row.userId,
    agentId,
    note: input.note?.trim()
      ? `The reviewer asked for changes:\n${input.note.trim()}`
      : "The reviewer asked for changes. Revise the work and report back.",
    retryOfRunId: row.id,
  });
}

export async function answerDelegation(input: {
  workspaceId: string;
  issueId: string;
  userId: string;
  runId: string;
  requestId: string;
  allow: boolean;
}): Promise<DelegationPanel> {
  if (!(await ownsRun(input.userId, input.runId))) {
    // A human assignee may answer a card the requester left waiting.
    const detail = await loadIssue(input.workspaceId, input.issueId, input.userId);
    const assigned = detail.issue.assignees.some((person) => person.id === input.userId);
    if (!assigned) throw new TacosError("Not your task", 403);
  }
  const row = await runRow(input.runId);
  if (!row) throw new TacosError("Run not found", 404);
  const card =
    row.source === "runner"
      ? pendingRunApprovals(row.id).find((item) => item.requestId === input.requestId)
      : pendingApprovalsForThread(row.threadId ?? "").find((item) => item.requestId === input.requestId);
  if (!card || !answerAgentApproval(input.requestId, input.allow ? "accept" : "decline")) {
    throw new TacosError("That request is no longer waiting for an answer", 404);
  }
  return delegationPanel(input.workspaceId, input.issueId, input.userId);
}

export async function cancelDelegation(workspaceId: string, issueId: string, userId: string): Promise<DelegationPanel> {
  await undelegateTask(workspaceId, issueId, userId);
  return delegationPanel(workspaceId, issueId, userId);
}

// --- runner side -----------------------------------------------------------

/** Called on the member's computer as it takes a delegated run. Mirrors beginHandoff. */
export async function beginDelegation(row: RunRow): Promise<TurnPayload | null> {
  try {
    const queued = JSON.parse(row.payload) as DelegationPayload;
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
    await setIssueDelegation(row.issueId!, { status: "running", runId: row.id });
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1);
    const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    const thread = await loadThreadForTurn(row.workspaceId, row.userId, row.threadId!);
    const assistantId = await appendAgentMessage({ threadId: thread.id, role: "assistant", content: "" });
    const messages = agentMessages({
      message: queued.message,
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
      prompt: flatten(messages),
      message: queued.message,
      model: thread.model,
      effort: thread.effort,
      approval: thread.approval,
      autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
      neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
      proxy: runtime.proxy,
      timeoutMs: TURN_MS,
      approvalWaitMs: APPROVAL_WAIT_MS,
      nativeSessionId: await getHarnessSession(thread.id, queued.harness),
    };
    await db.update(agentRuns).set({ payload: JSON.stringify(payload) }).where(eq(agentRuns.id, row.id));
    const events = followRun(row.id, { threadId: thread.id, approvalWaitMs: APPROVAL_WAIT_MS });
    void writeBackRunner(row, detail.issue.identifier, queued, assistantId, events);
    return payload;
  } catch (err) {
    await failDelegation(row.id, err instanceof Error ? err.message : "This task could not start");
    return null;
  }
}

function flatten(messages: { role: string; content: string }[]): { system: string; body: string } {
  const system = messages.find((message) => message.role === "system")?.content ?? "";
  const turns = messages.filter((message) => message.role !== "system");
  const last = turns.at(-1);
  const history = turns.slice(0, -1);
  const blocks: string[] = [];
  if (history.length) {
    blocks.push("Conversation so far:");
    for (const turn of history) blocks.push(`${turn.role === "user" ? "User" : "Assistant"}:\n${turn.content}`);
    blocks.push("");
  }
  blocks.push("New message from the user:", last?.content ?? "");
  return { system, body: blocks.join("\n") };
}

async function writeBackRunner(
  row: RunRow,
  identifier: string,
  queued: DelegationPayload,
  messageId: string,
  events: AsyncGenerator<TurnEvent>
): Promise<void> {
  let text = "";
  let failure: string | null = null;
  const started = Date.now();
  async function* watched(): AsyncGenerator<TurnEvent> {
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") failure = event.message;
      yield event;
    }
  }
  try {
    const reader = recordTurn(turnEventsToSse(watched()), {
      threadId: row.threadId!,
      messageId,
      onUsage: (usage) => {
        void recordAgentUsage({
          workspaceId: row.workspaceId,
          userId: row.userId,
          engine: queued.harness,
          model: row.model,
          source: "runner",
          usage,
          runId: row.id,
          threadId: row.threadId,
          messageId,
          issueId: row.issueId,
          agentId: row.agentId,
          durationMs: Date.now() - started,
        });
      },
      onSession: (sessionId) => {
        void saveHarnessSession(row.threadId!, queued.harness, sessionId);
      },
    }).getReader();
    while (!(await reader.read()).done) {
      /* the tap records the turn as it passes */
    }
    if (failure) {
      await failDelegation(row.id, failure);
      return;
    }
    await completeDelegation(row, queued.agentName, identifier, text);
  } catch (err) {
    await failDelegation(row.id, err instanceof Error ? err.message : "Could not report back on the task");
  }
}

// --- API side --------------------------------------------------------------

async function runApiDelegation(runId: string): Promise<void> {
  const row = await runRow(runId);
  if (!row) return;
  const payload = JSON.parse(row.payload) as {
    agentId: string;
    agentName: string;
    message: string;
    fallbackFrom?: string;
  };
  const abort = new AbortController();
  apiAborts.set(runId, abort);
  const endpoints = orderAgentApiEndpoints(await resolveAgentApiEndpoints(row.userId), row.model);
  if (endpoints.length === 0) {
    await failDelegation(runId, "The built-in API agent has no model API configured");
    return;
  }
  const detail = await getIssueDetail(row.workspaceId, row.issueId!, row.userId);
  if (!detail) {
    await failDelegation(runId, "This task is no longer available");
    return;
  }
  const thread = await loadThreadForTurn(row.workspaceId, row.userId, row.threadId!);
  const [workspace] = await getDb().select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1);
  const [user] = await getDb().select().from(users).where(eq(users.id, row.userId)).limit(1);
  const assistantId = await appendAgentMessage({ threadId: thread.id, role: "assistant", content: "" });
  const context = await agentContext({
    workspaceId: row.workspaceId,
    userId: row.userId,
    workspaceName: workspace.name,
    workspaceKey: workspace.key,
    userName: user.displayName,
    focusIssueId: thread.focusIssueId,
    ...(thread.projectId
      ? { project: { id: thread.projectId, name: thread.projectName, key: thread.projectKey } }
      : {}),
  });
  const prepared = await prepareApiHistory({
    workspaceId: row.workspaceId,
    userId: row.userId,
    threadId: thread.id,
    endpoints,
    model: thread.model,
    signal: abort.signal,
  });
  const system = agentMessages({ message: "placeholder", context })[0]?.content ?? "";
  const messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[] = [{ role: "system", content: system }];
  if (prepared.summary) {
    messages.push({
      role: "system",
      content: `Earlier conversation summary (already completed; use it for context):\n${prepared.summary}`,
    });
  }
  messages.push(...prepared.history);
  if (messages.at(-1)?.role !== "user") {
    messages.push({ role: "user", content: payload.message });
  }
  const grant = issueAgentToolGrant({
    threadId: thread.id,
    workspaceId: row.workspaceId,
    projectId: thread.projectId,
    projectKey: thread.projectKey,
    userId: row.userId,
    approval: thread.approval,
    autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
    neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
    approvalWaitMs: APPROVAL_WAIT_MS,
  });
  let text = "";
  let failure: string | null = null;
  const started = Date.now();
  const events = runApiAgentTurn({
    workspaceId: row.workspaceId,
    userId: row.userId,
    threadId: thread.id,
    issueId: row.issueId,
    agentId: row.agentId,
    endpoints,
    model: thread.model || endpoints[0].editModel,
    messages,
    grant,
    signal: abort.signal,
    approvalWaitMs: APPROVAL_WAIT_MS,
    prelude: prepared.compacted
      ? [
          {
            type: "step",
            id: `context-compaction-${row.id}`,
            kind: "info",
            title: `Context compacted: ${prepared.compacted} earlier messages summarized`,
            status: "done",
          },
        ]
      : prepared.warning
        ? [{ type: "step", id: `context-warning-${row.id}`, kind: "info", title: prepared.warning, status: "error" }]
        : [],
  });
  async function* watched(): AsyncGenerator<TurnEvent> {
    for await (const event of events) {
      if (event.type === "delta") text += event.text;
      if (event.type === "error") failure = event.message;
      yield event;
    }
  }
  try {
    const reader = recordTurn(turnEventsToSse(watched()), {
      threadId: thread.id,
      messageId: assistantId,
      onUsage: (usage) => {
        void recordAgentUsage({
          workspaceId: row.workspaceId,
          userId: row.userId,
          engine: "api",
          model: thread.model,
          source: "api",
          usage,
          runId: row.id,
          threadId: thread.id,
          messageId: assistantId,
          issueId: row.issueId,
          agentId: row.agentId,
          durationMs: Date.now() - started,
        });
      },
    }).getReader();
    while (!(await reader.read()).done) {
      /* record as it passes */
    }
  } finally {
    revokeAgentToolGrant(grant.token);
    apiAborts.delete(runId);
  }
  if (failure) {
    await failDelegation(runId, failure);
    return;
  }
  await finishRun(runId, "done");
  await completeDelegation(row, payload.agentName, detail.issue.identifier, text);
}

async function completeDelegation(row: RunRow, agentName: string, identifier: string, text: string): Promise<void> {
  // A cancelled run must not add a result after the fact, even if its stream ended cleanly.
  const [after] = await getDb().select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, row.id));
  if (after?.status === "cancelled") return;
  if (text.trim()) {
    await addComment(row.workspaceId, row.issueId!, text, { kind: "agent", label: agentName, via: "mcp" }, {
      exceptUser: row.userId,
    });
  }
  await getDb()
    .update(agentRuns)
    .set({ reviewStatus: "pending" })
    .where(eq(agentRuns.id, row.id));
  await setIssueDelegation(row.issueId!, { status: "review", runId: row.id });
  await recordEvent(row.issueId!, "agent_review_requested", { agent: agentName, identifier }, await agentActor(agentName));
  await notifyDelegation(row.workspaceId, row.issueId!, "delegation_review", agentName);
  await emitAutomationEvent({
    type: "agent.run_finished",
    workspaceId: row.workspaceId,
    issueId: row.issueId!,
    issueIdentifier: identifier,
    actorUserId: row.userId,
    actorName: agentName,
    data: { agentId: row.agentId, agentName, runId: row.id },
    idempotencyKey: `agent-run:${row.id}`,
  });
}

async function failDelegation(runId: string, message: string): Promise<void> {
  const row = await runRow(runId);
  if (!row) return;
  const [after] = await getDb().select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId));
  if (after?.status === "cancelled") return;
  await finishRun(runId, "failed", message);
  if (row.issueId) {
    await setIssueDelegation(row.issueId, { status: "failed", runId });
    await recordEvent(row.issueId, "agent_failed", { error: message.slice(0, 500) }, await agentActor("Agent"));
    await notifyDelegation(row.workspaceId, row.issueId, "delegation_failed", "Agent");
    await emitAutomationEvent({
      type: "agent.run_failed",
      workspaceId: row.workspaceId,
      issueId: row.issueId,
      actorUserId: row.userId,
      actorName: "Agent",
      data: { agentId: row.agentId, error: message.slice(0, 500), runId: row.id },
      idempotencyKey: `agent-run:${row.id}`,
    });
  }
}

// Compact token label for the task panel.
export function tokensLabel(usage: UsageTotals): string {
  return formatTokens(usage.totalTokens);
}

/** A delegated run that died with the server: mark the task, tell the humans, keep tokens. */
export async function noticeInterruptedDelegation(row: RunRow): Promise<void> {
  if (!row.issueId) return;
  await setIssueDelegation(row.issueId, { status: "failed", runId: row.id });
  await recordEvent(
    row.issueId,
    "agent_failed",
    { error: "The server restarted during this run" },
    await agentActor("Agent")
  );
  await emitAutomationEvent({
    type: "agent.run_failed",
    workspaceId: row.workspaceId,
    issueId: row.issueId,
    actorUserId: row.userId,
    actorName: "Agent",
    data: { agentId: row.agentId, error: "The server restarted during this run", runId: row.id },
    idempotencyKey: `agent-run:${row.id}`,
  });
  await notifyDelegation(row.workspaceId, row.issueId, "delegation_failed", "Agent");
}
