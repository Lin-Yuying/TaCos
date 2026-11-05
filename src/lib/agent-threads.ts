import { removePageAttachments } from "./attachments";
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentMessages, agentSteps, agentThreadFlags, agentThreads, issues, projects, users } from "@/db/schema";
import { claimIssue, listIssues, TacosError, type Status } from "./issues";

// Agent conversations are TaCos records, not browser state: a thread is bound to a
// project, carries its history and trajectory, and can be reopened from the Agent tab.
// Private threads stay with their author; shared ones are readable by every member.

export type AgentVisibility = "private" | "shared";
// ask: every write waits for a card; auto: only risky ones ask; full: nothing asks.
export type AgentApproval = "ask" | "auto" | "full";

export type AgentThread = {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  projectColor: string;
  title: string;
  engine: string;
  model: string;
  effort: string;
  approval: AgentApproval;
  visibility: AgentVisibility;
  createdBy: string;
  createdByName: string;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  // Per viewer: a shared thread can be pinned by one member and not by another.
  pinnedAt: string | null;
  unread: boolean;
  // team-2.3: who is running an Agent turn on this shared chat, if anyone.
  turnUserId: string | null;
  turnUserName: string | null;
};

export type AgentStepRecord = {
  id: string;
  kind: "command" | "file" | "tool" | "info" | "thinking";
  title: string;
  detail: string | null;
  status: "running" | "done" | "error" | "denied";
  createdAt: string;
};

export type AgentMessageRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  // H-COLLAB-09: the author of a user message in a shared chat.
  authorId: string | null;
  authorName: string | null;
  // True when the viewer wrote this user message.
  fromViewer: boolean;
  steps: AgentStepRecord[];
};

export type AgentThreadDetail = AgentThread & { messages: AgentMessageRecord[] };

const MAX_TITLE = 80;
const STALE_SHARED_TURN_MS = 35 * 60_000;


function asVisibility(value: unknown): AgentVisibility {
  return value === "shared" ? "shared" : "private";
}

function asApproval(value: unknown): AgentApproval {
  return value === "auto" || value === "full" ? value : "ask";
}

function asStepKind(value: string): AgentStepRecord["kind"] {
  return value === "command" || value === "file" || value === "tool" || value === "thinking" ? value : "info";
}

function asStepStatus(value: string): AgentStepRecord["status"] {
  return value === "done" || value === "error" || value === "denied" ? value : "running";
}

function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE ? `${flat.slice(0, MAX_TITLE - 1)}…` : flat;
}

function visibleTo(userId: string) {
  return or(eq(agentThreads.visibility, "shared"), eq(agentThreads.createdBy, userId));
}

// A session is the agent_threads row and its messages. The id is the session identity.
// engine / model / effort / approval are last-used turn prefs for the composer restore.
// A change to those prefs keeps the same session. New chat calls this and gets a new id.
export async function startAgentThread(input: {
  workspaceId: string;
  projectId: string;
  visibility: AgentVisibility;
  engine: string;
  // Empty means "use whatever the CLI is configured with" — the honest default when the
  // browser never picked a model.
  model?: string;
  effort?: string;
  approval?: AgentApproval;
  userId: string;
}): Promise<AgentThread> {
  const db = getDb();
  // An empty project id means "no project": a plain conversation over the whole workspace.
  const projectId = input.projectId.trim();
  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.workspaceId, input.workspaceId)))
      .limit(1);
    if (!project) throw new TacosError("Project not found", 404);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(agentThreads).values({
    id,
    workspaceId: input.workspaceId,
    projectId,
    title: "",
    engine: input.engine || "codex",
    model: (input.model ?? "").trim(),
    effort: (input.effort ?? "").trim(),
    approval: asApproval(input.approval),
    visibility: asVisibility(input.visibility),
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  });
  const thread = await getAgentThread(input.workspaceId, input.userId, id);
  if (!thread) throw new TacosError("Could not open the conversation", 500);
  return thread;
}

export async function listAgentThreads(
  workspaceId: string,
  userId: string,
  projectId?: string
): Promise<AgentThread[]> {
  const db = getDb();
  const conditions = [eq(agentThreads.workspaceId, workspaceId), visibleTo(userId)];
  if (projectId) conditions.push(eq(agentThreads.projectId, projectId));
  const rows = await db
    .select({
      thread: agentThreads,
      projectName: projects.name,
      projectKey: projects.key,
      projectColor: projects.color,
      authorName: users.displayName,
      pinnedAt: agentThreadFlags.pinnedAt,
      unread: agentThreadFlags.unread,
    })
    .from(agentThreads)
    .leftJoin(projects, eq(projects.id, agentThreads.projectId))
    .innerJoin(users, eq(users.id, agentThreads.createdBy))
    .leftJoin(
      agentThreadFlags,
      and(eq(agentThreadFlags.threadId, agentThreads.id), eq(agentThreadFlags.userId, userId))
    )
    .where(and(...conditions))
    .orderBy(desc(agentThreads.updatedAt))
    .limit(100);
  if (rows.length === 0) return [];
  const turnIds = [
    ...new Set(rows.map((row) => row.thread.turnUserId).filter((id): id is string => Boolean(id))),
  ];
  const turnNames = new Map<string, string>();
  if (turnIds.length) {
    for (const u of await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, turnIds))) {
      turnNames.set(u.id, u.name);
    }
  }
  const counts = await db
    .select({ threadId: agentMessages.threadId, id: agentMessages.id })
    .from(agentMessages)
    .where(
      inArray(
        agentMessages.threadId,
        rows.map((row) => row.thread.id)
      )
    );
  const countByThread = new Map<string, number>();
  for (const row of counts) {
    countByThread.set(row.threadId, (countByThread.get(row.threadId) ?? 0) + 1);
  }
  return rows.map(({ thread, ...rest }) =>
    threadRow(
      thread,
      {
        ...rest,
        turnUserId: thread.turnUserId ?? null,
        turnUserName: thread.turnUserId ? (turnNames.get(thread.turnUserId) ?? null) : null,
      },
      userId,
      countByThread.get(thread.id) ?? 0
    )
  );
}

function threadOnly(detail: AgentThreadDetail): AgentThread {
  const copy = { ...detail };
  delete (copy as Partial<AgentThreadDetail>).messages;
  return copy;
}

function threadRow(
  thread: typeof agentThreads.$inferSelect,
  meta: {
    projectName: string | null;
    projectKey: string | null;
    projectColor: string | null;
    authorName: string;
    pinnedAt: string | null;
    unread: number | null;
    turnUserId: string | null;
    turnUserName: string | null;
  },
  userId: string,
  messageCount: number
): AgentThread {
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    projectId: thread.projectId,
    projectName: meta.projectName ?? "",
    projectKey: meta.projectKey ?? "",
    projectColor: meta.projectColor ?? "",
    title: thread.title,
    engine: thread.engine,
    model: thread.model,
    effort: thread.effort,
    approval: asApproval(thread.approval),
    visibility: asVisibility(thread.visibility),
    createdBy: thread.createdBy,
    createdByName: meta.authorName,
    mine: thread.createdBy === userId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount,
    pinnedAt: meta.pinnedAt ?? null,
    unread: Boolean(meta.unread),
    turnUserId: meta.turnUserId ?? null,
    turnUserName: meta.turnUserName ?? null,
  };
}

// The viewer must still be able to read the thread; a private thread belongs to its author.
async function requireThreadRow(
  workspaceId: string,
  userId: string,
  threadId: string
): Promise<{ thread: AgentThread; messages: AgentMessageRecord[] }> {
  const db = getDb();
  const [row] = await db
    .select({
      thread: agentThreads,
      projectName: projects.name,
      projectKey: projects.key,
      projectColor: projects.color,
      authorName: users.displayName,
      pinnedAt: agentThreadFlags.pinnedAt,
      unread: agentThreadFlags.unread,
      turnUserId: agentThreads.turnUserId,
    })
    .from(agentThreads)
    .leftJoin(projects, eq(projects.id, agentThreads.projectId))
    .innerJoin(users, eq(users.id, agentThreads.createdBy))
    .leftJoin(
      agentThreadFlags,
      and(eq(agentThreadFlags.threadId, agentThreads.id), eq(agentThreadFlags.userId, userId))
    )
    .where(
      and(
        eq(agentThreads.id, threadId),
        eq(agentThreads.workspaceId, workspaceId),
        visibleTo(userId)
      )
    )
    .limit(1);
  if (!row) throw new TacosError("Conversation not found", 404);
  let turnUserName: string | null = null;
  if (row.turnUserId) {
    const [turnUser] = await db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.turnUserId))
      .limit(1);
    turnUserName = turnUser?.name ?? null;
  }

  const messages = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.threadId, threadId))
    .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
  const steps = await db
    .select()
    .from(agentSteps)
    .where(eq(agentSteps.threadId, threadId))
    .orderBy(asc(agentSteps.createdAt), asc(agentSteps.id));
  const stepsByMessage = new Map<string, AgentStepRecord[]>();
  for (const step of steps) {
    const list = stepsByMessage.get(step.messageId) ?? [];
    list.push({
      id: step.id,
      kind: asStepKind(step.kind),
      title: step.title,
      detail: step.detail ?? null,
      status: asStepStatus(step.status),
      createdAt: step.createdAt,
    });
    stepsByMessage.set(step.messageId, list);
  }
  const authorIds = [...new Set(messages.map((m) => m.authorId).filter((v): v is string => Boolean(v)))];
  const authors = new Map<string, string>();
  if (authorIds.length) {
    for (const u of await db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, authorIds))) {
      authors.set(u.id, u.name);
    }
  }
  return {
    thread: threadRow(
      row.thread,
      {
        projectName: row.projectName,
        projectKey: row.projectKey,
        projectColor: row.projectColor,
        authorName: row.authorName,
        pinnedAt: row.pinnedAt,
        unread: row.unread,
        turnUserId: row.turnUserId ?? null,
        turnUserName,
      },
      userId,
      messages.length
    ),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
      createdAt: message.createdAt,
      authorId: message.authorId ?? null,
      authorName: message.authorId ? (authors.get(message.authorId) ?? null) : null,
      fromViewer: (message.authorId ?? row.thread.createdBy) === userId,
      steps: stepsByMessage.get(message.id) ?? [],
    })),
  };
}

export async function getAgentThread(
  workspaceId: string,
  userId: string,
  threadId: string
): Promise<AgentThreadDetail> {
  const { thread, messages } = await requireThreadRow(workspaceId, userId, threadId);
  return { ...thread, messages };
}

export async function renameAgentThread(
  workspaceId: string,
  userId: string,
  threadId: string,
  title: string
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can rename this conversation", 403);
  const next = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  if (!next) throw new TacosError("Title cannot be empty");
  await getDb()
    .update(agentThreads)
    .set({ title: next, updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

export async function setAgentThreadVisibility(
  workspaceId: string,
  userId: string,
  threadId: string,
  visibility: AgentVisibility
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can share this conversation", 403);
  await getDb()
    .update(agentThreads)
    .set({ visibility: asVisibility(visibility), updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}


const MAX_MODEL = 200;

// Last-used model/effort for reopen UI. Does not create a session and does not lock the thread.
export async function setAgentThreadModel(
  workspaceId: string,
  userId: string,
  threadId: string,
  model: string,
  effort: string
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can change this conversation", 403);
  await getDb()
    .update(agentThreads)
    .set({
      model: model.trim().slice(0, MAX_MODEL),
      effort: effort.trim().slice(0, MAX_MODEL),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

export async function setAgentThreadApproval(
  workspaceId: string,
  userId: string,
  threadId: string,
  approval: AgentApproval
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can change this conversation", 403);
  await getDb()
    .update(agentThreads)
    .set({ approval: asApproval(approval), updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

// Rebinding a conversation is how the composer's project chip works: the next turn reads
// and writes whatever project the chip shows, so the old project is never touched again.
export async function setAgentThreadProject(
  workspaceId: string,
  userId: string,
  threadId: string,
  projectId: string
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can change this conversation", 403);
  const next = projectId.trim();
  if (next) {
    const [project] = await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(eq(projects.id, next), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt))
      )
      .limit(1);
    if (!project) throw new TacosError("Project not found", 404);
  }
  await getDb()
    .update(agentThreads)
    .set({
      projectId: next,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

// Pinning is a viewer preference, so anyone who can read the thread may set it — including
// on someone else's shared conversation.
export async function setAgentThreadPinned(
  workspaceId: string,
  userId: string,
  threadId: string,
  pinned: boolean
): Promise<AgentThread> {
  await requireThreadRow(workspaceId, userId, threadId);
  await getDb()
    .insert(agentThreadFlags)
    .values({ threadId, userId, pinnedAt: pinned ? new Date().toISOString() : null, unread: 0 })
    .onConflictDoUpdate({
      target: [agentThreadFlags.threadId, agentThreadFlags.userId],
      set: { pinnedAt: pinned ? new Date().toISOString() : null },
    });
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

export async function setAgentThreadUnread(
  workspaceId: string,
  userId: string,
  threadId: string,
  unread: boolean
): Promise<AgentThread> {
  await requireThreadRow(workspaceId, userId, threadId);
  const flag = unread ? 1 : 0;
  await getDb()
    .insert(agentThreadFlags)
    .values({ threadId, userId, pinnedAt: null, unread: flag })
    .onConflictDoUpdate({
      target: [agentThreadFlags.threadId, agentThreadFlags.userId],
      set: { unread: flag },
    });
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

export async function canSeeThread(workspaceId: string, userId: string, threadId: string): Promise<boolean> {
  return requireThreadRow(workspaceId, userId, threadId).then(
    () => true,
    () => false
  );
}

export async function deleteAgentThread(
  workspaceId: string,
  userId: string,
  threadId: string
): Promise<void> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can delete this conversation", 403);
  const db = getDb();
  await db.delete(agentSteps).where(eq(agentSteps.threadId, threadId));
  await db.delete(agentMessages).where(eq(agentMessages.threadId, threadId));
  await db.delete(agentThreadFlags).where(eq(agentThreadFlags.threadId, threadId));
  await db.delete(agentThreads).where(eq(agentThreads.id, threadId));
  await removePageAttachments([`thread:${threadId}`]);
}

// --- turn accounting -------------------------------------------------------

export type TurnThread = {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectKey: string;
  engine: string;
  model: string;
  effort: string;
  approval: AgentApproval;
  visibility: AgentVisibility;
  createdBy: string;
  focusIssueId: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
};

// What /api/ai/chat needs to run a turn: the binding and the history as it was stored.
// The browser does not get to rewrite its own past.
export async function loadThreadForTurn(
  workspaceId: string,
  userId: string,
  threadId: string,
  historyLimit = 30
): Promise<TurnThread> {
  const { thread, messages } = await requireThreadRow(workspaceId, userId, threadId);
  // H-COLLAB-09: in a chat with more than one writer, the model sees who wrote each message.
  const multi = messages.some((m) => m.authorId && m.authorId !== thread.createdBy);
  const history = messages
    .filter((message) => message.content.trim())
    .slice(-historyLimit)
    .map((message) => ({
      role: message.role,
      content:
        multi && message.role === "user" && message.authorName
          ? `${message.authorName}: ${message.content}`
          : message.content,
    }));
  return {
    id: thread.id,
    workspaceId: thread.workspaceId,
    projectId: thread.projectId,
    projectName: thread.projectName,
    projectKey: thread.projectKey,
    engine: thread.engine,
    model: thread.model,
    effort: thread.effort,
    // A collaborator does not get the owner's auto or full mode. Every write asks.
    approval: thread.createdBy === userId ? thread.approval : "ask",
    visibility: thread.visibility,
    createdBy: thread.createdBy,
    focusIssueId: await focusIssueOf(thread.id),
    messages: history,
  };
}

// team-2.3: a shared chat runs one Agent turn at a time for the whole workspace.
export async function claimSharedChatTurn(threadId: string, userId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_SHARED_TURN_MS).toISOString();
  const [row] = await db
    .select({ visibility: agentThreads.visibility })
    .from(agentThreads)
    .where(eq(agentThreads.id, threadId))
    .limit(1);
  if (!row || row.visibility !== "shared") return;

  // Clear a turn that stopped responding without releasing its lock.
  await db
    .update(agentThreads)
    .set({ turnUserId: null, turnStartedAt: null })
    .where(
      and(eq(agentThreads.id, threadId), lt(agentThreads.turnStartedAt, staleBefore))
    );

  const claimed = await db
    .update(agentThreads)
    .set({ turnUserId: userId, turnStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(agentThreads.id, threadId),
        eq(agentThreads.visibility, "shared"),
        or(isNull(agentThreads.turnUserId), lt(agentThreads.turnStartedAt, staleBefore))
      )
    );
  if (claimed.changes > 0) return;

  const [busy] = await db
    .select({ turnUserId: agentThreads.turnUserId })
    .from(agentThreads)
    .where(eq(agentThreads.id, threadId))
    .limit(1);
  let holder = "Someone else";
  if (busy?.turnUserId) {
    const [user] = await db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, busy.turnUserId))
      .limit(1);
    if (user?.name) holder = user.name;
  }
  throw new TacosError(`${holder} is using this shared chat`, 409, "Wait for their turn to finish, or fork from a message.");
}

export async function releaseSharedChatTurn(threadId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .update(agentThreads)
    .set({ turnUserId: null, turnStartedAt: null, updatedAt: now })
    .where(and(eq(agentThreads.id, threadId), eq(agentThreads.turnUserId, userId)));
}

/** Every turn ended with the process, so no shared chat may stay locked after a restart. */
export async function clearSharedChatTurns(): Promise<void> {
  await getDb()
    .update(agentThreads)
    .set({ turnUserId: null, turnStartedAt: null })
    .where(isNotNull(agentThreads.turnUserId));
}

// Copy everything up to and including one message into a new private chat; the source stays as it was.
export async function forkAgentThreadFromMessage(
  workspaceId: string,
  userId: string,
  threadId: string,
  messageId: string
): Promise<AgentThread> {
  const { thread, messages } = await requireThreadRow(workspaceId, userId, threadId);
  if (thread.visibility !== "shared") {
    throw new TacosError("Only a shared chat can be forked here", 400);
  }
  const end = messages.findIndex((message) => message.id === messageId);
  if (end < 0) throw new TacosError("Message not found", 404);
  const slice = messages.slice(0, end + 1);

  const fork = await startAgentThread({
    workspaceId,
    projectId: thread.projectId,
    visibility: "private",
    engine: thread.engine,
    model: thread.model,
    effort: thread.effort,
    approval: thread.approval,
    userId,
  });

  for (const message of slice) {
    const newMessageId = await appendAgentMessage({
      threadId: fork.id,
      role: message.role,
      content: message.content,
      authorId: message.role === "user" ? (message.authorId ?? userId) : undefined,
    });
    for (const step of message.steps) {
      await appendAgentStep({
        threadId: fork.id,
        messageId: newMessageId,
        kind: step.kind,
        title: step.title,
        detail: step.detail,
        status: step.status,
      });
    }
  }

  const titleBase = thread.title.trim() || "Shared chat";
  await getDb()
    .update(agentThreads)
    .set({ title: `Fork · ${titleBase}`.slice(0, MAX_TITLE), updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, fork.id));

  const opened = await getAgentThread(workspaceId, userId, fork.id);
  if (!opened) throw new TacosError("Could not open the conversation", 500);
  return threadOnly(opened);
}

export async function appendAgentMessage(input: {
  threadId: string;
  role: "user" | "assistant";
  content: string;
  authorId?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  const [last] = await db
    .select({ createdAt: agentMessages.createdAt })
    .from(agentMessages)
    .where(eq(agentMessages.threadId, input.threadId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);
  let createdAt = now;
  if (last?.createdAt && last.createdAt >= now) {
    createdAt = new Date(Date.parse(last.createdAt) + 1).toISOString();
  }
  await db.insert(agentMessages).values({
    id,
    threadId: input.threadId,
    role: input.role,
    content: input.content,
    authorId: input.role === "user" ? (input.authorId ?? null) : null,
    createdAt,
  });
  // The first question names the thread; later turns only bump ordering.
  const [thread] = await db
    .select({ title: agentThreads.title })
    .from(agentThreads)
    .where(eq(agentThreads.id, input.threadId))
    .limit(1);
  if (thread && !thread.title && input.role === "user") {
    await db
      .update(agentThreads)
      .set({ title: titleFrom(input.content), updatedAt: now })
      .where(eq(agentThreads.id, input.threadId));
  } else {
    await db
      .update(agentThreads)
      .set({ updatedAt: now })
      .where(eq(agentThreads.id, input.threadId));
  }
  return id;
}

export async function updateAgentMessage(messageId: string, content: string): Promise<void> {
  await getDb().update(agentMessages).set({ content }).where(eq(agentMessages.id, messageId));
}

// A turn that produced no text at all (provider error, immediate cancel) leaves no reply
// behind; an empty assistant bubble would just confuse the history.
export async function removeAgentMessage(messageId: string): Promise<void> {
  const db = getDb();
  await db.delete(agentSteps).where(eq(agentSteps.messageId, messageId));
  await db.delete(agentMessages).where(eq(agentMessages.id, messageId));
}

export async function appendAgentStep(input: {
  threadId: string;
  messageId: string;
  kind: AgentStepRecord["kind"];
  title: string;
  detail?: string | null;
  status?: AgentStepRecord["status"];
}): Promise<string> {
  const id = crypto.randomUUID();
  await getDb().insert(agentSteps).values({
    id,
    threadId: input.threadId,
    messageId: input.messageId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    status: input.status ?? "running",
    createdAt: new Date().toISOString(),
  });
  return id;
}

export async function finishAgentStep(
  stepId: string,
  status: AgentStepRecord["status"],
  detail?: string | null
): Promise<void> {
  await getDb()
    .update(agentSteps)
    .set({ status, ...(detail !== undefined ? { detail } : {}) })
    .where(eq(agentSteps.id, stepId));
}

// Server turn path: store the harness the composer sent for this turn as last-used.
// Never refuse a turn when the stored engine differs. Callers already authorize the thread.
export async function setThreadEngine(threadId: string, engine: string): Promise<void> {
  await getDb()
    .update(agentThreads)
    .set({ engine, updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, threadId));
}

// Composer path: author updates last-used harness without a new session.
export async function setAgentThreadEngine(
  workspaceId: string,
  userId: string,
  threadId: string,
  engine: string
): Promise<AgentThread> {
  const { thread } = await requireThreadRow(workspaceId, userId, threadId);
  if (!thread.mine) throw new TacosError("Only the author can change this conversation", 403);
  const next = engine.trim();
  if (!next) throw new TacosError("Pick a harness in the composer", 400);
  // Model ids belong to one harness, so a new harness starts on its own default.
  const pref = next === thread.engine ? {} : { model: "", effort: "" };
  await getDb()
    .update(agentThreads)
    .set({ engine: next, ...pref, updatedAt: new Date().toISOString() })
    .where(eq(agentThreads.id, threadId));
  return threadOnly(await getAgentThread(workspaceId, userId, threadId));
}

// H-COLLAB-07: a task and the chat that published it link to each other.
export type SourceThread = { id: string; title: string };

// The source chat of a task, or null when the viewer cannot read it (private, not theirs).
export async function getSourceThread(
  workspaceId: string,
  threadId: string,
  viewerId: string
): Promise<SourceThread | null> {
  const [row] = await getDb()
    .select({ id: agentThreads.id, title: agentThreads.title })
    .from(agentThreads)
    .where(and(eq(agentThreads.workspaceId, workspaceId), eq(agentThreads.id, threadId), visibleTo(viewerId)))
    .limit(1);
  return row ?? null;
}

export type ThreadTask = { id: string; identifier: string; title: string; status: Status };

// Tasks that a chat published. Task visibility rules apply to the viewer.
export async function listThreadTasks(
  workspaceId: string,
  threadId: string,
  viewerId: string
): Promise<ThreadTask[]> {
  const rows = await listIssues(workspaceId, { sourceThreadId: threadId, viewerId, status: "all", limit: 50 });
  const out = rows.map((r) => ({ id: r.id, identifier: r.identifier, title: r.title, status: r.status }));
  // H-COLLAB-08: a chat opened for a task also shows that task.
  const focus = await focusIssueOf(threadId);
  if (focus && !out.some((r) => r.id === focus)) {
    const [row] = await getDb()
      .select({ id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status })
      .from(issues)
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, focus)))
      .limit(1);
    if (row) out.unshift({ ...row, status: row.status as Status });
  }
  return out;
}

async function focusIssueOf(threadId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ focus: agentThreads.focusIssueId })
    .from(agentThreads)
    .where(eq(agentThreads.id, threadId))
    .limit(1);
  return row?.focus ?? null;
}

export function taskChatOpeningMessage(identifier: string): string {
  return `Work on task ${identifier}. Do what it asks, then say what you did and what is left.`;
}

export type TaskChatStart = {
  thread: AgentThread;
  /** First user turn for a task chat with no messages yet; null when it already has some. */
  openingMessage: string | null;
};

// H-COLLAB-08 / team-2.3: "Work on it in chat". Claims the task when nobody has it, then
// opens the user's chat for this task. A second click reopens the same chat without a new opening turn.
export async function startTaskChat(
  workspaceId: string,
  issueId: string,
  userId: string
): Promise<TaskChatStart> {
  const db = getDb();
  const [task] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), or(eq(issues.id, issueId), eq(issues.identifier, issueId))))
    .limit(1);
  if (!task) throw new TacosError("Task not found", 404);
  if (task.reviewStatus !== "approved") throw new TacosError("This task is waiting for review", 409);
  if (task.claimedBy && task.claimedBy !== userId) {
    throw new TacosError("Someone else already claimed this task", 409);
  }
  if (!task.claimedBy) await claimIssue(workspaceId, task.id, userId);

  const [existing] = await db
    .select({ id: agentThreads.id })
    .from(agentThreads)
    .where(
      and(
        eq(agentThreads.workspaceId, workspaceId),
        eq(agentThreads.focusIssueId, task.id),
        eq(agentThreads.createdBy, userId)
      )
    )
    .orderBy(desc(agentThreads.updatedAt))
    .limit(1);
  if (existing) {
    const thread = await getAgentThread(workspaceId, userId, existing.id);
    if (thread) {
      return {
        thread,
        openingMessage: thread.messages.length === 0 ? taskChatOpeningMessage(task.identifier) : null,
      };
    }
  }

  const thread = await startAgentThread({
    workspaceId,
    projectId: task.projectId,
    visibility: "private",
    engine: "codex",
    userId,
  });
  await db
    .update(agentThreads)
    .set({ focusIssueId: task.id, title: `${task.identifier} ${task.title}`.slice(0, 120) })
    .where(eq(agentThreads.id, thread.id));
  const opened = await getAgentThread(workspaceId, userId, thread.id);
  if (!opened) throw new TacosError("Could not open the conversation", 500);
  return { thread: opened, openingMessage: taskChatOpeningMessage(task.identifier) };
}
