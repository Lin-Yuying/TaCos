import { recordApiKeyUsage, pendingApiKeyUsage } from "./api-key-usage";
import { applyView, normalizeFieldValue, type FieldValues, type TaskField } from "./task-view";
import { parseStoredDefinition } from "./task-views";
import { TacosError } from "./tacos-error";
import { removeWorkspaceAttachments } from "./attachments";
import crypto from "node:crypto";
import { mentionText, parseMentions } from "./mentions";
import { parseNotificationData, type NotificationData } from "./notification-data";
import { NOTIFICATION_EVENT_GROUPS, prefGroupForType } from "./notification-constants";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  getTableColumns,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "../db/client";
import {
  apiKeys,
  blockers,
  comments,
  events,
  favorites,
  issueAssignees,
  issueDependencies,
  issueLabels,
  taskFieldValues,
  taskFields,
  taskViewSubscriptions,
  taskViews,
  issues,
  joinCodes,
  labels,
  notifications,
  notificationMutes,
  notificationPrefs,
  overviewComments,
  overviewDocEditViews,
  overviewDocEdits,
  projectGrants,
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
  pageAccess,
  pageCollab,
  pageComments,
  pageFavorites,
  pageVersions,
  pages,
} from "../db/schema";
import {
  LABEL_COLORS,
  PROJECT_COLORS,
  DEFAULT_PROJECT_COLOR,
  REMINDER_META,
  REMINDER_PRESETS,
  RECURRENCES,
  RECURRENCE_META,
  STATUS_ORDER,
  type Priority,
  type Recurrence,
  type ReminderPreset,
  type Status,
  type Via,
} from "./constants";

export { LABEL_COLORS, PRIORITY_NAMES, REMINDER_PRESETS, REMINDER_META, STATUS_ORDER, STATUS_META } from "./constants";
export type { Priority, ReminderPreset, Status, Via } from "./constants";

export { TacosError };

export type Label = { id: string; name: string; color: string };
export type Member = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  role: string;
};
export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  color: string;
  icon: string | null;
  description: string;
  createdBy: string | null;
};
export type Assignee = { id: string; username: string; displayName: string; avatar: string | null };

export type Issue = {
  id: string;
  number: number;
  identifier: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  projectId: string;
  parentId: string | null;
  projectKey: string;
  projectName: string;
  assignees: Assignee[];
  // YYYY-MM-DD, chosen from the calendar in the task panel
  dueDate: string | null;
  // Numeric planning estimate, or null when unsized (U-03 planning reads it).
  estimate: number | null;
  reminder: ReminderPreset | null;
  recurrence: Recurrence | null;
  // the person who opened it, or who ran the agent that published it
  createdBy: string | null;
  createdVia: Via;
  // H-COLLAB: claim, publisher, source chat and review gate
  claimedBy: string | null;
  claimedAt: string | null;
  publishedBy: string | null;
  sourceThreadId: string | null;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  // #79: delegation keeps the human assignees; this names the agent and its run state.
  delegatedAgentId: string | null;
  delegatedBy: string | null;
  delegatedAt: string | null;
  delegationStatus: string | null;
  delegationRunId: string | null;
  delegatedAgentName: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ReviewStatus = "approved" | "pending" | "rejected";
export type IssueWithLabels = Issue & { labels: Label[] };
export type Comment = {
  id: string;
  issueId: string;
  body: string;
  author: Assignee | null;
  agentAuthor: string | null;
  createdAt: string;
};
export type ActivityEvent = {
  id: string;
  issueId: string;
  type: string;
  data: Record<string, unknown>;
  actor: Assignee | null;
  agentActor: string | null;
  createdAt: string;
};
export type IssueChild = { id: string; identifier: string; title: string; status: Status };
export type TaskDependency = { id: string; identifier: string; title: string; status: Status };
export type IssueDetail = {
  issue: IssueWithLabels;
  comments: Comment[];
  events: ActivityEvent[];
  children: IssueChild[];
  dependencies: TaskDependency[];
  blocked: boolean;
};

type IssueRow = typeof issues.$inferSelect;

const STATUS_ALIASES: Record<string, Status> = {
  todo: "todo",
  "to do": "todo",
  backlog: "todo",
  open: "todo",
  in_progress: "in_progress",
  "in progress": "in_progress",
  inprogress: "in_progress",
  "in-progress": "in_progress",
  doing: "in_progress",
  started: "in_progress",
  done: "done",
  completed: "done",
  complete: "done",
  finished: "done",
  closed: "done",
  canceled: "canceled",
  cancelled: "canceled",
  cancel: "canceled",
};

const PRIORITY_ALIASES: Record<string, Priority> = {
  none: 0,
  no: 0,
  "no priority": 0,
  "0": 0,
  low: 1,
  "1": 1,
  medium: 2,
  normal: 2,
  "2": 2,
  high: 3,
  "3": 3,
  urgent: 4,
  critical: 4,
  "4": 4,
};

export function normalizeStatus(input: unknown): Status | null {
  if (typeof input !== "string") return null;
  return STATUS_ALIASES[input.trim().toLowerCase()] ?? null;
}

export function normalizePriority(input: unknown): Priority | null {
  if (typeof input === "number" && Number.isInteger(input) && input >= 0 && input <= 4) {
    return input as Priority;
  }
  if (typeof input === "string") {
    return PRIORITY_ALIASES[input.trim().toLowerCase()] ?? null;
  }
  return null;
}

export function nowIso() {
  return new Date().toISOString();
}

// --- workspaces / projects / members ---

export function normalizeKey(input: string): string | null {
  const key = input.trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{1,9}$/.test(key) ? key : null;
}

export async function createWorkspace(input: {
  name: string;
  key: string;
  adminUserId: string;
}): Promise<{ id: string; name: string; key: string; joinCode: string }> {
  const name = input.name.trim();
  if (!name) throw new TacosError("Workspace name is required");
  const key = normalizeKey(input.key);
  if (!key) {
    throw new TacosError(
      `Invalid workspace key "${input.key}"`,
      400,
      "Use 2-10 letters/digits, e.g. ACME — issues will be numbered ACME-1"
    );
  }
  const db = getDb();
  const existing = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.key, key)).limit(1);
  if (existing.length > 0) throw new TacosError(`Workspace key "${key}" is already taken`, 409);
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.insert(workspaces).values({ id, name, key, createdBy: input.adminUserId, createdAt: now });
  await db.insert(workspaceMembers).values({
    workspaceId: id,
    userId: input.adminUserId,
    role: "admin",
    createdAt: now,
  });
  const joinCode = generateJoinCode();
  await db.insert(joinCodes).values({
    id: crypto.randomUUID(),
    workspaceId: id,
    code: joinCode,
    createdBy: input.adminUserId,
    createdAt: now,
  });
  return { id, name, key, joinCode };
}

export function generateJoinCode(): string {
  return `TACOS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function joinWorkspace(input: {
  code: string;
  userId: string;
}): Promise<{ id: string; name: string; key: string }> {
  const code = input.code.trim().toUpperCase();
  const db = getDb();
  const [row] = await db
    .select({
      id: joinCodes.id,
      workspaceId: joinCodes.workspaceId,
      revokedAt: joinCodes.revokedAt,
      deletedAt: workspaces.deletedAt,
    })
    .from(joinCodes)
    .innerJoin(workspaces, eq(workspaces.id, joinCodes.workspaceId))
    .where(eq(joinCodes.code, code))
    .limit(1);
  if (!row || row.revokedAt || row.deletedAt) {
    throw new TacosError("Invalid join code", 404, "Ask a workspace admin for a fresh code");
  }
  const existing = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, row.workspaceId), eq(workspaceMembers.userId, input.userId)))
    .limit(1);
  if (existing.length > 0) {
    throw new TacosError("You are already a member of this workspace", 409);
  }
  await db.insert(workspaceMembers).values({
    workspaceId: row.workspaceId,
    userId: input.userId,
    role: "member",
    createdAt: nowIso(),
  });
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, row.workspaceId)).limit(1);
  return { id: ws.id, name: ws.name, key: ws.key };
}

// H-COLLAB-12: the invite link is /join/<active join code>. Null when the code is
// unknown, revoked, or its workspace is deleted.
export async function describeInvite(code: string): Promise<{ id: string; name: string } | null> {
  const [row] = await getDb()
    .select({ id: workspaces.id, name: workspaces.name, revokedAt: joinCodes.revokedAt, deletedAt: workspaces.deletedAt })
    .from(joinCodes)
    .innerJoin(workspaces, eq(workspaces.id, joinCodes.workspaceId))
    .where(eq(joinCodes.code, code.trim().toUpperCase()))
    .limit(1);
  if (!row || row.revokedAt || row.deletedAt) return null;
  return { id: row.id, name: row.name };
}

// H-COLLAB-12: an admin adds an existing account by user name ("@name" also works).
// The caller checks the admin role.
export async function inviteMember(
  workspaceId: string,
  who: string
): Promise<{ id: string; username: string; displayName: string }> {
  const username = who.trim().replace(/^@/, "").toLowerCase();
  if (!username) throw new TacosError("Enter a user name");
  const db = getDb();
  const [user] = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .limit(1);
  if (!user) throw new TacosError("No account with that user name", 404);
  const existing = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
    .limit(1);
  if (existing.length > 0) throw new TacosError("That person is already a member", 409);
  await db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role: "member", createdAt: nowIso() });
  return user;
}

// null resets the workspace to the built-in otter mark.
export async function setWorkspaceIcon(workspaceId: string, icon: string | null) {
  await getDb().update(workspaces).set({ icon }).where(eq(workspaces.id, workspaceId));
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt);
  return rows;
}

export async function resolveAssigneeId(workspaceId: string, value: string): Promise<string> {
  const members = await listMembers(workspaceId);
  const v = value.trim();
  const member = members.find(
    (m) => m.id === v || m.username === v.toLowerCase() || m.displayName === v
  );
  if (!member) {
    throw new TacosError(
      `No member "${value}". Members: ${members.map((m) => m.username).join(", ")}`,
      400,
      'Use a username from GET /api/v1/me (e.g. "sam"), a display name, or the member id'
    );
  }
  return member.id;
}

export async function resolveAssigneeIds(workspaceId: string, values: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const value of values) ids.push(await resolveAssigneeId(workspaceId, value));
  return ids;
}

export async function setMemberRole(workspaceId: string, userId: string, role: "admin" | "member") {
  const db = getDb();
  const [workspace] = await db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (workspace?.createdBy === userId && role !== "admin") {
    throw new TacosError("The workspace owner cannot be demoted", 403);
  }
  if (role === "member") {
    await assertNotLastAdmin(db, workspaceId, userId);
  }
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

async function clearAssignmentsInWorkspace(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  userId: string
) {
  await db.delete(issueAssignees).where(
    and(
      eq(issueAssignees.userId, userId),
      sql`EXISTS (SELECT 1 FROM issues WHERE issues.id = ${issueAssignees.issueId} AND issues.workspace_id = ${workspaceId})`
    )
  );
}

export async function removeMember(workspaceId: string, userId: string) {
  const db = getDb();
  const [workspace] = await db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (workspace?.createdBy === userId) {
    throw new TacosError("The workspace owner cannot be demoted", 403);
  }
  await assertNotLastAdmin(db, workspaceId, userId);
  await clearAssignmentsInWorkspace(db, workspaceId, userId);
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

// Walking away is the member's own decision: it drops their project rows and inbox
// entries in this workspace but leaves the board and the other members untouched.
export async function leaveWorkspace(workspaceId: string, userId: string) {
  const db = getDb();
  await assertNotLastAdmin(db, workspaceId, userId);
  const workspaceProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  if (workspaceProjects.length > 0) {
    const ids = workspaceProjects.map((row) => row.id);
    await db
      .delete(projectMembers)
      .where(and(inArray(projectMembers.projectId, ids), eq(projectMembers.userId, userId)));
    await db
      .delete(favorites)
      .where(and(inArray(favorites.projectId, ids), eq(favorites.userId, userId)));
  }
  await clearAssignmentsInWorkspace(db, workspaceId, userId);
  await db
    .delete(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, userId)));
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

const WORKSPACE_TRASH_DAYS = 30;

// Hard delete: only the 30-day sweep and an expired restore call this.
async function purgeWorkspaceData(_db:ReturnType<typeof getDb>,workspaceId:string){const {purgeWorkspaceRecords}=await import("./permanent-cleanup");await purgeWorkspaceRecords(workspaceId);}

// Deleting is the owner's call, so it is deliberately two-step: typing the word
// "confirmed" moves the team to their recycle bin, where it stays restorable for
// 30 days. Every other member is told that it happened.
export async function deleteWorkspace(workspaceId: string, userId: string, confirmation: string) {
  if (confirmation.trim() !== "confirmed") {
    throw new TacosError('Type "confirmed" to delete a workspace', 400);
  }
  const db = getDb();
  const [workspace] = await db
    .select({ name: workspaces.name, createdBy: workspaces.createdBy, deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new TacosError("Workspace not found", 404);
  if (workspace.createdBy !== userId) {
    throw new TacosError("Only the workspace owner can delete this workspace", 403);
  }
  if (workspace.deletedAt) throw new TacosError("This workspace is already in the recycle bin", 409);

  const [owner] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const notifiedAt = nowIso();
  for (const member of members) {
    if (member.userId === userId) continue;
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      workspaceId,
      userId: member.userId,
      // Workspace notices have no issue; the empty id keeps the column shape.
      issueId: "",
      type: "workspace_deleted",
      body: "",
      data: JSON.stringify({
        ownerName: owner?.displayName ?? "The owner",
        workspaceName: workspace.name,
      }),
      state: "unread",
      createdAt: notifiedAt,
    });
  }

  await db
    .update(workspaces)
    .set({ deletedAt: notifiedAt, deletedBy: userId })
    .where(eq(workspaces.id, workspaceId));
}

export type DeletedWorkspace = {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  deletedAt: string;
  daysLeft: number;
};

function workspaceDaysLeft(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.ceil((WORKSPACE_TRASH_DAYS * 86_400_000 - elapsed) / 86_400_000));
}

// The sweep is lazy: opening the recycle bin is what finally drops workspaces whose
// 30 days are up, so no background job has to run against the SQLite file.
export async function purgeExpiredWorkspaces(ownerId: string): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - WORKSPACE_TRASH_DAYS * 86_400_000).toISOString();
  const expired = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.createdBy, ownerId),
        isNotNull(workspaces.deletedAt),
        lt(workspaces.deletedAt, cutoff)
      )
    );
  for (const row of expired) {
    await purgeWorkspaceData(db, row.id);
  }
}

export async function listDeletedWorkspaces(ownerId: string): Promise<DeletedWorkspace[]> {
  await purgeExpiredWorkspaces(ownerId);
  const rows = await getDb()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      key: workspaces.key,
      icon: workspaces.icon,
      deletedAt: workspaces.deletedAt,
    })
    .from(workspaces)
    .where(and(eq(workspaces.createdBy, ownerId), isNotNull(workspaces.deletedAt)))
    .orderBy(sql`${workspaces.deletedAt} DESC`);
  return rows.flatMap((row) =>
    row.deletedAt
      ? [{ ...row, icon: row.icon ?? null, deletedAt: row.deletedAt, daysLeft: workspaceDaysLeft(row.deletedAt) }]
      : []
  );
}

export async function restoreWorkspace(workspaceId: string, userId: string): Promise<{ id: string }> {
  const db = getDb();
  const [workspace] = await db
    .select({ createdBy: workspaces.createdBy, deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace || !workspace.deletedAt) throw new TacosError("Workspace is not in the recycle bin", 404);
  if (workspace.createdBy !== userId) {
    throw new TacosError("Only the workspace owner can restore this workspace", 403);
  }
  if (workspaceDaysLeft(workspace.deletedAt) === 0) {
    await purgeWorkspaceData(db, workspaceId);
    throw new TacosError("The 30-day restore window for this workspace has passed", 410);
  }
  await db
    .update(workspaces)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(workspaces.id, workspaceId));
  // The deletion notices described a state that no longer applies.
  await db
    .delete(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted")));
  return { id: workspaceId };
}

async function assertNotLastAdmin(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  userId: string
) {
  const admins = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin"))
    );
  if (admins.length <= 1 && admins.some((admin) => admin.userId === userId)) {
    throw new TacosError("A workspace needs at least one admin", 400);
  }
}

export async function getJoinCode(workspaceId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ code: joinCodes.code })
    .from(joinCodes)
    .where(and(eq(joinCodes.workspaceId, workspaceId), isNull(joinCodes.revokedAt)))
    .limit(1);
  return row?.code ?? null;
}

export async function rotateJoinCode(workspaceId: string, actorUserId: string): Promise<string> {
  const db = getDb();
  await db
    .update(joinCodes)
    .set({ revokedAt: nowIso() })
    .where(and(eq(joinCodes.workspaceId, workspaceId), isNull(joinCodes.revokedAt)));
  const code = generateJoinCode();
  await db.insert(joinCodes).values({
    id: crypto.randomUUID(),
    workspaceId,
    code,
    createdBy: actorUserId,
    createdAt: nowIso(),
  });
  return code;
}

const projectColumns = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  name: projects.name,
  key: projects.key,
  color: projects.color,
  icon: projects.icon,
  description: projects.description,
  createdBy: projects.createdBy,
};

type WorkspaceFacts = { ownerId: string | null; seeAll: boolean; role: string | null };

async function workspaceFacts(
  workspaceId: string,
  viewerId?: string | null
): Promise<WorkspaceFacts> {
  const db = getDb();
  const [ws] = await db
    .select({ ownerId: workspaces.createdBy, seeAll: workspaces.membersSeeAllTasks })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new TacosError("Workspace not found", 404);
  let role: string | null = null;
  if (viewerId) {
    const [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, viewerId)
        )
      )
      .limit(1);
    role = membership?.role ?? null;
  }
  return { ownerId: ws.ownerId ?? null, seeAll: ws.seeAll === 1, role };
}

export async function getMembersSeeAllTasks(workspaceId: string): Promise<boolean> {
  return (await workspaceFacts(workspaceId)).seeAll;
}

export async function setMembersSeeAllTasks(workspaceId: string, enabled: boolean) {
  await getDb()
    .update(workspaces)
    .set({ membersSeeAllTasks: enabled ? 1 : 0 })
    .where(eq(workspaces.id, workspaceId));
}

// Agents (API keys/MCP) and workspace admins always see everything; when the owner
// closes the workspace-wide switch, a plain member is limited to projects they own
// or were added to.
export async function seesAllTasks(
  workspaceId: string,
  viewerId?: string | null
): Promise<boolean> {
  if (!viewerId) return true;
  const facts = await workspaceFacts(workspaceId, viewerId);
  return facts.seeAll || facts.ownerId === viewerId || (facts.role ?? "member") === "admin";
}

function ownProjectCondition(viewerId: string) {
  return sql`EXISTS (
    SELECT 1 FROM projects visible
    WHERE visible.id = ${projects.id} AND visible.deleted_at IS NULL AND (
      visible.created_by = ${viewerId} OR EXISTS (
        SELECT 1 FROM project_members visible_member
        WHERE visible_member.project_id = visible.id AND visible_member.user_id = ${viewerId}
      )
    )
  )`;
}

// Trash lists deleted projects, so ownProjectCondition's `deleted_at IS NULL`
// can never match here. Keep its ownership rule without that clause, so a
// member still sees and can restore projects they deleted themselves.
function ownTrashedProjectCondition(viewerId: string) {
  return sql`EXISTS (
    SELECT 1 FROM projects trashed
    WHERE trashed.id = ${projects.id} AND (
      trashed.created_by = ${viewerId} OR EXISTS (
        SELECT 1 FROM project_members trashed_member
        WHERE trashed_member.project_id = trashed.id AND trashed_member.user_id = ${viewerId}
      )
    )
  )`;
}

function ownIssueProjectCondition(viewerId: string) {
  return sql`EXISTS (
    SELECT 1 FROM projects visible
    WHERE visible.id = ${issues.projectId} AND visible.deleted_at IS NULL AND (
      visible.created_by = ${viewerId} OR EXISTS (
        SELECT 1 FROM project_members visible_member
        WHERE visible_member.project_id = visible.id AND visible_member.user_id = ${viewerId}
      )
    )
  )`;
}

export async function listProjects(workspaceId: string, viewerId?: string): Promise<Project[]> {
  const conditions = [eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)];
  if (viewerId && !(await seesAllTasks(workspaceId, viewerId))) {
    conditions.push(ownProjectCondition(viewerId));
  }
  return getDb()
    .select(projectColumns)
    .from(projects)
    .where(and(...conditions))
    .orderBy(projects.createdAt);
}

/** Writes obey the same rule as reads: a member outside a project cannot reach it by id. */
export async function assertSeesProject(workspaceId: string, idOrKey: string, viewerId: string): Promise<void> {
  if (await seesAllTasks(workspaceId, viewerId)) return;
  const row = await findProjectRow(workspaceId, idOrKey);
  // A missing project keeps the error of the operation that names it.
  if (row && !(await getProject(workspaceId, row.id, viewerId))) {
    throw new TacosError(`Project "${idOrKey}" not found`, 404);
  }
}

export async function assertSeesIssue(
  workspaceId: string,
  idOrIdentifier: string,
  viewerId?: string
): Promise<void> {
  if (await seesAllTasks(workspaceId, viewerId)) return;
  const live = await findIssueRow(workspaceId, idOrIdentifier);
  // Restoring and purging name a task that findIssueRow no longer returns.
  const [row] = live
    ? [live]
    : await getDb()
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, idOrIdentifier)))
        .limit(1);
  if (row && !(await getProject(workspaceId, row.projectId, viewerId))) {
    throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  }
}

export type TrashedProject = Project & { deletedAt: string; issueCount: number };

export async function listTrashedProjects(workspaceId: string, viewerId?: string): Promise<TrashedProject[]> {
  const conditions = [eq(projects.workspaceId, workspaceId), isNotNull(projects.deletedAt)];
  if (viewerId && !(await seesAllTasks(workspaceId, viewerId))) {
    conditions.push(ownTrashedProjectCondition(viewerId));
  }
  const rows = await getDb()
    .select({
      ...projectColumns,
      deletedAt: projects.deletedAt,
      issueCount: sql<number>`(SELECT COUNT(*) FROM issues WHERE issues.project_id = ${projects.id})`,
    })
    .from(projects)
    .where(and(...conditions))
    .orderBy(sql`${projects.deletedAt} DESC`);
  return rows.map((row) => ({ ...row, deletedAt: row.deletedAt!, issueCount: Number(row.issueCount) }));
}

export type TeamProject = Project & { role: "lead" | "member" };

// Projects the user created, plus projects holding an issue assigned to them or
// a comment they wrote — the "my projects" scope behind the sidebar's Projects list.
export async function listTeamProjects(workspaceId: string, userId: string): Promise<TeamProject[]> {
  const db = getDb();
  const [all, assigned, commented] = await Promise.all([
    db
      .select(projectColumns)
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
      .orderBy(projects.createdAt),
    db
      .select({ projectId: issues.projectId })
      .from(issues)
      .innerJoin(issueAssignees, eq(issueAssignees.issueId, issues.id))
      .where(
        and(
          eq(issues.workspaceId, workspaceId),
          eq(issueAssignees.userId, userId),
          isNull(issues.deletedAt)
        )
      ),
    db
      .select({ projectId: issues.projectId })
      .from(comments)
      .innerJoin(issues, eq(issues.id, comments.issueId))
      .where(and(eq(issues.workspaceId, workspaceId), eq(comments.authorId, userId))),
  ]);

  const involved = new Set([...assigned, ...commented].map((row) => row.projectId));
  const mine = all
    .filter((p) => p.createdBy === userId || involved.has(p.id))
    .map((p) => ({
      ...p,
      role: (p.createdBy === userId ? "lead" : "member") as TeamProject["role"],
    }));
  // Lead-first, otherwise creation order.
  return [...mine.filter((p) => p.role === "lead"), ...mine.filter((p) => p.role === "member")];
}

export type PersonProject = Project & { role: "owner" | "member" };

// A person's page shows the projects they created and the ones they were added to.
// A task or comment in a project they never joined is not the same thing as belonging
// to it, so unlike listTeamProjects this one asks project_members directly.
export async function listPersonProjects(
  workspaceId: string,
  userId: string
): Promise<PersonProject[]> {
  const rows = await getDb()
    .select({
      ...projectColumns,
      joined: sql<number>`EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = ${projects.id} AND pm.user_id = ${userId}
      )`,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
    .orderBy(projects.createdAt);
  return rows
    .filter((row) => row.createdBy === userId || Number(row.joined) === 1)
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      key: row.key,
      color: row.color,
      icon: row.icon,
      description: row.description,
      createdBy: row.createdBy,
      role: (row.createdBy === userId ? "owner" : "member") as PersonProject["role"],
    }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1));
}

// The sidebar's Favorites group: projects this user starred, newest star first.
// Trashed projects drop out of the list but keep their row, so un-trashing brings the
// star back.
export async function listFavoriteProjects(workspaceId: string, userId: string): Promise<Project[]> {
  const conditions = [
    eq(favorites.userId, userId),
    eq(projects.workspaceId, workspaceId),
    isNull(projects.deletedAt),
  ];
  // A star outlives access: unstar-raising still works, but the project stays hidden
  // while the owner keeps this member out of it.
  if (!(await seesAllTasks(workspaceId, userId))) {
    conditions.push(ownProjectCondition(userId));
  }
  return getDb()
    .select(projectColumns)
    .from(favorites)
    .innerJoin(projects, eq(projects.id, favorites.projectId))
    .where(and(...conditions))
    .orderBy(favorites.position,sql`${favorites.createdAt} DESC`);
}

export async function isFavoriteProject(workspaceId: string, userId: string, projectId: string) {
  const [row] = await getDb()
    .select({ projectId: favorites.projectId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.projectId, projectId)))
    .limit(1);
  return Boolean(row);
}

// Starring is one control, so the caller never has to know the current state: it
// returns what the star ended up on.
export async function toggleFavoriteProject(
  workspaceId: string,
  userId: string,
  projectId: string
): Promise<boolean> {
  const db = getDb();
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt)
      )
    )
    .limit(1);
  if (!project) throw new TacosError("Project not found", 404);

  const [existing] = await db
    .select({ projectId: favorites.projectId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.projectId, projectId)))
    .limit(1);

  if (existing) {
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.projectId, projectId)));
    return false;
  }
  await db.insert(favorites).values({ userId, projectId, createdAt: nowIso() });
  return true;
}

// Issue identifiers still need a short uppercase prefix, but the UI no longer asks for
// one: take up to three letters of the first word ("Mobile App" → MOB) and de-duplicate.
export function deriveProjectKey(name: string, taken: Iterable<string>): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word));
  const first = words[0] ?? "";
  const letters = (first.length >= 2 ? first : words.map((word) => word[0]).join("")).slice(0, 3);
  const base = /^[A-Z][A-Z0-9]$/.test(letters.slice(0, 2)) ? letters : "PRJ";
  const used = new Set(taken);
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}${n}`;
  return key;
}

// `createdBy` is null when an agent creates a project with no signed-in person behind
// it (the local stdio MCP server). Such a project has no lead; the workspace owner can
// still trash it.
export async function createProject(input: {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string | null;
}): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new TacosError("Project name is required");
  const db = getDb();
  const siblings = await db
    .select({ key: projects.key, color: projects.color })
    .from(projects)
    .where(eq(projects.workspaceId, input.workspaceId));

  // Least-used palette entry wins, so a workspace of many projects stays colourful
  // rather than repeating one hue.
  let color = PROJECT_COLORS[0];
  let colorCount = Number.MAX_SAFE_INTEGER;
  const counts = new Map<string, number>();
  for (const sibling of siblings) {
    counts.set(sibling.color, (counts.get(sibling.color) ?? 0) + 1);
  }
  for (const option of PROJECT_COLORS) {
    const used = counts.get(option) ?? 0;
    if (used < colorCount) {
      color = option;
      colorCount = used;
    }
  }

  const record = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    name,
    key: deriveProjectKey(name, siblings.map((sibling) => sibling.key)),
    color,
    icon: null,
    description: (input.description ?? "").trim().slice(0, 500),
    createdBy: input.createdBy,
    createdAt: nowIso(),
  };
  await db.insert(projects).values(record);
  return record;
}

// Deleting is reversible: the project (and with it its issues) leaves every list
// until it is restored or purged from the trash. Only the person who made the
// project gets to decide that — everyone else can still work in it.
// The project's creator, or the workspace owner, may delete it. The owner already
// answers for the whole team, so a project left behind by a member must not become a
// row in Trash that nobody can ever clear.
async function assertProjectOwner(workspaceId: string, projectId: string, userId: string) {
  const project = await findProjectById(workspaceId, projectId);
  if (!project) throw new TacosError("Project not found", 404);
  if (project.createdBy === userId) return;
  const [workspace] = await getDb()
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (workspace?.createdBy === userId) return;
  throw new TacosError("Only the project creator or the workspace owner can delete this project", 403);
}

export async function trashProject(workspaceId: string, projectId: string, userId: string) {
  await assertProjectOwner(workspaceId, projectId, userId);
  await getDb()
    .update(projects)
    .set({ deletedAt: nowIso() })
    .where(
      and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId), isNull(projects.deletedAt))
    );
}

export async function restoreProject(workspaceId: string, projectId: string, userId: string) {
  await assertProjectOwner(workspaceId, projectId, userId);
  const db=getDb();
  db.transaction(()=>{
  const cleanup=db.$client.prepare("SELECT id FROM maintenance_jobs WHERE id=? AND (state='running' OR completed>0)").get(`project:${projectId}`);
  if(cleanup)throw new TacosError("Permanent cleanup has started. This project can no longer be restored.",409);
  db.update(projects).set({deletedAt:null}).where(and(eq(projects.workspaceId,workspaceId),eq(projects.id,projectId))).run();
  });

}

// The identifier prefix stays put, so "TEST-3" keeps its number across a rename.
export async function updateProject(
  workspaceId: string,
  projectId: string,
  patch: { name?: string; description?: string; doc?: string; color?: string; icon?: string | null },
  viewerId?: string,
  opts?: { forceNewHistory?: boolean }
): Promise<Project> {
  const next: Partial<typeof projects.$inferInsert> = {};
  let docEdit: { before: string; after: string } | null = null;
  if (patch.name != null) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new TacosError("Project name is required");
    if (trimmed.length > 50) throw new TacosError("Project name must be at most 50 characters");
    next.name = trimmed;
  }
  if (patch.description != null) {
    next.description = patch.description.trim().slice(0, 500);
  }
  if (patch.doc != null) {
    // The Overview document is gated separately from the project itself: only the
    // creator, a workspace admin, or a grant holder with "edit" may rewrite it.
    if (viewerId) {
      const access = await getOverviewAccess(workspaceId, projectId, viewerId);
      if (!access.canEdit) throw new TacosError("You cannot edit this project overview", 403);
    }
    if (patch.doc.length > 50_000) throw new TacosError("Document is too long (50k characters max)");
    const [current] = await getDb()
      .select({ doc: projects.doc })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
      .limit(1);
    const before = current?.doc ?? "";
    if (patch.doc !== before) {
      next.doc = patch.doc;
      docEdit = { before, after: patch.doc };
    }
  }
  if (patch.color != null) {
    if (!PROJECT_COLORS.includes(patch.color)) throw new TacosError("Unknown project color");
    next.color = patch.color;
  }
  if (patch.icon !== undefined) {
    // Same rule as a document's page icon: one emoji, or null to fall back to the cube.
    const icon = patch.icon?.trim() ?? "";
    if (icon.length > 8) throw new TacosError("Pick a single emoji as the project icon");
    next.icon = icon || null;
  }
  if (Object.keys(next).length === 0) {
    const unchanged = await findProjectById(workspaceId, projectId);
    if (!unchanged) throw new TacosError("Project not found", 404);
    return unchanged;
  }
  const db = getDb();
  await db
    .update(projects)
    .set(next)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
  if (docEdit && viewerId) {
    try {
      await recordDocEdit(projectId, viewerId, docEdit.before, docEdit.after, opts?.forceNewHistory);
    } catch (err) {
      // History must never block the document save itself.
      console.error("[updateProject] failed to record doc edit:", err);
    }
  }
  const updated = await findProjectById(workspaceId, projectId);
  if (!updated) throw new TacosError("Project not found", 404);
  return updated;
}

async function findProjectById(workspaceId: string, projectId: string): Promise<Project | null> {
  const [row] = await getDb()
    .select(projectColumns)
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)))
    .limit(1);
  return row ?? null;
}

// --- project Overview access ---

export type OverviewRole = "view" | "comment" | "edit";

export type OverviewAccess = {
  canView: boolean;
  canComment: boolean;
  canEdit: boolean;
  // Who may hand the Overview to somebody else: the project creator and workspace admins.
  manage: boolean;
  role: OverviewRole | null;
};

const NO_OVERVIEW_ACCESS: OverviewAccess = {
  canView: false,
  canComment: false,
  canEdit: false,
  manage: false,
  role: null,
};

export async function getOverviewAccess(
  workspaceId: string,
  projectId: string,
  viewerId: string
): Promise<OverviewAccess> {
  const project = await findProjectRow(workspaceId, projectId);
  if (!project) return NO_OVERVIEW_ACCESS;
  const facts = await workspaceFacts(workspaceId, viewerId);
  if (
    project.createdBy === viewerId ||
    facts.ownerId === viewerId ||
    facts.role === "admin"
  ) {
    return { canView: true, canComment: true, canEdit: true, manage: true, role: "edit" };
  }
  const [grant] = await getDb()
    .select({ role: projectGrants.role })
    .from(projectGrants)
    .where(and(eq(projectGrants.projectId, projectId), eq(projectGrants.userId, viewerId)))
    .limit(1);
  if (!grant) return NO_OVERVIEW_ACCESS;
  const role = normalizeOverviewRole(grant.role);
  return {
    canView: true,
    canComment: role !== "view",
    canEdit: role === "edit",
    manage: false,
    role,
  };
}

function normalizeOverviewRole(stored: string): OverviewRole {
  return stored === "edit" ? "edit" : stored === "view" ? "view" : "comment";
}

export type OverviewGrant = {
  userId: string;
  displayName: string;
  avatar: string | null;
  role: OverviewRole;
};

export async function listOverviewGrants(
  workspaceId: string,
  projectId: string
): Promise<OverviewGrant[]> {
  const rows = await getDb()
    .select({
      userId: projectGrants.userId,
      displayName: users.displayName,
      avatar: users.avatar,
      role: projectGrants.role,
    })
    .from(projectGrants)
    .innerJoin(users, eq(users.id, projectGrants.userId))
    .where(eq(projectGrants.projectId, projectId))
    .orderBy(projectGrants.createdAt);
  return rows.map((row) => ({
    ...row,
    role: normalizeOverviewRole(row.role),
  }));
}

export async function setOverviewGrant(
  workspaceId: string,
  projectId: string,
  actorId: string,
  userId: string,
  role: OverviewRole
) {
  const access = await getOverviewAccess(workspaceId, projectId, actorId);
  if (!access.manage) throw new TacosError("Only the project owner can share the overview", 403);
  if (role !== "view" && role !== "comment" && role !== "edit") {
    throw new TacosError("Unknown permission");
  }
  const project = await findProjectRow(workspaceId, projectId);
  if (!project) throw new TacosError("Project not found", 404);
  if (project.createdBy === userId) return;
  const [membership] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  if (!membership) throw new TacosError("Only workspace members can be invited to the overview");
  await getDb()
    .insert(projectGrants)
    .values({ projectId, userId, role, createdAt: nowIso() })
    .onConflictDoUpdate({ target: [projectGrants.projectId, projectGrants.userId], set: { role } });
}

export async function removeOverviewGrant(
  workspaceId: string,
  projectId: string,
  actorId: string,
  userId: string
) {
  const access = await getOverviewAccess(workspaceId, projectId, actorId);
  if (!access.manage) throw new TacosError("Only the project owner can change access", 403);
  await getDb()
    .delete(projectGrants)
    .where(and(eq(projectGrants.projectId, projectId), eq(projectGrants.userId, userId)));
}

export type OverviewComment = {
  id: string;
  body: string;
  createdAt: string;
  quote: string | null;
  occurrence: number;
  author: Assignee | null;
};

export async function listOverviewComments(
  workspaceId: string,
  projectId: string
): Promise<OverviewComment[]> {
  const rows = await getDb()
    .select({
      id: overviewComments.id,
      body: overviewComments.body,
      createdAt: overviewComments.createdAt,
      quote: overviewComments.quote,
      occurrence: overviewComments.occurrence,
      authorId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(overviewComments)
    .leftJoin(users, eq(users.id, overviewComments.authorId))
    .where(eq(overviewComments.projectId, projectId))
    .orderBy(overviewComments.createdAt);
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    quote: row.quote ?? null,
    occurrence: row.occurrence ?? 1,
    author: row.authorId
      ? {
          id: row.authorId,
          username: row.username ?? "",
          displayName: row.displayName ?? "",
          avatar: row.avatar ?? null,
        }
      : null,
  }));
}

export async function addOverviewComment(
  workspaceId: string,
  projectId: string,
  viewerId: string,
  body: string,
  anchor?: { quote: string; occurrence: number }
): Promise<OverviewComment[]> {
  const access = await getOverviewAccess(workspaceId, projectId, viewerId);
  if (!access.canComment) throw new TacosError("You cannot comment on this overview", 403);
  const text = body.trim();
  if (!text) throw new TacosError("Comment cannot be empty");
  if (text.length > 5_000) throw new TacosError("Comment is too long (5k characters max)");
  const quote = anchor?.quote.trim() ?? "";
  await getDb().insert(overviewComments).values({
    id: crypto.randomUUID(),
    projectId,
    authorId: viewerId,
    body: text,
    quote: quote ? quote.slice(0, 1_000) : null,
    occurrence: quote ? Math.max(1, Math.floor(anchor?.occurrence ?? 1)) : 1,
    createdAt: nowIso(),
  });
  return listOverviewComments(workspaceId, projectId);
}

export async function removeOverviewComment(
  workspaceId: string,
  projectId: string,
  viewerId: string,
  commentId: string
): Promise<OverviewComment[]> {
  const access = await getOverviewAccess(workspaceId, projectId, viewerId);
  const [row] = await getDb()
    .select({ projectId: overviewComments.projectId, authorId: overviewComments.authorId })
    .from(overviewComments)
    .where(eq(overviewComments.id, commentId))
    .limit(1);
  if (!row || row.projectId !== projectId) throw new TacosError("Comment not found", 404);
  // The author can take back their own words; managing the overview covers everyone else's.
  if (row.authorId !== viewerId && !access.manage) {
    throw new TacosError("You cannot delete this comment", 403);
  }
  await getDb().delete(overviewComments).where(eq(overviewComments.id, commentId));
  return listOverviewComments(workspaceId, projectId);
}

// --- Overview edit history ---

export type OverviewDocEdit = {
  id: string;
  createdAt: string;
  added: number;
  removed: number;
  // Concrete lines for the History panel, clipped so a giant rewrite does not ship the
  // whole document to the browser. `added`/`removed` keep the real totals.
  addedLines: string[];
  removedLines: string[];
  author: Assignee | null;
};

// Edits by the same author within a few minutes are folded into one row so a typing
// session reads as a single History entry instead of one per debounce save.
async function recordDocEdit(
  projectId: string,
  userId: string,
  before: string,
  after: string,
  forceNew = false
) {
  const db = getDb();
  const now = nowIso();
  const [latest] = await db
    .select({ id: overviewDocEdits.id, userId: overviewDocEdits.userId, createdAt: overviewDocEdits.createdAt })
    .from(overviewDocEdits)
    .where(eq(overviewDocEdits.projectId, projectId))
    .orderBy(desc(overviewDocEdits.createdAt))
    .limit(1);
  const isSameSession =
    !forceNew &&
    latest &&
    latest.userId === userId &&
    Date.parse(now) - Date.parse(latest.createdAt) < 5 * 60_000;
  if (isSameSession) {
    await db
      .update(overviewDocEdits)
      .set({ docAfter: after, createdAt: now })
      .where(eq(overviewDocEdits.id, latest.id));
  } else {
    await db.insert(overviewDocEdits).values({
      id: crypto.randomUUID(),
      projectId,
      userId,
      docBefore: before,
      docAfter: after,
      createdAt: now,
    });
  }
  // Keep only the newest 100 rows per project. (Bare `OFFSET` is not valid SQLite —
  // it needs a LIMIT — so pick the keepers and delete the rest.)
  const keep = await db
    .select({ id: overviewDocEdits.id })
    .from(overviewDocEdits)
    .where(eq(overviewDocEdits.projectId, projectId))
    .orderBy(desc(overviewDocEdits.createdAt))
    .limit(100);
  if (keep.length >= 100) {
    await db
      .delete(overviewDocEdits)
      .where(
        and(
          eq(overviewDocEdits.projectId, projectId),
          notInArray(overviewDocEdits.id, keep.map((row) => row.id))
        )
      );
  }
}

// Multiset line compare: good enough for a "±N lines" history badge, and it doesn't
// care about reordering the way a sequential diff would.
const MAX_DIFF_LINES = 8;
const MAX_DIFF_LINE_CHARS = 160;

function lineDiff(before: string, after: string): {
  added: number;
  removed: number;
  addedLines: string[];
  removedLines: string[];
} {
  const tally = (doc: string) => {
    const counts = new Map<string, number>();
    for (const line of doc.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const a = tally(before);
  const b = tally(after);
  // Lines that occur more often on one side than the other are the changed ones. Walking
  // in document order keeps the panel's diff readable.
  const extra = (lines: string[], other: Map<string, number>) => {
    const seen = new Map<string, number>();
    const out: string[] = [];
    for (const line of lines) {
      const n = (seen.get(line) ?? 0) + 1;
      seen.set(line, n);
      if (n > (other.get(line) ?? 0)) out.push(line);
    }
    return out;
  };
  const clip = (lines: string[]) =>
    lines
      .slice(0, MAX_DIFF_LINES)
      .map((line) => (line.length > MAX_DIFF_LINE_CHARS ? `${line.slice(0, MAX_DIFF_LINE_CHARS - 1)}…` : line));
  const addedLines = extra(after.split("\n"), a);
  const removedLines = extra(before.split("\n"), b);
  return {
    added: addedLines.length,
    removed: removedLines.length,
    addedLines: clip(addedLines),
    removedLines: clip(removedLines),
  };
}

export async function listOverviewDocEdits(
  workspaceId: string,
  projectId: string
): Promise<OverviewDocEdit[]> {
  const rows = await getDb()
    .select({
      id: overviewDocEdits.id,
      docBefore: overviewDocEdits.docBefore,
      docAfter: overviewDocEdits.docAfter,
      createdAt: overviewDocEdits.createdAt,
      authorId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(overviewDocEdits)
    .leftJoin(users, eq(users.id, overviewDocEdits.userId))
    .where(eq(overviewDocEdits.projectId, projectId))
    .orderBy(desc(overviewDocEdits.createdAt))
    .limit(100);
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    ...lineDiff(row.docBefore, row.docAfter),
    author: row.authorId
      ? {
          id: row.authorId,
          username: row.username ?? "",
          displayName: row.displayName ?? "",
          avatar: row.avatar ?? null,
        }
      : null,
  }));
}

// Undo an entry by writing its "before" text back as a new edit. It goes through the
// normal update path, so the same canEdit check and history recording apply.
export async function restoreOverviewDocEdit(
  workspaceId: string,
  projectId: string,
  editId: string,
  viewerId: string
): Promise<string> {
  const [row] = await getDb()
    .select({ docBefore: overviewDocEdits.docBefore })
    .from(overviewDocEdits)
    .where(and(eq(overviewDocEdits.projectId, projectId), eq(overviewDocEdits.id, editId)))
    .limit(1);
  if (!row) throw new TacosError("History entry not found", 404);
  await updateProject(workspaceId, projectId, { doc: row.docBefore }, viewerId, {
    // A restore is its own act, not more typing: keep it visible in the list even when
    // the same person edited a moment ago.
    forceNewHistory: true,
  });
  return row.docBefore;
}

export async function markDocEditsSeen(projectId: string, userId: string): Promise<void> {
  const now = nowIso();
  await getDb()
    .insert(overviewDocEditViews)
    .values({ projectId, userId, seenAt: now })
    .onConflictDoUpdate({
      target: [overviewDocEditViews.projectId, overviewDocEditViews.userId],
      set: { seenAt: now },
    });
}

// Others' edits made since this viewer last opened History; no row yet means they have
// never looked, so everything by other people is new to them.
export async function countUnseenDocEdits(projectId: string, userId: string): Promise<number> {
  const db = getDb();
  const [view] = await db
    .select({ seenAt: overviewDocEditViews.seenAt })
    .from(overviewDocEditViews)
    .where(and(eq(overviewDocEditViews.projectId, projectId), eq(overviewDocEditViews.userId, userId)))
    .limit(1);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(overviewDocEdits)
    .where(
      and(
        eq(overviewDocEdits.projectId, projectId),
        ne(overviewDocEdits.userId, userId),
        view ? gt(overviewDocEdits.createdAt, view.seenAt) : undefined
      )
    );
  return Number(row?.n ?? 0);
}

export type ProjectMember = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  role: "lead" | "member";
};

// The creator is always the lead and is listed first — the UI never offers a way to
// drop them. Everyone else joined on purpose and can leave again.
export async function listProjectMembers(
  workspaceId: string,
  projectId: string
): Promise<ProjectMember[]> {
  const db = getDb();
  const project = await getProject(workspaceId, projectId);
  const joined = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);

  const members = joined.map((row) => ({ ...row, role: "member" as const }));
  if (!project?.createdBy) return members;

  const [lead] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(users)
    .where(eq(users.id, project.createdBy))
    .limit(1);
  if (!lead) return members;
  return [{ ...lead, role: "lead" as const }, ...members.filter((m) => m.id !== lead.id)];
}

export async function addProjectMember(workspaceId: string, projectId: string, userId: string) {
  const db = getDb();
  const project = await getProject(workspaceId, projectId);
  if (!project) throw new TacosError("Project not found", 404);
  const [membership] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!membership) throw new TacosError("Only workspace members can join a project");
  if (project.createdBy === userId) return;
  await db
    .insert(projectMembers)
    .values({ projectId, userId, createdAt: nowIso() })
    .onConflictDoNothing();
}

export async function removeProjectMember(
  workspaceId: string,
  projectId: string,
  userId: string
) {
  const db = getDb();
  const project = await getProject(workspaceId, projectId);
  if (!project) throw new TacosError("Project not found", 404);
  if (project.createdBy === userId) throw new TacosError("The project lead cannot be removed");
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
}

export async function purgeProject(workspaceId: string, projectId: string, userId: string) {
  await assertProjectOwner(workspaceId,projectId,userId);
  const {purgeProjectRecords}=await import("./permanent-cleanup");await purgeProjectRecords(workspaceId,projectId);
}

type ProjectRow = typeof projects.$inferSelect;

async function findProjectRow(workspaceId: string, idOrKey: string): Promise<ProjectRow | null> {
  const raw = idOrKey.trim();
  const db = getDb();
  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        or(eq(projects.id, raw), sql`${projects.key} = ${raw.toUpperCase()} COLLATE NOCASE`)
      )
    )
    .limit(1);
  return row ?? null;
}

// Accepts either the project id or its identifier prefix, same as the issue lookups.
export async function getProject(
  workspaceId: string,
  idOrKey: string,
  viewerId?: string
): Promise<(Project & { doc: string }) | null> {
  const row = await findProjectRow(workspaceId, idOrKey);
  if (!row) return null;
  if (viewerId && !(await seesAllTasks(workspaceId, viewerId))) {
    const visible = await listProjects(workspaceId, viewerId);
    if (!visible.some((project) => project.id === row.id)) return null;
  }
  const { id, workspaceId: ws, name, key, color, icon, description, doc, createdBy } = row;
  return {
    id,
    workspaceId: ws,
    name,
    key,
    color,
    icon,
    description,
    doc,
    createdBy: createdBy ?? null,
  };
}

// --- labels ---

export async function listLabels(workspaceId: string): Promise<Label[]> {
  return getDb()
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(labels.name);
}

export async function listLabelsWithCounts(workspaceId: string): Promise<Array<Label & { issueCount: number }>> {
  const rows = await getDb()
    .select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
      issueCount: sql<number>`(SELECT COUNT(*) FROM issue_labels INNER JOIN issues ON issues.id = issue_labels.issue_id WHERE issue_labels.label_id = ${labels.id})`,
    })
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(labels.name);
  return rows.map((row) => ({ ...row, issueCount: Number(row.issueCount) }));
}

export async function createLabel(workspaceId: string, input: { name: string; color?: string }): Promise<Label> {
  const name = input.name.trim();
  if (!name) throw new TacosError("Label name is required");
  if (name.length > 50) throw new TacosError("Label name must be at most 50 characters");
  let color = input.color?.trim();
  if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new TacosError(`Invalid color "${color}"`, 400, "Use a hex color like #5e6ad2");
  }
  const db = getDb();
  const existing = await db
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), sql`${labels.name} = ${name} COLLATE NOCASE`))
    .limit(1);
  if (existing.length > 0) {
    throw new TacosError(`Label "${name}" already exists`, 409);
  }
  if (!color) {
    const count = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(labels)
      .where(eq(labels.workspaceId, workspaceId));
    color = LABEL_COLORS[(count[0]?.n ?? 0) % LABEL_COLORS.length];
  }
  const record = { id: crypto.randomUUID(), workspaceId, name, color, createdAt: nowIso() };
  await db.insert(labels).values(record);
  return { id: record.id, name, color };
}

export async function deleteLabel(workspaceId: string, id: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.id, id), eq(labels.workspaceId, workspaceId)))
    .limit(1);
  if (!row) throw new TacosError("Label not found", 404);
  await db.delete(issueLabels).where(eq(issueLabels.labelId, id));
  await db.delete(labels).where(eq(labels.id, id));
}

async function getOrCreateLabels(workspaceId: string, names: string[]): Promise<Label[]> {
  const unique: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!unique.some((u) => u.toLowerCase() === trimmed.toLowerCase())) unique.push(trimmed);
  }
  const result: Label[] = [];
  for (const name of unique) {
    const [existing] = await getDb()
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), sql`${labels.name} = ${name} COLLATE NOCASE`))
      .limit(1);
    if (existing) {
      result.push(existing);
      continue;
    }
    result.push(await createLabel(workspaceId, { name }));
  }
  return result;
}

// --- issues ---

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function projectsById(workspaceId: string): Promise<Map<string, Project>> {
  const rows = await listProjects(workspaceId);
  return new Map(rows.map((row) => [row.id, row]));
}

async function membersById(workspaceId: string): Promise<Map<string, Assignee>> {
  const rows = await listMembers(workspaceId);
  return new Map<string, Assignee>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        avatar: row.avatar,
      },
    ])
  );
}

async function toIssueRows(workspaceId: string, rows: IssueRow[]): Promise<IssueWithLabels[]> {
  if (rows.length === 0) return [];
  if(rows.length>500){const out:IssueWithLabels[]=[];for(let at=0;at<rows.length;at+=500)out.push(...await toIssueRows(workspaceId,rows.slice(at,at+500)));return out;}
  const db = getDb();
  const [projectMap, memberMap] = await Promise.all([
    projectsById(workspaceId),
    membersById(workspaceId),
  ]);
  const ids = rows.map((r) => r.id);
  const [joins, assignmentRows] = await Promise.all([
    db
      .select({
        issueId: issueLabels.issueId,
        id: labels.id,
        name: labels.name,
        color: labels.color,
      })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, ids)),
    db
      .select({ issueId: issueAssignees.issueId, userId: issueAssignees.userId })
      .from(issueAssignees)
      .where(inArray(issueAssignees.issueId, ids)),
  ]);
  const byIssue = new Map<string, Label[]>();
  for (const j of joins) {
    const list = byIssue.get(j.issueId) ?? [];
    list.push({ id: j.id, name: j.name, color: j.color });
    byIssue.set(j.issueId, list);
  }
  const assigneesByIssue = new Map<string, Assignee[]>();
  for (const assignment of assignmentRows) {
    const member = memberMap.get(assignment.userId);
    if (!member) continue;
    const list = assigneesByIssue.get(assignment.issueId) ?? [];
    list.push(member);
    assigneesByIssue.set(assignment.issueId, list);
  }
  for (const list of assigneesByIssue.values()) {
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  // #79: one extra lookup for the agent names on this page.
  const agentIds = [...new Set(rows.map((row) => row.delegatedAgentId).filter((id): id is string => Boolean(id)))];
  const agentNames = new Map<string, string>();
  if (agentIds.length) {
    const { workspaceAgents } = await import("@/db/schema");
    const found = await getDb()
      .select({ id: workspaceAgents.id, name: workspaceAgents.name })
      .from(workspaceAgents)
      .where(inArray(workspaceAgents.id, agentIds));
    for (const agent of found) agentNames.set(agent.id, agent.name);
  }
  return rows.map((row) => {
    const project = projectMap.get(row.projectId);
    return {
      id: row.id,
      number: row.number,
      identifier: row.identifier,
      title: row.title,
      description: row.description,
      status: row.status as Status,
      priority: row.priority as Priority,
      projectId: row.projectId,
      parentId: row.parentId ?? null,
      projectKey: project?.key ?? "?",
      projectName: project?.name ?? "Unknown",
      assignees: assigneesByIssue.get(row.id) ?? [],
      dueDate: row.dueDate ?? null,
      estimate: row.estimate ?? null,
      reminder: (row.reminder as ReminderPreset | null) ?? null,
      recurrence: (row.recurrence as Recurrence | null) ?? null,
      createdBy: row.createdBy,
      createdVia: row.createdVia as Via,
      claimedBy: row.claimedBy ?? null,
      claimedAt: row.claimedAt ?? null,
      publishedBy: row.publishedBy ?? null,
      sourceThreadId: row.sourceThreadId ?? null,
      reviewStatus: row.reviewStatus as ReviewStatus,
      reviewedBy: row.reviewedBy ?? null,
      reviewedAt: row.reviewedAt ?? null,
      delegatedAgentId: row.delegatedAgentId ?? null,
      delegatedBy: row.delegatedBy ?? null,
      delegatedAt: row.delegatedAt ?? null,
      delegationStatus: row.delegationStatus ?? null,
      delegationRunId: row.delegationRunId ?? null,
      delegatedAgentName: row.delegatedAgentId ? (agentNames.get(row.delegatedAgentId) ?? null) : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      labels: (byIssue.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export type ListFilters = {
  summary?: boolean;
  offset?: number;
  ids?:string[];
  status?: Status | "active" | "open" | "all";
  priority?: Priority;
  projectId?: string;
  // A project-scoped API key passes its allowlist here so lists never include another
  // project. An empty list matches nothing.
  projectIds?: string[];
  assigneeId?: string | null; // null = unassigned
  createdByUserId?: string; // "My tasks" (assigned or created) handled by caller
  q?: string;
  label?: string;
  limit?: number;
  cursor?: string;
  // The signed-in user. Omitted by agents, which are unrestricted; when present it
  // applies the workspace's task-visibility setting.
  viewerId?: string;
  // Tasks that one agent chat published (H-COLLAB-07).
  sourceThreadId?: string;
  // Tasks an agent created (API or MCP), not ones a person opened in the app.
  agent?: boolean;
  // #79: tasks delegated to any agent, or to one named agent.
  delegated?: boolean;
  delegatedAgentId?: string;
};

// Totals for a project's Overview page; grouped in SQL so the count stays right
// however large the backlog gets.
export async function countIssuesByStatus(
  workspaceId: string,
  projectId: string,
  viewerId?: string
): Promise<Record<Status, number> & { total: number }> {
  const conditions = [
    eq(issues.workspaceId, workspaceId),
    eq(issues.projectId, projectId),
    isNull(issues.deletedAt),
  ];
  if (viewerId && !(await seesAllTasks(workspaceId, viewerId))) {
    conditions.push(ownIssueProjectCondition(viewerId));
  }
  const rows = await getDb()
    .select({ status: issues.status, n: sql<number>`COUNT(*)` })
    .from(issues)
    .where(and(...conditions))
    .groupBy(issues.status);
  const counts = { total: 0 } as Record<Status, number> & { total: number };
  for (const status of STATUS_ORDER) counts[status] = 0;
  for (const row of rows) {
    counts[row.status as Status] = Number(row.n);
    counts.total += Number(row.n);
  }
  return counts;
}

async function issueConditions(workspaceId: string, filters: ListFilters) {
  const db = getDb();
  // Issues under a trashed project disappear with it, and come back on restore.
  const conditions = [
    eq(issues.workspaceId, workspaceId),
    isNull(issues.deletedAt),
    ne(issues.reviewStatus, "rejected"),
    sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.deleted_at IS NULL)`,
  ];
  if (filters.viewerId && !(await seesAllTasks(workspaceId, filters.viewerId))) {
    conditions.push(ownIssueProjectCondition(filters.viewerId));
  }

  if(filters.ids){if(!filters.ids.length)return null;conditions.push(inArray(issues.id,filters.ids));}
  if (filters.sourceThreadId) {
    conditions.push(eq(issues.sourceThreadId, filters.sourceThreadId));
  }
  if (filters.agent) {
    conditions.push(inArray(issues.createdVia, ["api", "mcp"]));
  }
  if (filters.delegated) {
    conditions.push(isNotNull(issues.delegatedAgentId));
  }
  if (filters.delegatedAgentId) {
    conditions.push(eq(issues.delegatedAgentId, filters.delegatedAgentId));
  }
  if (filters.status === "active") {
    conditions.push(inArray(issues.status, ["todo", "in_progress"]));
  } else if (filters.status === "open") {
    // Open tasks: approved, not claimed, and not done or canceled. Anyone can claim them.
    conditions.push(inArray(issues.status, ["todo", "in_progress"]));
    conditions.push(eq(issues.reviewStatus, "approved"));
    conditions.push(isNull(issues.claimedBy));
  } else if (filters.status && filters.status !== "all") {
    conditions.push(eq(issues.status, filters.status));
  }
  if (filters.priority !== undefined) {
    conditions.push(eq(issues.priority, filters.priority));
  }
  if (filters.projectId) {
    conditions.push(eq(issues.projectId, filters.projectId));
  }
  if (filters.projectIds) {
    if (filters.projectIds.length === 0) return null;
    conditions.push(inArray(issues.projectId, filters.projectIds));
  }
  if (filters.assigneeId === null) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM issue_assignees WHERE issue_assignees.issue_id = ${issues.id})`
    );
  } else if (filters.assigneeId) {
    // A person's tasks are the ones assigned to them and the ones they claimed.
    // Claiming leaves assignees as they are, so match claimed_by as well.
    conditions.push(
      sql`(${issues.claimedBy} = ${filters.assigneeId} OR EXISTS (SELECT 1 FROM issue_assignees WHERE issue_assignees.issue_id = ${issues.id} AND issue_assignees.user_id = ${filters.assigneeId}))`
    );
  }
  if (filters.q) {
    const pattern = likePattern(filters.q);
    // Match the "<project name>-<number>" label the UI shows as well as the stored
    // identifier, so what people see is what they can search for.
    const ref = sql`(SELECT p.name FROM projects p WHERE p.id = ${issues.projectId}) || '-' || ${issues.number}`;
    const textMatch = or(
      sql`${issues.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${issues.description} LIKE ${pattern} ESCAPE '\\'`,
      sql`${issues.identifier} LIKE ${pattern} ESCAPE '\\'`,
      sql`${ref} LIKE ${pattern} ESCAPE '\\'`
    );
    conditions.push(textMatch!);
  }
  if (filters.label) {
    const [labelRow] = await db
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), sql`${labels.name} = ${filters.label} COLLATE NOCASE`))
      .limit(1);
    if (!labelRow) return null;
    conditions.push(sql`EXISTS (SELECT 1 FROM issue_labels WHERE issue_id=${issues.id} AND label_id=${labelRow.id})`);
  }
  return and(...conditions);
}

const issueRank = sql<number>`CASE ${issues.status} WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'canceled' THEN 3 ELSE -1 END`;
type IssueCursor = { rank: number; position: number; createdAt: string; id: string };
function decodeIssueCursor(value: string): IssueCursor {
  try {
    const row = JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as IssueCursor;
    if (!Number.isInteger(row.rank) || !Number.isFinite(row.position) || typeof row.createdAt!=="string" || typeof row.id!=="string") throw new Error();
    return row;
  } catch { throw new TacosError("Invalid task cursor",400); }
}
async function issueRows(workspaceId: string, filters: ListFilters, extra = 0) {
  const where = await issueConditions(workspaceId,filters);
  if (!where) return [];
  const after = filters.cursor ? decodeIssueCursor(filters.cursor) : null;
  const cursorWhere = after ? or(gt(issueRank,after.rank),and(eq(issueRank,after.rank),or(
    lt(issues.position,after.position),and(eq(issues.position,after.position),or(
      lt(issues.createdAt,after.createdAt),and(eq(issues.createdAt,after.createdAt),gt(issues.id,after.id))))))) : undefined;
  return getDb().select({...getTableColumns(issues),...(filters.summary?{description:sql<string>`''`}:{})}).from(issues).where(and(where,cursorWhere))
    .orderBy(asc(issueRank),desc(issues.position),desc(issues.createdAt),asc(issues.id))
    .limit(filters.limit ? Math.max(1,Math.trunc(filters.limit))+extra : -1).offset(Math.max(0,filters.offset??0));
}
export async function listIssues(workspaceId: string, filters: ListFilters = {}): Promise<IssueWithLabels[]> {
  return toIssueRows(workspaceId,await issueRows(workspaceId,filters));
}
export async function listIssuesPage(workspaceId: string, filters: ListFilters = {}) {
  const limit = Math.min(200,Math.max(1,Math.trunc(filters.limit ?? 100)));
  const rows = await issueRows(workspaceId,{...filters,limit},1);
  const hasMore = rows.length>limit;
  const current = rows.slice(0,limit);
  const last = current.at(-1);
  const where = await issueConditions(workspaceId,filters);
  const count = where ? getDb().select({n:sql<number>`count(*)`}).from(issues).where(where).get()?.n ?? 0 : 0;
  return { items: await toIssueRows(workspaceId,current), total: Number(count), nextCursor: hasMore&&last
    ? Buffer.from(JSON.stringify({rank:STATUS_ORDER.indexOf(last.status as Status),position:last.position,createdAt:last.createdAt,id:last.id})).toString("base64url") : null };
}

/** Sidebar badge for the claim queue; same conditions as `status: "open"`. */
export async function countOpenTasks(workspaceId: string, viewerId?: string): Promise<number> {
  const where = await issueConditions(workspaceId, { status: "open", viewerId });
  if (!where) return 0;
  return Number(
    getDb().select({ n: sql<number>`count(*)` }).from(issues).where(where).get()?.n ?? 0,
  );
}

/** Sidebar badge for the review queue; same conditions as `listPendingReview`. */
export async function countPendingReview(workspaceId: string): Promise<number> {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(issues)
    .leftJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        isNull(issues.deletedAt),
        isNull(projects.deletedAt),
        eq(issues.reviewStatus, "pending"),
      ),
    )
    .get();
  return Number(row?.n ?? 0);
}

export async function findIssueRow(workspaceId: string, idOrIdentifier: string): Promise<IssueRow | null> {
  const raw = idOrIdentifier.trim();
  const db = getDb();
  const scope = [eq(issues.workspaceId, workspaceId), isNull(issues.deletedAt),
    sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.deleted_at IS NULL)`];
  // Most internal calls already have an id; do not mix the primary-key path with aliases.
  const exact = await db.select().from(issues).where(and(...scope,eq(issues.id,raw))).limit(1);
  if (exact[0]) return exact[0];
  const numbered = await db.select().from(issues).where(and(...scope,
    sql`${issues.identifier} = ${raw} COLLATE NOCASE`)).limit(1);
  if (numbered[0]) return numbered[0];
  const [legacy] = await db.select().from(issues).where(and(...scope,
    sql`(SELECT p.name FROM projects p WHERE p.id = ${issues.projectId}) || '-' || ${issues.number} = ${raw} COLLATE NOCASE`)).limit(1);
  return legacy ?? null;
}

/** Shared lightweight visibility check; never reads comment or activity bodies. */
export async function findVisibleIssueRow(workspaceId: string, id: string, viewerId?: string): Promise<IssueRow | null> {
  const row = await findIssueRow(workspaceId,id);
  if (!row) return null;
  if (viewerId && !(await seesAllTasks(workspaceId,viewerId))) {
    const visible = await getDb().select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id,row.projectId),isNull(projects.deletedAt),ownProjectCondition(viewerId))).limit(1);
    if (!visible[0]) return null;
  }
  return row;
}

export async function getIssueDetail(
  workspaceId: string,
  idOrIdentifier: string,
  viewerId?: string
): Promise<IssueDetail | null> {
  const row = await findVisibleIssueRow(workspaceId,idOrIdentifier,viewerId);
  if (!row) return null;
  const db = getDb();
  const [withLabels] = await toIssueRows(workspaceId, [row]);
  const memberMap = await membersById(workspaceId);
  const commentRows = await db
    .select()
    .from(comments)
    .where(eq(comments.issueId, row.id))
    .orderBy(comments.createdAt);
  const eventRows = await db
    .select()
    .from(events)
    .where(eq(events.issueId, row.id))
    .orderBy(events.createdAt);
  const childRows = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
    })
    .from(issues)
    .where(
      and(
        eq(issues.parentId, row.id),
        isNull(issues.deletedAt),
        ne(issues.reviewStatus, "rejected")
      )
    )
    .orderBy(issues.createdAt);
  const dependencyRows = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      projectId: issues.projectId,
    })
    .from(issueDependencies)
    .innerJoin(issues, eq(issues.id, issueDependencies.blockedById))
    .where(
      and(
        eq(issueDependencies.issueId, row.id),
        isNull(issues.deletedAt),
        ne(issues.reviewStatus, "rejected")
      )
    );
  const restrictDependencies = viewerId ? !(await seesAllTasks(workspaceId, viewerId)) : false;
  const dependencies: TaskDependency[] = [];
  for (const item of dependencyRows) {
    if (restrictDependencies && !(await getProject(workspaceId, item.projectId, viewerId))) continue;
    dependencies.push({
      id: item.id,
      identifier: item.identifier,
      title: item.title,
      status: item.status as Status,
    });
  }
  return {
    issue: withLabels,
    comments: commentRows.map((c) => ({
      id: c.id,
      issueId: c.issueId,
      body: c.body,
      author: c.authorId ? memberMap.get(c.authorId) ?? null : null,
      agentAuthor: c.agentAuthor,
      createdAt: c.createdAt,
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      issueId: e.issueId,
      type: e.type,
      data: JSON.parse(e.data) as Record<string, unknown>,
      actor: e.actorId ? memberMap.get(e.actorId) ?? null : null,
      agentActor: e.agentActor,
      createdAt: e.createdAt,
    })),
    children: childRows.map((child) => ({
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      status: child.status as Status,
    })),
    dependencies,
    blocked: dependencies.some((item) => item.status !== "done" && item.status !== "canceled"),
  };
}

export type NotificationInput = {
  workspaceId: string;
  userId: string;
  issueId: string;
  pageId?: string;
  type:
    | "assigned"
    | "commented"
    | "mentioned"
    | "doc_mentioned"
    | "doc_commented"
    | "due_soon"
    | "handoff_done"
    | "handoff_failed"
    | "handoff_waiting"
    | "delegation_started"
    | "delegation_review"
    | "delegation_failed"
    | "delegation_changes_requested"
    | "blocker"
    | "view_added"
    | "view_completed"
    | ClaimNotice;
  body: string;
  data?: NotificationData;
};

/** Whether this person wants this notice at all (preferences + mutes). */
async function notificationAllowed(input: NotificationInput): Promise<boolean> {
  const group = prefGroupForType(input.type);
  if (group) {
    const types = await getNotificationPrefs(input.workspaceId, input.userId);
    if (types[group] === false) return false;
  }
  const scopes: { type: string; id: string }[] = [];
  if (input.pageId) {
    scopes.push({ type: "page", id: input.pageId });
    const [page] = await getDb()
      .select({ projectId: pages.projectId })
      .from(pages)
      .where(eq(pages.id, input.pageId))
      .limit(1);
    if (page?.projectId) scopes.push({ type: "project", id: page.projectId });
  }
  if (input.issueId) {
    scopes.push({ type: "issue", id: input.issueId });
    const [issue] = await getDb()
      .select({ projectId: issues.projectId })
      .from(issues)
      .where(eq(issues.id, input.issueId))
      .limit(1);
    if (issue?.projectId) scopes.push({ type: "project", id: issue.projectId });
  }
  if (scopes.length === 0) return true;
  const [mute] = await getDb()
    .select({ scopeId: notificationMutes.scopeId })
    .from(notificationMutes)
    .where(
      and(
        eq(notificationMutes.workspaceId, input.workspaceId),
        eq(notificationMutes.userId, input.userId),
        or(
          ...scopes.map((scope) =>
            and(
              eq(notificationMutes.scopeType, scope.type),
              eq(notificationMutes.scopeId, scope.id)
            )
          )
        )
      )
    )
    .limit(1);
  return !mute;
}

export async function notify(input: NotificationInput) {
  if (!(await notificationAllowed(input))) return;
  await getDb().insert(notifications).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    issueId: input.issueId,
    pageId: input.pageId ?? null,
    type: input.type,
    body: input.body,
    data: input.data ? JSON.stringify(input.data) : null,
    state: "unread",
    createdAt: nowIso(),
  });
}

/** The view definition matches this one task; used when a subscription fires. */
async function taskMatchesView(
  issue: IssueWithLabels,
  definition: ReturnType<typeof parseStoredDefinition>,
  fields: TaskField[],
  values: FieldValues
): Promise<boolean> {
  return (
    applyView(
      [issue],
      { filters: definition.filters, sort: [], display: definition.display },
      fields,
      values
    ).length > 0
  );
}

/**
 * A task entering a saved view (added) or becoming done/canceled inside it
 * (completed) notifies the members watching that view through the Inbox. The
 * person who caused the change is never notified about their own action.
 */
async function notifyViewSubscribers(
  workspaceId: string,
  detail: IssueDetail,
  kind: "added" | "completed",
  actor: MutationActor
) {
  const db = getDb();
  const subscriptions = db
    .select({
      userId: taskViewSubscriptions.userId,
      events: taskViewSubscriptions.events,
      muted: taskViewSubscriptions.muted,
      viewId: taskViews.id,
      viewName: taskViews.name,
      definition: taskViews.definition,
      scope: taskViews.scope,
      projectId: taskViews.projectId,
      shared: taskViews.shared,
      ownerId: taskViews.ownerId,
    })
    .from(taskViewSubscriptions)
    .innerJoin(taskViews, eq(taskViews.id, taskViewSubscriptions.viewId))
    .where(eq(taskViewSubscriptions.workspaceId, workspaceId))
    .all();
  const issue = detail.issue;
  const watchers = subscriptions.filter((row) => {
    if (row.muted) return false;
    if (!row.shared && row.ownerId !== row.userId) return false;
    if (row.scope === "project" && row.projectId !== issue.projectId) return false;
    return row.events.includes(kind);
  });
  if (watchers.length === 0) return;

  const fieldRows = db
    .select()
    .from(taskFields)
    .where(and(eq(taskFields.workspaceId, workspaceId), isNull(taskFields.disabledAt)))
    .all();
  const fields: TaskField[] = fieldRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as TaskField["type"],
    options: JSON.parse(row.options) as string[],
    createdBy: row.createdBy,
    disabledAt: row.disabledAt,
  }));
  const valueRows = db
    .select()
    .from(taskFieldValues)
    .where(eq(taskFieldValues.issueId, issue.id))
    .all();
  const values: FieldValues = {
    [issue.id]: Object.fromEntries(valueRows.map((row) => [row.fieldId, row.value])),
  };
  // An agent-published task was still triggered by the person who ran the agent.
  const actorUserId =
    actor.kind === "user" ? actor.userId : (actor.publishedBy ?? null);
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  // A project view must not notify someone who cannot open that project.
  const projectAccess = new Map<string, boolean>();
  const statusLabel =
    issue.status === "done"
      ? "Done"
      : issue.status === "canceled"
        ? "Canceled"
        : issue.status === "in_progress"
          ? "In Progress"
          : "Todo";
  for (const row of watchers) {
    // Exclude self-triggered actions: the person who moved the task already knows.
    if (row.userId === actorUserId) continue;
    if (row.scope === "project" && row.projectId) {
      let allowed = projectAccess.get(row.userId);
      if (allowed === undefined) {
        allowed = (await seesAllTasks(workspaceId, row.userId))
          ? true
          : Boolean(await getProject(workspaceId, row.projectId, row.userId));
        projectAccess.set(row.userId, allowed);
      }
      if (!allowed) continue;
    }
    const definition = parseStoredDefinition(row.definition);
    if (!(await taskMatchesView(issue, definition, fields, values))) continue;
    await notify({
      workspaceId,
      userId: row.userId,
      issueId: issue.id,
      type: kind === "added" ? "view_added" : "view_completed",
      body: "",
      data: {
        actorName: who,
        title: issue.title,
        viewName: row.viewName,
        ...(kind === "completed" ? { statusLabel } : {}),
      },
    });
  }
}

export type MutationActor =
  | { kind: "user"; userId: string; displayName: string }
  // publishedBy is the person who ran the agent. An agent task waits for human review.
  | { kind: "agent"; label: string; via: Via; publishedBy?: string; sourceThreadId?: string };

function actorFields(actor: MutationActor) {
  return actor.kind === "user"
    ? { actorId: actor.userId, agentActor: null }
    : { actorId: null, agentActor: actor.label };
}

function commentAuthorFields(actor: MutationActor) {
  return actor.kind === "user"
    ? { authorId: actor.userId, agentAuthor: null }
    : { authorId: null, agentAuthor: actor.label };
}

export async function recordEvent(
  issueId: string,
  type: string,
  data: Record<string, unknown>,
  actor: MutationActor
) {
  await getDb().insert(events).values({
    id: crypto.randomUUID(),
    issueId,
    type,
    data: JSON.stringify(data),
    createdAt: nowIso(),
    ...actorFields(actor),
  });
}

export type CreateIssueInput = {
  title: string;
  fieldValues?: Record<string,string>;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeIds?: string[];
  labelNames?: string[];
  dueDate?: string | null;
  estimate?: number | null;
  reminder?: ReminderPreset | null;
  recurrence?: Recurrence | null;
  project: string;
  // Identifier or id of the task this one belongs to.
  parent?: string | null;
};
export type UpdateIssueInput = {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeIds?: string[];
  labelNames?: string[];
  dueDate?: string | null;
  estimate?: number | null;
  reminder?: ReminderPreset | null;
  recurrence?: Recurrence | null;
  // Identifier or id of the parent task. Null or "" detaches this task.
  parent?: string | null;
};

function normalizeDueDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10)!==text) {
    throw new TacosError("Due date must be a calendar date (YYYY-MM-DD)");
  }
  return text;
}

function normalizeEstimate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10_000) {
    throw new TacosError("Estimate must be a number between 0 and 10000");
  }
  return Math.round(number * 100) / 100;
}

function normalizeRecurrence(value: unknown): Recurrence | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (!RECURRENCES.includes(text as Recurrence)) {
    throw new TacosError("Recurrence must be daily, weekly, or monthly");
  }
  return text as Recurrence;
}

function addRecurrence(dueDate: string | null, recurrence: Recurrence): string | null {
  if (!dueDate) return null;
  const [year, month, day] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (recurrence === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (recurrence === "monthly") {
    const target = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCMonth(date.getUTCMonth() + 1, Math.min(day, last));
  }
  const monthText = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${monthText}-${dayText}`;
}

function normalizeReminder(value: unknown): ReminderPreset | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value);
  if (!REMINDER_PRESETS.includes(text as ReminderPreset)) {
    throw new TacosError(`Reminder must be one of ${REMINDER_PRESETS.join(", ")}`);
  }
  return text as ReminderPreset;
}

// A board drop: land between `beforeId` (the card above) and `afterId` (the card
// below), optionally in another status column.
export type MoveIssueInput = {
  status?: Status;
  beforeId?: string | null;
  afterId?: string | null;
};

// A subtask stays in its parent's project. Walking the parent's ancestors refuses a loop.
async function resolveParent(
  workspaceId: string,
  parent: string,
  childId: string | null,
  projectId: string
): Promise<string> {
  const row = await findIssueRow(workspaceId, parent);
  if (!row) throw new TacosError("Parent task not found", 404);
  if (row.projectId !== projectId) throw new TacosError("A subtask stays in its parent's project", 400);
  if (childId && row.id === childId) throw new TacosError("A task cannot be a subtask of itself", 400);
  const seen = new Set<string>();
  let at: string | null = row.id;
  while (at) {
    if (childId && at === childId) throw new TacosError("A task cannot sit inside its own subtask", 400);
    if (seen.has(at)) throw new TacosError("A task cannot sit inside its own subtask", 400);
    seen.add(at);
    const [next] = await getDb()
      .select({ parentId: issues.parentId })
      .from(issues)
      .where(eq(issues.id, at));
    at = next?.parentId ?? null;
  }
  return row.id;
}

export async function createIssue(
  workspaceId: string,
  input: CreateIssueInput,
  actor: MutationActor
): Promise<IssueDetail> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new TacosError("Title is required", 400, "Provide a short, imperative summary");
  if (title.length > 500) throw new TacosError("Title must be at most 500 characters");

  const project = await findProjectRow(workspaceId, input.project);
  if (!project) {
    const available = (await listProjects(workspaceId)).map((p) => p.key).join(", ");
    throw new TacosError(
      `Project "${input.project}" not found`,
      404,
      `Available projects: ${available || "none yet"}`
    );
  }

  const status = input.status ?? "todo";
  const priority = input.priority ?? 0;
  const description = input.description ?? "";
  const dueDate = normalizeDueDate(input.dueDate);
  const estimate = normalizeEstimate(input.estimate);
  const reminder = dueDate ? normalizeReminder(input.reminder) : null;
  const recurrence = normalizeRecurrence(input.recurrence);
  const id = crypto.randomUUID();
  const now = nowIso();
  const actorUserId = actor.kind === "user" ? actor.userId : null;
  const publisherId = actor.kind === "user" ? actor.userId : actor.publishedBy ?? null;
  const reviewStatus: ReviewStatus = actor.kind === "agent" ? "pending" : "approved";
  const sourceThreadId = actor.kind === "agent" ? actor.sourceThreadId ?? null : null;

  const parentId =
    typeof input.parent === "string" && input.parent.trim()
      ? await resolveParent(workspaceId, input.parent, null, project.id)
      : null;

  const assigneeIds = [...new Set(input.assigneeIds ?? [])];
  if (assigneeIds.length > 0) {
    const memberMap = await membersById(workspaceId);
    for (const assigneeId of assigneeIds) {
      if (!memberMap.has(assigneeId)) {
        throw new TacosError("Assignee is not a member of this workspace", 400);
      }
    }
  }

  const db = getDb();
  const customValues=[];
  for(const [fieldId,raw] of Object.entries(input.fieldValues??{})){
    if(typeof raw!=="string")throw new TacosError("Invalid field value",400);
    const field=db.select().from(taskFields).where(and(eq(taskFields.id,fieldId),eq(taskFields.workspaceId,workspaceId),isNull(taskFields.disabledAt))).get();
    if(!field)throw new TacosError("This field is no longer available. Reopen the form and review its properties.",409);
    const value=normalizeFieldValue({...field,type:field.type as TaskField["type"],options:JSON.parse(field.options)},raw);
    if(value!==null)customValues.push({issueId:id,fieldId,value});
  }
  await db.run(sql`INSERT INTO issues
    (id, workspace_id, project_id, parent_id, number, identifier, title, description, status, priority, due_date, estimate, reminder, created_by, published_by, review_status, source_thread_id, created_via, created_at, updated_at, position)
    VALUES (${id}, ${workspaceId}, ${project.id}, ${parentId},
      (SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ${project.id}),
      'pending', ${title}, ${description}, ${status}, ${priority}, ${dueDate}, ${estimate}, ${reminder},
      ${publisherId}, ${publisherId}, ${reviewStatus}, ${sourceThreadId},
      ${actor.kind === "agent" ? actor.via : "web"}, ${now}, ${now},
      (SELECT COALESCE(MAX(position), 0) + 1 FROM issues WHERE workspace_id = ${workspaceId}))`);
  await db.run(
    sql`UPDATE issues SET identifier = ${project.key} || '-' || number WHERE id = ${id}`
  );
  if (recurrence) {
    await db.update(issues).set({ recurrence }).where(eq(issues.id, id));
  }

  const labelRecords = await getOrCreateLabels(workspaceId, input.labelNames ?? []);
  for (const label of labelRecords) {
    await db.insert(issueLabels).values({ issueId: id, labelId: label.id });
  }
  for (const assigneeId of assigneeIds) {
    await db.insert(issueAssignees).values({ issueId: id, userId: assigneeId, createdAt: now });
  }
  if(customValues.length)await db.insert(taskFieldValues).values(customValues);
  await recordEvent(id, "created", { title }, actor);
  if (description) await notifyMentions(workspaceId, id, description, actor);

  for (const assigneeId of assigneeIds) {
    if (assigneeId !== actorUserId) {
      await notifyAssigned(workspaceId, id, title, assigneeId, actor);
    }
  }

  const detail = await getIssueDetail(workspaceId, id);
  if (!detail) throw new TacosError("Failed to create issue", 500);
  await notifyViewSubscribers(workspaceId, detail, "added", actor);
  return detail;
}

// Status belongs to the people who opened and work on the issue. Agent callers
// (API keys, MCP) stay unrestricted so automated work can still progress.
async function assertCanChangeStatus(row: IssueRow, actor: MutationActor) {
  if (actor.kind === "agent") return;
  const assigned = await getDb()
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, row.id));
  if (assigned.some((entry) => entry.userId === actor.userId)) return;
  throw new TacosError(
    "Only assignees can change an issue's status",
    403,
    "Ask one of the assignees to move it, or assign yourself first"
  );
}

async function notifyAssigned(
  workspaceId: string,
  issueId: string,
  issueTitle: string,
  assigneeId: string,
  actor: MutationActor
) {
  const who =
    actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  await notify({
    workspaceId,
    userId: assigneeId,
    issueId,
    type: "assigned",
    body: "",
    data: { actorName: who, title: issueTitle },
  });
}

export async function updateIssue(
  workspaceId: string,
  idOrIdentifier: string,
  patch: UpdateIssueInput,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  if (actor.kind === "user" && !(await findVisibleIssueRow(workspaceId, row.id, actor.userId))) throw new TacosError("Task not found", 404);

  const db = getDb();
  const sets: Record<string, unknown> = {};
  const changes: Array<{ type: string; data: Record<string, unknown> }> = [];
  const memberMap = await membersById(workspaceId);
  let addedAssignees: string[] = [];

  if (patch.title !== undefined) {
    const title = typeof patch.title === "string" ? patch.title.trim() : "";
    if (!title) throw new TacosError("Title cannot be empty");
    if (title !== row.title) {
      sets.title = title;
      changes.push({ type: "title_changed", data: { from: row.title, to: title } });
    }
  }
  if (patch.description !== undefined && patch.description !== row.description) {
    sets.description = patch.description;
    changes.push({ type: "description_changed", data: {} });
  }
  if (patch.status !== undefined && patch.status !== row.status) {
    await assertCanChangeStatus(row, actor);
    sets.status = patch.status;
    changes.push({
      type: "status_changed",
      data: { from: row.status, to: patch.status },
    });
  }
  if (patch.priority !== undefined && patch.priority !== row.priority) {
    sets.priority = patch.priority;
    changes.push({
      type: "priority_changed",
      data: { from: row.priority, to: patch.priority },
    });
  }
  if (patch.dueDate !== undefined) {
    const dueDate = normalizeDueDate(patch.dueDate);
    if (dueDate !== (row.dueDate ?? null)) {
      sets.dueDate = dueDate;
      changes.push({ type: "due_changed", data: { from: row.dueDate, to: dueDate } });
      // A reminder without a deadline has nothing to count back from.
      if (!dueDate && row.reminder) {
        sets.reminder = null;
        changes.push({ type: "reminder_changed", data: { from: row.reminder, to: null } });
      }
    }
  }
  if (patch.estimate !== undefined) {
    const estimate = normalizeEstimate(patch.estimate);
    if (estimate !== (row.estimate ?? null)) {
      sets.estimate = estimate;
      changes.push({ type: "estimate_changed", data: { from: row.estimate ?? null, to: estimate } });
    }
  }
  if (patch.recurrence !== undefined) {
    const recurrence = normalizeRecurrence(patch.recurrence);
    if (recurrence !== (row.recurrence ?? null)) {
      sets.recurrence = recurrence;
      changes.push({
        type: "recurrence_changed",
        data: { to: recurrence ? RECURRENCE_META[recurrence].label : null },
      });
    }
  }
  if (patch.reminder !== undefined) {
    const effectiveDue = sets.dueDate !== undefined ? sets.dueDate : row.dueDate;
    const reminder = effectiveDue ? normalizeReminder(patch.reminder) : null;
    if (reminder !== (row.reminder ?? null)) {
      sets.reminder = reminder;
      changes.push({ type: "reminder_changed", data: { from: row.reminder, to: reminder } });
    }
  }
  if (patch.assigneeIds !== undefined) {
    const nextIds = [...new Set(patch.assigneeIds)];
    const currentRows = await db
      .select({ userId: issueAssignees.userId })
      .from(issueAssignees)
      .where(eq(issueAssignees.issueId, row.id));
    const currentIds = new Set(currentRows.map((entry) => entry.userId));
    addedAssignees = nextIds.filter((userId) => !currentIds.has(userId));
    const removedIds = currentRows
      .map((entry) => entry.userId)
      .filter((userId) => !nextIds.includes(userId));
    if (addedAssignees.length > 0 || removedIds.length > 0) {
      for (const assigneeId of nextIds) {
        if (!memberMap.has(assigneeId)) {
          throw new TacosError("Assignee is not a member of this workspace", 400);
        }
      }
      await db.delete(issueAssignees).where(eq(issueAssignees.issueId, row.id));
      const now = nowIso();
      for (const assigneeId of nextIds) {
        await db
          .insert(issueAssignees)
          .values({ issueId: row.id, userId: assigneeId, createdAt: now });
      }
      changes.push({
        type: "assignee_changed",
        data: {
          from: currentRows.map(
            (entry) => memberMap.get(entry.userId)?.displayName ?? "unknown"
          ),
          to: nextIds.map((userId) => memberMap.get(userId)?.displayName ?? "unknown"),
        },
      });
    }
  }
  if (patch.parent !== undefined) {
    const next =
      typeof patch.parent === "string" && patch.parent.trim()
        ? await resolveParent(workspaceId, patch.parent, row.id, row.projectId)
        : null;
    if (next !== (row.parentId ?? null)) {
      sets.parentId = next;
      const parent = next ? await findIssueRow(workspaceId, next) : null;
      changes.push({
        type: "parent_changed",
        data: { from: row.parentId, to: parent?.identifier ?? null },
      });
    }
  }
  if (patch.labelNames !== undefined) {
    const wanted = await getOrCreateLabels(workspaceId, patch.labelNames);
    const current = await db
      .select({ labelId: issueLabels.labelId, name: labels.name })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(eq(issueLabels.issueId, row.id));
    const currentIds = new Set(current.map((c) => c.labelId));
    const wantedIds = new Set(wanted.map((w) => w.id));
    const added = wanted.filter((w) => !currentIds.has(w.id)).map((w) => w.name);
    const removed = current.filter((c) => !wantedIds.has(c.labelId)).map((c) => c.name);
    if (added.length > 0 || removed.length > 0) {
      await db.delete(issueLabels).where(eq(issueLabels.issueId, row.id));
      for (const label of wanted) {
        await db.insert(issueLabels).values({ issueId: row.id, labelId: label.id });
      }
      changes.push({ type: "labels_changed", data: { added, removed } });
    }
  }

  const labelChanged = changes.some((c) => c.type === "labels_changed");
  const assignmentChanged = changes.some((c) => c.type === "assignee_changed");
  if (Object.keys(sets).length > 0 || labelChanged || assignmentChanged) {
    sets.updatedAt = nowIso();
    await db.update(issues).set(sets).where(eq(issues.id, row.id));
    for (const change of changes) {
      await recordEvent(row.id, change.type, change.data, actor);
    }
    if (typeof sets.description === "string") {
      // Only members that the old text did not mention get a notice.
      const before = new Set(parseMentions(row.description ?? ""));
      const added = parseMentions(sets.description).filter((name) => !before.has(name));
      if (added.length) await notifyMentions(workspaceId, row.id, added.map(mentionText).join(" "), actor);
    }
    const assigneeChange = changes.find((c) => c.type === "assignee_changed");
    if (assigneeChange) {
      const actorUserId = actor.kind === "user" ? actor.userId : null;
      const issueTitle = (sets.title as string | undefined) ?? row.title;
      for (const assigneeId of addedAssignees) {
        if (assigneeId !== actorUserId) {
          await notifyAssigned(workspaceId, row.id, issueTitle, assigneeId, actor);
        }
      }
    }
  }

  await openNextOccurrence(workspaceId, row.id, actor);

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while updating", 500);
  const completed = changes.some(
    (change) =>
      change.type === "status_changed" &&
      (sets.status === "done" || sets.status === "canceled")
  );
  if (completed) await notifyViewSubscribers(workspaceId, detail, "completed", actor);
  return detail;
}

// Marking a repeating task done opens the next one. The link is written only when it is
// still empty, so a second completion or a second call returns the same task.
export async function openNextOccurrence(
  workspaceId: string,
  idOrIdentifier: string,
  actor: MutationActor
): Promise<{ id: string } | null> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row || row.status !== "done" || !row.recurrence) return null;
  if (row.recurredInto) return { id: row.recurredInto };
  const recurrence = normalizeRecurrence(row.recurrence);
  if (!recurrence) return null;
  const db = getDb();
  const [project] = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, row.projectId));
  if (!project) return null;
  const assigneeRows = await db
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, row.id));
  const labelRows = await db
    .select({ name: labels.name })
    .from(issueLabels)
    .innerJoin(labels, eq(labels.id, issueLabels.labelId))
    .where(eq(issueLabels.issueId, row.id));
  const created = await createIssue(
    workspaceId,
    {
      title: row.title,
      description: row.description,
      status: "todo",
      priority: row.priority as Priority,
      dueDate: addRecurrence(row.dueDate, recurrence),
      reminder: (row.reminder as ReminderPreset | null) ?? null,
      recurrence,
      project: project.key,
      parent: row.parentId,
      assigneeIds: assigneeRows.map((entry) => entry.userId),
      labelNames: labelRows.map((entry) => entry.name),
    },
    actor
  );
  const claimed = await db
    .update(issues)
    .set({ recurredInto: created.issue.id })
    .where(and(eq(issues.id, row.id), isNull(issues.recurredInto)))
    .returning({ id: issues.id });
  if (claimed.length > 0) return { id: created.issue.id };
  await db.delete(issueLabels).where(eq(issueLabels.issueId, created.issue.id));
  await db.delete(issueAssignees).where(eq(issueAssignees.issueId, created.issue.id));
  await db.delete(events).where(eq(events.issueId, created.issue.id));
  await db.delete(notifications).where(eq(notifications.issueId, created.issue.id));
  await db.delete(issues).where(eq(issues.id, created.issue.id));
  const [winner] = await db
    .select({ recurredInto: issues.recurredInto })
    .from(issues)
    .where(eq(issues.id, row.id));
  return winner?.recurredInto ? { id: winner.recurredInto } : null;
}

export async function moveIssue(
  workspaceId: string,
  idOrIdentifier: string,
  input: MoveIssueInput,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  if (actor.kind === "user" && !(await findVisibleIssueRow(workspaceId, row.id, actor.userId))) throw new TacosError("Task not found", 404);

  const db = getDb();
  const sets: Record<string, unknown> = {};
  const changes: Array<{ type: string; data: Record<string, unknown> }> = [];

  if (input.status && input.status !== row.status) {
    await assertCanChangeStatus(row, actor);
    sets.status = input.status;
    changes.push({ type: "status_changed", data: { from: row.status, to: input.status } });
  }

  // Positions only matter relative to the two cards the drop landed between, so read
  // just those instead of renumbering the whole column.
  const neighbourIds = [input.beforeId, input.afterId].filter(
    (value): value is string => typeof value === "string" && value.length > 0 && value !== row.id
  );
  const neighbourRows =
    neighbourIds.length > 0
      ? await db
          .select({ id: issues.id, position: issues.position })
          .from(issues)
          .where(and(eq(issues.workspaceId, workspaceId), inArray(issues.id, neighbourIds)))
      : [];
  const positionById = new Map(neighbourRows.map((entry) => [entry.id, entry.position]));
  const above = input.beforeId && input.beforeId !== row.id ? positionById.get(input.beforeId) : undefined;
  const below = input.afterId && input.afterId !== row.id ? positionById.get(input.afterId) : undefined;

  let position: number;
  if (above !== undefined && below !== undefined) {
    position = (above + below) / 2;
  } else if (above !== undefined) {
    // Dropped at the bottom of the column.
    position = above - 1;
  } else if (below !== undefined) {
    // Dropped at the top of the column.
    position = below + 1;
  } else {
    const [top] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), 0)` })
      .from(issues)
      .where(eq(issues.workspaceId, workspaceId));
    position = Number(top?.max ?? 0) + 1;
  }

  if (position !== row.position) {
    sets.position = position;
    if (changes.length === 0) changes.push({ type: "reordered", data: {} });
  }

  if (Object.keys(sets).length > 0) {
    sets.updatedAt = nowIso();
    await db.update(issues).set(sets).where(eq(issues.id, row.id));
    for (const change of changes) {
      await recordEvent(row.id, change.type, change.data, actor);
    }
  }

  await openNextOccurrence(workspaceId, row.id, actor);

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while moving", 500);
  if (
    input.status &&
    input.status !== row.status &&
    (input.status === "done" || input.status === "canceled")
  ) {
    await notifyViewSubscribers(workspaceId, detail, "completed", actor);
  }
  return detail;
}

/**
 * Moves a top-level task to another project. The identifier is reallocated inside the
 * target project; a task with subtasks is refused so a tree never straddles projects.
 */
export async function moveIssueToProject(
  workspaceId: string,
  idOrIdentifier: string,
  projectIdOrKey: string,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  if (actor.kind === "user" && !(await findVisibleIssueRow(workspaceId, row.id, actor.userId))) {
    throw new TacosError("Task not found", 404);
  }
  const target = await findProjectRow(workspaceId, projectIdOrKey);
  if (!target) throw new TacosError(`Project "${projectIdOrKey}" not found`, 404);
  if (target.id === row.projectId) {
    const unchanged = await getIssueDetail(workspaceId, row.id);
    if (!unchanged) throw new TacosError("Task not found", 404);
    return unchanged;
  }
  if (row.parentId) {
    const parent = await findIssueRow(workspaceId, row.parentId);
    if (!parent || parent.projectId !== target.id) {
      throw new TacosError("A subtask stays in its parent's project", 400);
    }
  }
  const db = getDb();
  const child = db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.parentId, row.id), isNull(issues.deletedAt)))
    .limit(1)
    .get();
  if (child) {
    throw new TacosError(
      "Move or detach its subtasks before moving this task",
      409,
      "Subtasks stay in their parent's project"
    );
  }
  const source = await findProjectRow(workspaceId, row.projectId);
  const now = nowIso();
  db.transaction((tx) => {
    // Allocate the number against the target project in the same statement that moves it.
    tx.run(sql`UPDATE issues SET
      number = (SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ${target.id}),
      project_id = ${target.id}, updated_at = ${now}
      WHERE id = ${row.id}`);
    tx.run(sql`UPDATE issues SET identifier = (SELECT key FROM projects WHERE id = ${target.id}) || '-' || number WHERE id = ${row.id}`);
  });
  await recordEvent(
    row.id,
    "project_changed",
    {
      from: source?.name ?? row.projectId,
      to: target.name,
      fromProjectId: row.projectId,
      toProjectId: target.id,
    },
    actor
  );
  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while moving", 500);
  return detail;
}

export type BulkTaskPatch = {
  status?: Status;
  assigneeIds?: string[];
  priority?: Priority;
  dueDate?: string | null;
  labelAdd?: string[];
  labelRemove?: string[];
  projectId?: string;
};

export type BulkTaskResult = { id: string; ok: boolean; error?: string };

/**
 * Applies one patch to up to 100 tasks. Each task is its own mutation (status
 * ownership, activity events, recurrence and notifications all run), so one
 * refusal does not stop the rest; the caller gets a per-task result.
 */
export async function bulkUpdateIssues(
  workspaceId: string,
  ids: string[],
  patch: BulkTaskPatch,
  actor: MutationActor
): Promise<{ results: BulkTaskResult[]; updated: number }> {
  if (!Array.isArray(ids) || ids.length === 0) throw new TacosError("Select at least one task", 400);
  if (ids.length > 100) throw new TacosError("Select at most 100 tasks per batch", 400);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new TacosError("The batch repeats a task", 400);
  const hasPatch =
    patch.status !== undefined ||
    patch.assigneeIds !== undefined ||
    patch.priority !== undefined ||
    patch.dueDate !== undefined ||
    patch.labelAdd?.length ||
    patch.labelRemove?.length ||
    patch.projectId !== undefined;
  if (!hasPatch) throw new TacosError("Choose a change to apply", 400);
  if (patch.assigneeIds !== undefined) {
    const members = await membersById(workspaceId);
    for (const assigneeId of patch.assigneeIds) {
      if (!members.has(assigneeId)) throw new TacosError("Assignee is not a member of this workspace", 400);
    }
  }
  if (patch.projectId !== undefined) {
    const target = await findProjectRow(workspaceId, patch.projectId);
    if (!target) throw new TacosError("Project not found", 404);
  }
  const db = getDb();
  const add = [...new Set((patch.labelAdd ?? []).map((name) => name.trim()).filter(Boolean))];
  const remove = new Set((patch.labelRemove ?? []).map((name) => name.trim()).filter(Boolean));
  const labelsByTask = new Map<string, string[]>();
  if (add.length > 0 || remove.size > 0) {
    const rows = db
      .select({ issueId: issueLabels.issueId, name: labels.name })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, unique))
      .all();
    for (const row of rows) {
      const list = labelsByTask.get(row.issueId) ?? [];
      list.push(row.name);
      labelsByTask.set(row.issueId, list);
    }
  }
  const results: BulkTaskResult[] = [];
  let updated = 0;
  for (const id of unique) {
    const row = await findIssueRow(workspaceId, id);
    if (!row) {
      results.push({ id, ok: false, error: "Task not found" });
      continue;
    }
    if (actor.kind === "user" && !(await findVisibleIssueRow(workspaceId, row.id, actor.userId))) {
      results.push({ id, ok: false, error: "Task not found" });
      continue;
    }
    const errors: string[] = [];
    if (patch.projectId !== undefined && patch.projectId !== row.projectId) {
      try {
        await moveIssueToProject(workspaceId, row.id, patch.projectId, actor);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Could not move the task");
      }
    }
    const changes: UpdateIssueInput = {};
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.assigneeIds !== undefined) changes.assigneeIds = [...new Set(patch.assigneeIds)];
    if (patch.priority !== undefined) changes.priority = patch.priority;
    if (patch.dueDate !== undefined) changes.dueDate = patch.dueDate;
    if (add.length > 0 || remove.size > 0) {
      const current = labelsByTask.get(row.id) ?? [];
      changes.labelNames = [...new Set([...current.filter((name) => !remove.has(name)), ...add])];
    }
    try {
      if (Object.keys(changes).length > 0) {
        await updateIssue(workspaceId, row.id, changes, actor);
      }
      if (errors.length > 0) results.push({ id, ok: false, error: errors.join("; ") });
      else {
        updated += 1;
        results.push({ id, ok: true });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Could not update the task");
      results.push({ id, ok: false, error: errors.join("; ") });
    }
  }
  return { results, updated };
}

// Deleting an issue sends it to the Trash rather than erasing it: comments and history
// stay attached so a restore brings the issue back exactly as it was.
export type IssueClaim = {
  id: string;
  identifier: string;
  claimedBy: string | null;
  claimedAt: string | null;
};

// H-COLLAB-01: claim is one conditional UPDATE, so two parallel claims cannot both win.
// Assignees stay as they are. Only approved, open tasks can be claimed.
// `actor` names who did it in the timeline: an API key or MCP server claims on behalf
// of its person, so the claim is theirs while the event keeps the key's attribution.
export async function claimIssue(
  workspaceId: string,
  idOrIdentifier: string,
  userId: string,
  actor?: MutationActor
): Promise<IssueClaim> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  if (row.reviewStatus !== "approved") throw new TacosError("This task is waiting for review", 409);
  if (row.status === "done" || row.status === "canceled") throw new TacosError("This task is closed", 409);
  const now = nowIso();
  const updated = await getDb()
    .update(issues)
    .set({ claimedBy: userId, claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.id, row.id),
        isNull(issues.claimedBy),
        eq(issues.reviewStatus, "approved")
      )
    )
    .returning({ id: issues.id });
  if (updated.length === 0) throw new TacosError("Someone else already claimed this task", 409);
  await recordEvent(row.id, "claimed", {}, actor ?? (await userActor(userId)));
  await notifyClaimWatchers(workspaceId, row.id, "claimed", userId);
  return { id: row.id, identifier: row.identifier, claimedBy: userId, claimedAt: now };
}

// Only the current claimer can release. Reassign comes in a later id with notifications.
export async function releaseIssue(
  workspaceId: string,
  idOrIdentifier: string,
  userId: string,
  actor?: MutationActor
): Promise<IssueClaim> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const updated = await getDb()
    .update(issues)
    .set({ claimedBy: null, claimedAt: null, updatedAt: nowIso() })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id), eq(issues.claimedBy, userId)))
    .returning({ id: issues.id });
  if (updated.length === 0) throw new TacosError("Only the person who claimed this task can release it", 403);
  await recordEvent(row.id, "released", {}, actor ?? (await userActor(userId)));
  await notifyClaimWatchers(workspaceId, row.id, "released", userId);
  return { id: row.id, identifier: row.identifier, claimedBy: null, claimedAt: null };
}

// The claimer hands the task to another workspace member. The new claimer gets a notification.
export async function transferClaim(
  workspaceId: string,
  idOrIdentifier: string,
  fromUserId: string,
  toUserId: string
): Promise<IssueClaim> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const [member] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, toUserId)));
  if (!member) throw new TacosError("That person is not a member of this workspace", 400);
  const now = nowIso();
  const updated = await getDb()
    .update(issues)
    .set({ claimedBy: toUserId, claimedAt: now, updatedAt: now })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id), eq(issues.claimedBy, fromUserId)))
    .returning({ id: issues.id });
  if (updated.length === 0) throw new TacosError("Only the person who claimed this task can hand it over", 403);
  const actor = await userActor(fromUserId);
  await recordEvent(row.id, "claim_transferred", { to: toUserId }, actor);
  if (toUserId !== fromUserId) {
    await notify({ workspaceId, userId: toUserId, issueId: row.id, type: "claim_transferred", body: actor.displayName, data: { actorName: actor.displayName } });
  }
  return { id: row.id, identifier: row.identifier, claimedBy: toUserId, claimedAt: now };
}

// Claim notices store the actor's name in body. The inbox builds the localized sentence from it.
export type ClaimNotice = "claimed" | "released" | "claim_transferred";

async function userActor(userId: string): Promise<MutationActor & { kind: "user" }> {
  const [user] = await getDb().select({ displayName: users.displayName }).from(users).where(eq(users.id, userId));
  return { kind: "user", userId, displayName: user?.displayName ?? "" };
}

// The creator and the assignees follow a task. The person who acts gets no notice.
// H-COLLAB-10: notify each workspace member that the text mentions, except the actor and
// the ids in `skip`. Returns the ids that got a notice.
async function notifyMentions(
  workspaceId: string,
  issueId: string,
  text: string,
  actor: MutationActor,
  skip: Set<string> = new Set()
): Promise<Set<string>> {
  const names = parseMentions(text);
  const sent = new Set<string>();
  if (names.length === 0) return sent;
  // An agent-published task was still triggered by the person who ran the agent.
  const actorUserId =
    actor.kind === "user" ? actor.userId : (actor.publishedBy ?? null);
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  // A project view must not notify someone who cannot open that project.
  const projectAccess = new Map<string, boolean>();
  for (const member of await listMembers(workspaceId)) {
    if (!names.includes(member.username.toLowerCase())) continue;
    if (member.id === actorUserId || skip.has(member.id)) continue;
    await notify({ workspaceId, userId: member.id, issueId, type: "mentioned", body: who, data: { actorName: who } });
    sent.add(member.id);
  }
  return sent;
}

// A blocker goes to the assignees, who can clear it. When the reporter is the only
// assignee, or the task has none, it goes to the person who opened the task, then the
// project lead, then the workspace owner. The reporter is never notified.
async function blockerRecipient(workspaceId: string, row: IssueRow, actorId: string): Promise<string[]> {
  const db = getDb();
  const assignees = await db
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, row.id));
  const others = assignees.map((assignee) => assignee.userId).filter((userId) => userId !== actorId);
  if (others.length > 0) return others;
  const [project] = await db
    .select({ createdBy: projects.createdBy })
    .from(projects)
    .where(eq(projects.id, row.projectId));
  const [workspace] = await db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  for (const userId of [row.createdBy, project?.createdBy, workspace?.createdBy]) {
    if (userId && userId !== actorId) return [userId];
  }
  return [];
}

// An agent has no person of its own, so a blocker reported through an API key is
// authored by the person the key belongs to while the event names the key.
export async function reportBlocker(
  workspaceId: string,
  idOrIdentifier: string,
  body: string,
  actor: MutationActor,
  options: { reportedById?: string } = {}
): Promise<{ id: string }> {
  const authorId = actor.kind === "user" ? actor.userId : options.reportedById;
  if (!authorId) {
    throw new TacosError(
      "Only a member can report a blocker",
      403,
      "Use an API key that belongs to a member, or report from the task panel."
    );
  }
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new TacosError("Say what is blocking this task", 400);
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const id = crypto.randomUUID();
  await getDb().insert(blockers).values({
    id,
    issueId: row.id,
    authorId,
    body: text,
    createdAt: nowIso(),
  });
  await recordEvent(row.id, "blocker_reported", { body: text }, actor);
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  for (const userId of await blockerRecipient(workspaceId, row, authorId)) {
    await notify({ workspaceId, userId, issueId: row.id, type: "blocker", body: who, data: { actorName: who } });
  }
  return { id };
}

// Walk what `blockedById` waits on. Reaching `issueId` means the new link would loop.
async function dependencyLoops(issueId: string, blockedById: string): Promise<boolean> {
  const db = getDb();
  const seen = new Set<string>();
  const pending = [blockedById];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    if (current === issueId) return true;
    seen.add(current);
    const next = await db
      .select({ blockedById: issueDependencies.blockedById })
      .from(issueDependencies)
      .where(eq(issueDependencies.issueId, current));
    pending.push(...next.map((row) => row.blockedById));
  }
  return false;
}

export async function addDependency(
  workspaceId: string,
  idOrIdentifier: string,
  blockedBy: string,
  viewerId: string | undefined,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const blocker = await findIssueRow(workspaceId, blockedBy);
  if (!blocker) throw new TacosError(`Issue "${blockedBy}" not found`, 404);
  await assertSeesIssue(workspaceId, blockedBy, viewerId);
  if (row.id === blocker.id) throw new TacosError("A task cannot depend on itself", 400);
  if (await dependencyLoops(row.id, blocker.id)) throw new TacosError("That dependency would loop", 400);
  const db = getDb();
  const [existing] = await db
    .select({ issueId: issueDependencies.issueId })
    .from(issueDependencies)
    .where(and(eq(issueDependencies.issueId, row.id), eq(issueDependencies.blockedById, blocker.id)))
    .limit(1);
  if (!existing) {
    await db.insert(issueDependencies).values({
      issueId: row.id,
      blockedById: blocker.id,
      createdAt: nowIso(),
    });
    await recordEvent(row.id, "dependency_added", { task: blocker.identifier }, actor);
  }
  const detail = await getIssueDetail(workspaceId, row.id, viewerId);
  if (!detail) throw new TacosError("Issue disappeared while updating", 500);
  return detail;
}

export async function removeDependency(
  workspaceId: string,
  idOrIdentifier: string,
  blockedBy: string,
  viewerId: string | undefined,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const blocker = await findIssueRow(workspaceId, blockedBy);
  if (!blocker) throw new TacosError(`Issue "${blockedBy}" not found`, 404);
  await assertSeesIssue(workspaceId, blockedBy, viewerId);
  const removed = await getDb()
    .delete(issueDependencies)
    .where(and(eq(issueDependencies.issueId, row.id), eq(issueDependencies.blockedById, blocker.id)))
    .returning({ issueId: issueDependencies.issueId });
  if (removed.length > 0) {
    await recordEvent(row.id, "dependency_removed", { task: blocker.identifier }, actor);
  }
  const detail = await getIssueDetail(workspaceId, row.id, viewerId);
  if (!detail) throw new TacosError("Issue disappeared while updating", 500);
  return detail;
}

async function notifyClaimWatchers(workspaceId: string, issueId: string, type: ClaimNotice, actorId: string) {
  const db = getDb();
  const [issue] = await db.select({ createdBy: issues.createdBy }).from(issues).where(eq(issues.id, issueId));
  const assignees = await db
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, issueId));
  const watchers = new Set<string>(assignees.map((a) => a.userId));
  if (issue?.createdBy) watchers.add(issue.createdBy);
  watchers.delete(actorId);
  const actor = await userActor(actorId);
  for (const userId of watchers) {
    await notify({ workspaceId, userId, issueId, type, body: actor.displayName, data: { actorName: actor.displayName } });
  }
}

export type PendingReviewIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  projectName: string;
  projectColor: string;
  publishedBy: string | null;
  publisherName: string | null;
  createdVia: Via;
  createdAt: string;
};

// Agent-published tasks that wait for a person to approve or reject them (H-COLLAB-03).
export async function listPendingReview(workspaceId: string): Promise<PendingReviewIssue[]> {
  const rows = await getDb()
    .select({
      id: issues.id,
      identifier: issues.identifier,
      number: issues.number,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      projectName: projects.name,
      projectColor: projects.color,
      publishedBy: issues.publishedBy,
      publisherName: users.displayName,
      createdVia: issues.createdVia,
      createdAt: issues.createdAt,
    })
    .from(issues)
    .leftJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(users, eq(users.id, issues.publishedBy))
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        isNull(issues.deletedAt),
        isNull(projects.deletedAt),
        eq(issues.reviewStatus, "pending")
      )
    )
    .orderBy(sql`${issues.createdAt} ASC`);
  return rows.map((row) => ({
    ...row,
    status: row.status as Status,
    projectName: row.projectName ?? "(no project)",
    projectColor: row.projectColor ?? DEFAULT_PROJECT_COLOR,
    createdVia: row.createdVia as Via,
  }));
}

export type ReviewDecision = "approve" | "reject";

// Only a person reviews, never an agent. One conditional UPDATE so two reviewers cannot both decide.
// External callers review as the person their key belongs to; `actor` keeps the key in
// the timeline while `reviewedBy` stays that person.
export async function reviewIssue(
  workspaceId: string,
  idOrIdentifier: string,
  reviewerId: string,
  decision: ReviewDecision,
  actor?: MutationActor
): Promise<{ id: string; reviewStatus: ReviewStatus; reviewedBy: string; reviewedAt: string }> {
  if (decision !== "approve" && decision !== "reject") throw new TacosError("Unknown review decision", 400);
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const now = nowIso();
  const reviewStatus: ReviewStatus = decision === "approve" ? "approved" : "rejected";
  const updated = await getDb()
    .update(issues)
    .set({ reviewStatus, reviewedBy: reviewerId, reviewedAt: now, updatedAt: now })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id), eq(issues.reviewStatus, "pending")))
    .returning({ id: issues.id });
  if (updated.length === 0) throw new TacosError("This task is not waiting for review", 409);
  await recordEvent(
    row.id,
    decision === "approve" ? "review_approved" : "review_rejected",
    {},
    actor ?? (await userActor(reviewerId))
  );
  return { id: row.id, reviewStatus, reviewedBy: reviewerId, reviewedAt: now };
}

export async function deleteIssue(workspaceId: string, idOrIdentifier: string): Promise<Issue> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  await getDb()
    .update(issues)
    .set({ deletedAt: nowIso() })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id)));
  return {
    id: row.id,
    number: row.number,
    identifier: row.identifier,
    title: row.title,
    description: row.description,
    status: row.status as Status,
    priority: row.priority as Priority,
    projectId: row.projectId,
    parentId: row.parentId ?? null,
    projectKey: "",
    projectName: "",
    assignees: [],
    dueDate: row.dueDate ?? null,
    estimate: row.estimate ?? null,
    reminder: (row.reminder as ReminderPreset | null) ?? null,
    recurrence: (row.recurrence as Recurrence | null) ?? null,
    createdBy: row.createdBy,
    createdVia: row.createdVia as Via,
    claimedBy: row.claimedBy ?? null,
    claimedAt: row.claimedAt ?? null,
    publishedBy: row.publishedBy ?? null,
    sourceThreadId: row.sourceThreadId ?? null,
    reviewStatus: row.reviewStatus as ReviewStatus,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
    delegatedAgentId: row.delegatedAgentId ?? null,
    delegatedBy: row.delegatedBy ?? null,
    delegatedAt: row.delegatedAt ?? null,
    delegationStatus: row.delegationStatus ?? null,
    delegationRunId: row.delegationRunId ?? null,
    delegatedAgentName: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Documents keep referencing a task after it lands in the Trash. The Overview uses
// these titles to fall back to plain text instead of drawing a dead chip.
export async function trashedIssueTitles(
  workspaceId: string,
  ids: string[]
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await getDb()
    .select({ id: issues.id, title: issues.title })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        inArray(issues.id, ids),
        isNotNull(issues.deletedAt)
      )
    );
  return Object.fromEntries(rows.map((row) => [row.id, row.title]));
}

export type TrashedIssue = {
  id: string;
  identifier: string;
  number: number;
  title: string;
  status: Status;
  deletedAt: string;
  projectId: string;
  projectName: string;
  projectColor: string;
};

export async function listTrashedIssues(workspaceId: string): Promise<TrashedIssue[]> {
  const rows = await getDb()
    .select({
      id: issues.id,
      identifier: issues.identifier,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      deletedAt: issues.deletedAt,
      projectId: issues.projectId,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(issues)
    .leftJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(issues.workspaceId, workspaceId), isNotNull(issues.deletedAt)))
    .orderBy(sql`${issues.deletedAt} DESC`);
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    number: row.number,
    title: row.title,
    status: row.status as Status,
    deletedAt: row.deletedAt!,
    projectId: row.projectId,
    projectName: row.projectName ?? "(no project)",
    projectColor: row.projectColor ?? DEFAULT_PROJECT_COLOR,
  }));
}

/** A task in the Trash is invisible to `findIssueRow`, so restore resolves it separately. */
export async function findTrashedIssueRow(
  workspaceId: string,
  idOrIdentifier: string
): Promise<IssueRow | null> {
  const raw = idOrIdentifier.trim();
  if (!raw) return null;
  const scope = [eq(issues.workspaceId, workspaceId), isNotNull(issues.deletedAt)];
  const [exact] = await getDb()
    .select()
    .from(issues)
    .where(and(...scope, eq(issues.id, raw)))
    .limit(1);
  if (exact) return exact;
  const [numbered] = await getDb()
    .select()
    .from(issues)
    .where(and(...scope, sql`${issues.identifier} = ${raw} COLLATE NOCASE`))
    .limit(1);
  return numbered ?? null;
}

export async function restoreIssue(workspaceId: string, idOrIdentifier: string) {
  const row = await findTrashedIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" is not in the trash`, 404);
  await getDb()
    .update(issues)
    .set({ deletedAt: null })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id)));
  return { id: row.id, identifier: row.identifier, title: row.title, projectId: row.projectId };
}

// Only ever called from the Trash, so the issue has to be soft-deleted first.
export async function purgeIssue(workspaceId: string, issueId: string) {
  const {deleteTaskRecords}=await import("./permanent-cleanup");
  getDb().$client.transaction(()=>{const row=getDb().$client.prepare("SELECT id FROM issues WHERE workspace_id=? AND id=? AND deleted_at IS NOT NULL").get(workspaceId,issueId);if(row)deleteTaskRecords([issueId]);}).immediate();
}

export async function addComment(
  workspaceId: string,
  idOrIdentifier: string,
  body: string,
  actor: MutationActor,
  // This person hears about the comment another way.
  options: { exceptUser?: string } = {}
): Promise<IssueDetail> {  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new TacosError("Comment body is required");
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);

  const db = getDb();
  await db.insert(comments).values({
    id: crypto.randomUUID(),
    issueId: row.id,
    body: text,
    createdAt: nowIso(),
    ...commentAuthorFields(actor),
  });
  await recordEvent(row.id, "commented", {}, actor);

  // notify every assignee (if not the actor) and the issue creator
  const actorUserId = actor.kind === "user" ? actor.userId : null;
  const targets = new Set<string>();
  const assigned = await db
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, row.id));
  for (const entry of assigned) {
    if (entry.userId !== actorUserId) targets.add(entry.userId);
  }
  if (row.createdBy && row.createdBy !== actorUserId) {
    targets.add(row.createdBy);
  }
  if (options.exceptUser) targets.delete(options.exceptUser);
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  // A mentioned member gets one "mentioned" notice instead of the "commented" one.
  const mentioned = await notifyMentions(workspaceId, row.id, text, actor);
  for (const userId of targets) {
    if (mentioned.has(userId)) continue;
    await notify({
      workspaceId,
      userId,
      issueId: row.id,
      type: "commented",
      body: "",
      data: { actorName: who, title: row.title },
    });
  }

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while commenting", 500);
  return detail;
}

// --- notifications ---

export type NotificationTab = "unread" | "mentions" | "assigned" | "all";

export type NotificationRow = {
  id: string;
  issueId: string;
  issueIdentifier: string;
  issueNumber: number | null;
  issueProjectId: string | null;
  issueProjectName: string | null;
  issueTitle: string;
  pageId: string | null;
  pageProjectId: string | null;
  pageTitle: string | null;
  type: string;
  body: string;
  data: NotificationData | null;
  state: string;
  snoozedUntil: string | null;
  deletedAt: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationCounts = {
  unread: number;
  mentions: number;
  assigned: number;
  all: number;
};

export type NotificationPage = {
  rows: NotificationRow[];
  nextCursor: string | null;
};

export type NotificationOptions = {
  tab?: NotificationTab;
  q?: string;
  cursor?: string | null;
  limit?: number;
};

const NOTIFICATION_RETENTION_DAYS = 90;
let notificationSweepAt = 0;

/** 90-day retention: lazy sweep on inbox/badge reads, no background job. */
export async function purgeOldNotifications(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - notificationSweepAt < 60_000) return;
  notificationSweepAt = now;
  const cutoff = new Date(now - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString();
  await getDb().delete(notifications).where(lt(notifications.createdAt, cutoff));
}

function notificationScope(workspaceId: string, userId: string) {
  return and(
    eq(notifications.userId, userId),
    // A deleted workspace cannot be opened, so its farewell notice follows the member
    // into whichever workspace they still have.
    or(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted"))
  );
}

function visibleNotification() {
  const now = nowIso();
  return and(
    isNull(notifications.deletedAt),
    ne(notifications.state, "done"),
    or(sql`${notifications.snoozedUntil} IS NULL`, sql`${notifications.snoozedUntil} <= ${now}`)
  );
}

function tabCondition(tab: NotificationTab) {
  if (tab === "mentions") {
    return inArray(notifications.type, ["mentioned", "doc_mentioned"]);
  }
  if (tab === "assigned") return eq(notifications.type, "assigned");
  if (tab === "all") return undefined;
  return eq(notifications.state, "unread");
}

function encodeNotificationCursor(row: NotificationRow): string {
  return `${row.createdAt}|${row.id}`;
}

function decodeNotificationCursor(cursor: string): { createdAt: string; id: string } {
  const at = cursor.lastIndexOf("|");
  if (at <= 0) throw new TacosError("Invalid notification cursor", 400);
  return { createdAt: cursor.slice(0, at), id: cursor.slice(at + 1) };
}

function notificationSearch(words: string[]) {
  const clauses = words.map((word) => {
    const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
    return sql`(${issues.identifier} LIKE ${pattern} ESCAPE '\\'
      OR ${issues.title} LIKE ${pattern} ESCAPE '\\'
      OR ${pages.title} LIKE ${pattern} ESCAPE '\\'
      OR ${notifications.body} LIKE ${pattern} ESCAPE '\\'
      OR ${notifications.data} LIKE ${pattern} ESCAPE '\\')`;
  });
  return and(...clauses);
}

export async function listNotificationPage(
  workspaceId: string,
  userId: string,
  options: NotificationOptions = {}
): Promise<NotificationPage> {
  await purgeOldNotifications();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const q = (options.q ?? "").trim();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  const tab: NotificationTab = ["unread", "mentions", "assigned", "all"].includes(options.tab ?? "")
    ? (options.tab as NotificationTab)
    : "unread";

  const conditions = [notificationScope(workspaceId, userId)];
  if (words.length > 0) {
    // Search covers everything, including Done rows, until the 90-day sweep.
    conditions.push(
      isNull(notifications.deletedAt),
      or(sql`${notifications.snoozedUntil} IS NULL`, sql`${notifications.snoozedUntil} <= ${nowIso()}`),
      notificationSearch(words)
    );
  } else {
    conditions.push(visibleNotification());
    const tabWhere = tabCondition(tab);
    if (tabWhere) conditions.push(tabWhere);
  }
  if (options.cursor) {
    const after = decodeNotificationCursor(options.cursor);
    conditions.push(
      or(
        lt(notifications.createdAt, after.createdAt),
        and(eq(notifications.createdAt, after.createdAt), lt(notifications.id, after.id))
      )
    );
  }

  const rows = await getDb()
    .select({
      id: notifications.id,
      issueId: notifications.issueId,
      issueIdentifier: issues.identifier,
      issueNumber: issues.number,
      issueProjectId: issues.projectId,
      issueProjectName: projects.name,
      issueTitle: issues.title,
      pageId: notifications.pageId,
      pageProjectId: pages.projectId,
      pageTitle: pages.title,
      type: notifications.type,
      body: notifications.body,
      data: notifications.data,
      state: notifications.state,
      snoozedUntil: notifications.snoozedUntil,
      deletedAt: notifications.deletedAt,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(issues, eq(issues.id, notifications.issueId))
    .leftJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(pages, eq(pages.id, notifications.pageId))
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map((row) => ({
    ...row,
    data: parseNotificationData(row.data),
    issueIdentifier: row.issueIdentifier ?? "(deleted issue)",
    issueTitle: row.issueTitle ?? "(deleted issue)",
  }));
  return {
    rows: page,
    nextCursor: rows.length > limit ? encodeNotificationCursor(page[page.length - 1]) : null,
  };
}

/** Backwards-compatible list: recent visible notifications as a plain array. */
export async function listNotifications(
  workspaceId: string,
  userId: string
): Promise<NotificationRow[]> {
  return (await listNotificationPage(workspaceId, userId, { tab: "all", limit: 50 })).rows;
}

async function countNotifications(
  workspaceId: string,
  userId: string,
  extra: ReturnType<typeof tabCondition>
): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(
      and(
        notificationScope(workspaceId, userId),
        visibleNotification(),
        extra
      )
    );
  return Number(row?.n ?? 0);
}

export async function notificationCounts(
  workspaceId: string,
  userId: string
): Promise<NotificationCounts> {
  await purgeOldNotifications();
  const [unread, mentions, assigned, all] = await Promise.all([
    countNotifications(workspaceId, userId, eq(notifications.state, "unread")),
    countNotifications(workspaceId, userId, inArray(notifications.type, ["mentioned", "doc_mentioned"])),
    countNotifications(workspaceId, userId, eq(notifications.type, "assigned")),
    countNotifications(workspaceId, userId, undefined),
  ]);
  return { unread, mentions, assigned, all };
}

export async function unreadNotificationCount(workspaceId: string, userId: string): Promise<number> {
  await purgeOldNotifications();
  return countNotifications(workspaceId, userId, eq(notifications.state, "unread"));
}

// Members whose only workspace was deleted have no Inbox to read the farewell in;
// the onboarding screen shows these rows instead.
export type WorkspaceDeletionNotice = {
  id: string;
  workspaceId: string;
  body: string;
  data: NotificationData | null;
  createdAt: string;
};

export async function listWorkspaceDeletionNotices(
  userId: string
): Promise<WorkspaceDeletionNotice[]> {
  const rows = await getDb()
    .select({
      id: notifications.id,
      workspaceId: notifications.workspaceId,
      body: notifications.body,
      data: notifications.data,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "workspace_deleted"),
        isNull(notifications.deletedAt),
        ne(notifications.state, "done"),
        isNull(notifications.readAt)
      )
    )
    .orderBy(sql`${notifications.createdAt} DESC`)
    .limit(5);
  return rows.map((row) => ({ ...row, data: parseNotificationData(row.data) }));
}

export async function markNotificationsRead(workspaceId: string, userId: string) {
  const at = nowIso();
  await getDb()
    .update(notifications)
    .set({ readAt: at, state: "read" })
    .where(
      and(
        notificationScope(workspaceId, userId),
        isNull(notifications.deletedAt),
        ne(notifications.state, "done"),
        ne(notifications.state, "read")
      )
    );
}

// Opening one notification reads just that one, so scoping to the recipient here is
// what keeps someone else's unread row from being marked by accident. The workspace
// is not part of the key because a deletion notice lives in a workspace you can no
// longer open.
export async function markNotificationRead(
  _workspaceId: string,
  userId: string,
  notificationId: string
) {
  await getDb()
    .update(notifications)
    .set({ readAt: nowIso(), state: "read" })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.id, notificationId),
        isNull(notifications.deletedAt),
        ne(notifications.state, "done")
      )
    );
}

export async function markNotificationUnread(userId: string, notificationId: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: null, state: "unread" })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.id, notificationId),
        isNull(notifications.deletedAt)
      )
    );
}

export async function setNotificationState(
  userId: string,
  notificationId: string,
  state: "unread" | "read" | "done"
) {
  await getDb()
    .update(notifications)
    .set({
      state,
      readAt: state === "unread" ? null : nowIso(),
      // Returning to the inbox clears the snooze so the row shows up again.
      ...(state === "unread" ? { snoozedUntil: null } : {}),
    })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.id, notificationId),
        isNull(notifications.deletedAt)
      )
    );
}

export async function snoozeNotification(
  userId: string,
  notificationId: string,
  until: string | null
) {
  await getDb()
    .update(notifications)
    .set({ snoozedUntil: until })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.id, notificationId),
        isNull(notifications.deletedAt)
      )
    );
}

// Soft delete: clearing the inbox keeps an undo window instead of dropping rows.
export async function deleteNotification(userId: string, notificationId: string) {
  await getDb()
    .update(notifications)
    .set({ deletedAt: nowIso() })
    .where(and(eq(notifications.userId, userId), eq(notifications.id, notificationId)));
}

export async function clearNotifications(workspaceId: string, userId: string) {
  await getDb()
    .update(notifications)
    .set({ deletedAt: nowIso() })
    .where(and(notificationScope(workspaceId, userId), isNull(notifications.deletedAt)));
}

export async function restoreNotifications(userId: string, notificationIds: string[]) {
  if (notificationIds.length === 0) return;
  await getDb()
    .update(notifications)
    .set({ deletedAt: null })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, notificationIds)));
}

export type NotificationMute = {
  scopeType: "issue" | "page" | "project";
  scopeId: string;
  label: string;
};

export async function listNotificationMutes(
  workspaceId: string,
  userId: string
): Promise<NotificationMute[]> {
  const rows = await getDb()
    .select({
      scopeType: notificationMutes.scopeType,
      scopeId: notificationMutes.scopeId,
      label: notificationMutes.label,
    })
    .from(notificationMutes)
    .where(
      and(
        eq(notificationMutes.workspaceId, workspaceId),
        eq(notificationMutes.userId, userId)
      )
    )
    .orderBy(desc(notificationMutes.createdAt));
  return rows.map((row) => ({
    scopeType: row.scopeType as NotificationMute["scopeType"],
    scopeId: row.scopeId,
    label: row.label,
  }));
}

export async function addNotificationMute(
  workspaceId: string,
  userId: string,
  scopeType: NotificationMute["scopeType"],
  scopeId: string,
  label: string
) {
  if (!["issue", "page", "project"].includes(scopeType) || !scopeId) {
    throw new TacosError("Invalid mute scope", 400);
  }
  await getDb()
    .insert(notificationMutes)
    .values({
      workspaceId,
      userId,
      scopeType,
      scopeId,
      label: label.slice(0, 200),
      createdAt: nowIso(),
    })
    .onConflictDoNothing();
}

export async function removeNotificationMute(
  workspaceId: string,
  userId: string,
  scopeType: string,
  scopeId: string
) {
  await getDb()
    .delete(notificationMutes)
    .where(
      and(
        eq(notificationMutes.workspaceId, workspaceId),
        eq(notificationMutes.userId, userId),
        eq(notificationMutes.scopeType, scopeType),
        eq(notificationMutes.scopeId, scopeId)
      )
    );
}

export async function getNotificationPrefs(
  workspaceId: string,
  userId: string
): Promise<Record<string, boolean>> {
  const [row] = await getDb()
    .select({ prefs: notificationPrefs.prefs })
    .from(notificationPrefs)
    .where(
      and(
        eq(notificationPrefs.workspaceId, workspaceId),
        eq(notificationPrefs.userId, userId)
      )
    )
    .limit(1);
  if (!row?.prefs) return {};
  try {
    const value = JSON.parse(row.prefs) as { types?: Record<string, unknown> };
    const types: Record<string, boolean> = {};
    for (const [key, enabled] of Object.entries(value.types ?? {})) {
      if (typeof enabled === "boolean") types[key] = enabled;
    }
    return types;
  } catch {
    return {};
  }
}

export async function saveNotificationPrefs(
  workspaceId: string,
  userId: string,
  types: Record<string, boolean>
): Promise<void> {
  const allowed = new Set(NOTIFICATION_EVENT_GROUPS.map((group) => group.id));
  const clean: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(types)) {
    if (allowed.has(key as never) && typeof value === "boolean") clean[key] = value;
  }
  await getDb()
    .insert(notificationPrefs)
    .values({
      workspaceId,
      userId,
      prefs: JSON.stringify({ types: clean }),
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: [notificationPrefs.workspaceId, notificationPrefs.userId],
      set: { prefs: JSON.stringify({ types: clean }), updatedAt: nowIso() },
    });
}

// --- API keys ---

export type ApiKeyScope = "read" | "write";
export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  // null = a key from before scopes existed: full workspace read and write access.
  scopes: ApiKeyScope[] | null;
  // null = every project in the workspace.
  projectIds: string[] | null;
  expiresAt: string | null;
  rotatedFrom: string | null;
  keyPrefix: string | null;
  last4: string | null;
};

export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateApiKey() {
  return `tac_${crypto.randomBytes(24).toString("hex")}`;
}

function decodeList(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // SQL NULL is the legacy full-access marker. A malformed non-null value must
    // fail closed instead of silently escalating a restricted key.
    console.error("[tacos] malformed API-key JSON column; treating it as empty");
    return [];
  }
}

function decodeScopes(raw: string | null): ApiKeyScope[] | null {
  const list = decodeList(raw);
  if (list === null) return null;
  const scopes = list.filter((entry): entry is ApiKeyScope => entry === "read" || entry === "write");
  if (scopes.includes("write") && !scopes.includes("read")) scopes.unshift("read");
  return scopes;
}

function mapApiKeyRow(row: typeof apiKeys.$inferSelect): ApiKeyRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    lastUsedIp: row.lastUsedIp ?? null,
    revokedAt: row.revokedAt ?? null,
    scopes: decodeScopes(row.scopes),
    projectIds: decodeList(row.projectIds),
    expiresAt: row.expiresAt ?? null,
    rotatedFrom: row.rotatedFrom ?? null,
    keyPrefix: row.keyPrefix ?? null,
    last4: row.last4 ?? null,
  };
}

export function apiKeyHasScope(record: ApiKeyRecord, scope: ApiKeyScope): boolean {
  if (record.scopes === null) return true;
  if (scope === "read") return record.scopes.includes("read") || record.scopes.includes("write");
  return record.scopes.includes("write");
}

export function apiKeyAllowsProject(record: ApiKeyRecord, projectId: string): boolean {
  return record.projectIds === null || record.projectIds.includes(projectId);
}

export function isApiKeyExpired(record: ApiKeyRecord, now: string = nowIso()): boolean {
  return record.expiresAt !== null && record.expiresAt <= now;
}

function normalizeApiKeyScopes(scopes: ApiKeyScope[]): ApiKeyScope[] {
  const normalized = new Set<ApiKeyScope>();
  for (const scope of scopes) {
    if (scope !== "read" && scope !== "write") {
      throw new TacosError(`Unknown API key scope "${String(scope)}"`);
    }
    normalized.add(scope);
  }
  if (normalized.has("write")) normalized.add("read");
  if (normalized.size === 0) throw new TacosError("Pick at least the read scope");
  return ["read", "write"].filter((scope): scope is ApiKeyScope => normalized.has(scope as ApiKeyScope));
}

async function normalizeApiKeyProjects(
  workspaceId: string,
  projectIds: string[] | null,
  createdBy: string
): Promise<string[] | null> {
  if (projectIds === null || projectIds.length === 0) return null;
  const live = await listProjects(workspaceId, createdBy);
  const allowed = new Map(live.map((project) => [project.id, project.key]));
  const unique = [...new Set(projectIds)];
  for (const id of unique) {
    if (!allowed.has(id)) {
      throw new TacosError(`Project "${id}" is not in this workspace`, 400, "Pick projects from the workspace list");
    }
  }
  return unique;
}

export async function createApiKey(
  workspaceId: string,
  name: string,
  scopes: ApiKeyScope[],
  projectIds: string[] | null,
  expiresInDays: number | null,
  createdBy: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const trimmed = name.trim();
  if (!trimmed) throw new TacosError("API key name is required");
  const normalizedScopes = normalizeApiKeyScopes(scopes);
  const normalizedProjects = await normalizeApiKeyProjects(workspaceId, projectIds, createdBy);
  if (expiresInDays !== null && !API_KEY_EXPIRY_DAYS.includes(expiresInDays as (typeof API_KEY_EXPIRY_DAYS)[number])) {
    throw new TacosError("Expiry must be 30, 90 or 365 days");
  }
  if (expiresInDays === null) {
    const facts = await workspaceFacts(workspaceId, createdBy);
    if (facts.ownerId !== createdBy && facts.role !== "admin") {
      throw new TacosError("Only a workspace admin can create a key that never expires", 403);
    }
  }
  const key = generateApiKey();
  const now = nowIso();
  const record: ApiKeyRecord = {
    id: crypto.randomUUID(),
    workspaceId,
    name: trimmed,
    createdBy,
    createdAt: now,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    scopes: normalizedScopes,
    projectIds: normalizedProjects,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString(),
    rotatedFrom: null,
    keyPrefix: key.slice(0, 8),
    last4: key.slice(-4),
  };
  await getDb().insert(apiKeys).values({
    id: record.id,
    workspaceId,
    name: record.name,
    keyHash: sha256(key),
    createdBy,
    createdAt: now,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    scopes: JSON.stringify(record.scopes),
    projectIds: record.projectIds ? JSON.stringify(record.projectIds) : null,
    expiresAt: record.expiresAt,
    rotatedFrom: null,
    keyPrefix: record.keyPrefix,
    last4: record.last4,
  });
  return { key, record };
}

export async function verifyApiKey(
  rawKey: string,
  options: { recordUse?: boolean; ip?: string | null } = {}
): Promise<ApiKeyRecord | null> {
  const db = getDb();
  const [row] = await db
    .select({ key: apiKeys, deletedAt: workspaces.deletedAt })
    .from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(eq(apiKeys.keyHash, sha256(rawKey)))
    .limit(1);
  // A workspace in the recycle bin is closed to agents too, unlike a merely trashed
  // project where the rest of the team keeps working.
  if (!row || row.key.revokedAt || row.deletedAt) return null;
  const record = mapApiKeyRow(row.key);
  if (isApiKeyExpired(record)) return null;
  // A key stands for the person who made it, so it leaves the workspace with them.
  const [creator] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, record.workspaceId), eq(workspaceMembers.userId, record.createdBy)))
    .limit(1);
  if (!creator) return null;
  if (options.recordUse !== false) {
    const at = nowIso();
    await recordApiKeyUsage(record.id, at, options.ip ?? null);
    record.lastUsedAt = at;
    if (options.ip) record.lastUsedIp = options.ip;
  }
  return record;
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
  const pending = await pendingApiKeyUsage();
  const rows = await getDb()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(apiKeys.createdAt);
  return rows.map((row) => {
    const record = mapApiKeyRow(row);
    const use = pending.get(row.id);
    if (use && (!record.lastUsedAt || use.at >= record.lastUsedAt)) {
      record.lastUsedAt = use.at;
      record.lastUsedIp = use.ip ?? record.lastUsedIp;
    }
    return record;
  });
}

export async function revokeApiKey(workspaceId: string, id: string, actorId: string) {
  const db = getDb();
  const [key] = await db
    .select({ createdBy: apiKeys.createdBy, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
    .limit(1);
  if (!key || key.revokedAt) return;
  const facts = await workspaceFacts(workspaceId, actorId);
  const allowed = key.createdBy === actorId || facts.ownerId === actorId || facts.role === "admin";
  if (!allowed) throw new TacosError("Only the key's owner or an admin can revoke it", 403);
  await db
    .update(apiKeys)
    .set({ revokedAt: nowIso() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)));
}

// Rotation keeps the key's name, scopes, projects and remaining lifetime, revokes the old
// row in the same transaction and shows the replacement exactly once. The old key stops
// working immediately; a grace window is a follow-up, not part of this PR.
export async function rotateApiKey(
  workspaceId: string,
  id: string,
  actorId: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)))
    .limit(1);
  if (!row || row.revokedAt) throw new TacosError("API key not found", 404);
  const facts = await workspaceFacts(workspaceId, actorId);
  const allowed = row.createdBy === actorId || facts.ownerId === actorId || facts.role === "admin";
  if (!allowed) throw new TacosError("Only the key's owner or an admin can rotate it", 403);
  const [creator] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, row.createdBy)))
    .limit(1);
  if (!creator) {
    throw new TacosError("The key's creator has left this workspace. Revoke the key instead.", 409);
  }
  const old = mapApiKeyRow(row);
  const key = generateApiKey();
  const now = nowIso();
  if (old.expiresAt !== null && Date.parse(old.expiresAt) <= Date.now()) {
    throw new TacosError("This key has expired. Create a new key instead.", 400);
  }
  if (old.expiresAt === null && !(facts.ownerId === actorId || facts.role === "admin")) {
    throw new TacosError("Only a workspace admin can rotate a never-expiring key", 403);
  }
  const remainingMs = old.expiresAt === null ? null : Math.max(0, Date.parse(old.expiresAt) - Date.now());
  const record: ApiKeyRecord = {
    id: crypto.randomUUID(),
    workspaceId,
    name: old.name,
    createdBy: old.createdBy,
    createdAt: now,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    scopes: old.scopes,
    projectIds: old.projectIds,
    expiresAt: remainingMs === null ? null : new Date(Date.now() + remainingMs).toISOString(),
    rotatedFrom: old.id,
    keyPrefix: key.slice(0, 8),
    last4: key.slice(-4),
  };
  db.transaction((tx) => {
    const revoked = tx.update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId), isNull(apiKeys.revokedAt)))
      .run();
    if (revoked.changes === 0) throw new TacosError("API key was already rotated or revoked. Reload and retry.", 409);
    tx.insert(apiKeys)
      .values({
        id: record.id,
        workspaceId,
        name: record.name,
        keyHash: sha256(key),
        createdBy: record.createdBy,
        createdAt: now,
        lastUsedAt: null,
        lastUsedIp: null,
        revokedAt: null,
        scopes: record.scopes ? JSON.stringify(record.scopes) : null,
        projectIds: record.projectIds ? JSON.stringify(record.projectIds) : null,
        expiresAt: record.expiresAt,
        rotatedFrom: record.rotatedFrom,
        keyPrefix: record.keyPrefix,
        last4: record.last4,
      })
      .run();
  });
  return { key, record };
}

// H-COLLAB-11: the due moment is the end of the due day in server local time.
function reminderFireAt(dueDate: string, preset: ReminderPreset): Date {
  const [y, m, d] = dueDate.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59);
  return new Date(end.getTime() - REMINDER_META[preset].hours * 3600_000);
}

// Sends one "due_soon" notice per task when now reaches dueDate minus the preset.
// The creator, the claimer and the assignees get it. Returns the number of tasks.
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  const db=getDb();
  // A single transaction owns the claim and every recipient insert. A crash rolls
  // both back, and another process can safely retry the same schedule key.
  return db.transaction(tx=>{
    const rows=tx.select().from(issues).where(sql`reminder_next_fire IS NOT NULL AND reminder_next_fire <= ${Math.floor(now.getTime()/1000)}`).orderBy(sql`reminder_next_fire`).limit(100).all();
    const assigned=rows.length?tx.select().from(issueAssignees).where(inArray(issueAssignees.issueId,rows.map(row=>row.id))).all():[];
    const byTask=new Map<string,string[]>();for(const entry of assigned){const list=byTask.get(entry.issueId)??[];list.push(entry.userId);byTask.set(entry.issueId,list);}
    let sent=0;
    for(const row of rows){const preset=row.reminder as ReminderPreset;if(!row.dueDate||!REMINDER_META[preset])continue;
      const key=`${row.dueDate}|${preset}`;
      if(row.reminderSentFor===key||reminderFireAt(row.dueDate,preset)>now)continue;
      tx.update(issues).set({reminderSentFor:key}).where(eq(issues.id,row.id)).run();
      const people=new Set([row.createdBy,row.claimedBy,...(byTask.get(row.id)??[])].filter((id):id is string=>Boolean(id)));
      for(const userId of people){
        // Due reminders follow the same preferences/mutes as the rest of the Inbox.
        const prefRow=tx.select({prefs:notificationPrefs.prefs}).from(notificationPrefs)
          .where(and(eq(notificationPrefs.workspaceId,row.workspaceId),eq(notificationPrefs.userId,userId))).get();
        if(prefRow?.prefs){
          try{const types=(JSON.parse(prefRow.prefs) as {types?:Record<string,boolean>}).types;if(types?.reminders===false)continue;}catch{/* bad JSON means defaults */}
        }
        const mute=tx.select({scopeId:notificationMutes.scopeId}).from(notificationMutes)
          .where(and(
            eq(notificationMutes.workspaceId,row.workspaceId),
            eq(notificationMutes.userId,userId),
            or(
              and(eq(notificationMutes.scopeType,"issue"),eq(notificationMutes.scopeId,row.id)),
              and(eq(notificationMutes.scopeType,"project"),eq(notificationMutes.scopeId,row.projectId))
            )
          )).get();
        if(mute)continue;
        tx.insert(notifications).values({id:crypto.randomUUID(),workspaceId:row.workspaceId,userId,issueId:row.id,type:"due_soon",body:row.dueDate,data:JSON.stringify({date:row.dueDate}),state:"unread",createdAt:nowIso()}).run();
      }
      sent++;
    }
    return sent;
  },{behavior:"immediate"});
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;
// Starts the reminder scheduler once per server process (every minute).
export function startDueReminderScheduler(intervalMs = 60_000) {
  if (reminderTimer) return;
  const tick = () => void sendDueReminders().catch((err) => console.error("due reminders:", err));
  tick();
  reminderTimer = setInterval(tick, intervalMs);
  reminderTimer.unref?.();
}

export async function workspaceRevisions(workspaceId:string,userId:string):Promise<Record<string,number>>{
 const rows=await getDb().all<{domain:string;revision:number}>(sql`SELECT domain,revision FROM workspace_revisions WHERE workspace_id IN (${workspaceId},${"@user:"+userId})`);
 return Object.fromEntries(rows.map(row=>[row.domain,row.revision]));
}

// H-COLLAB-13: a short fingerprint of what other members can change in a workspace:
// tasks (edits, claims, deletes), activity, comments, agent messages, and this user's
// notices. A window polls it and refreshes when it changes.
export async function workspacePulse(workspaceId: string, userId: string): Promise<string> {
  const rows = await getDb().all<{ workspace_id: string; domain: string; revision: number }>(sql`
    SELECT workspace_id, domain, revision FROM workspace_revisions
    WHERE workspace_id IN (${workspaceId}, ${"@user:" + userId})
    ORDER BY workspace_id, domain
  `);
  return crypto.createHash("sha1").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
}

/** A single checkbox changes one relationship; another editor's choices survive. */
export async function changeIssueCollection(workspaceId: string, id: string, change: {kind: "assignee" | "label"; value: string; selected: boolean}, actor: MutationActor): Promise<IssueDetail> {
  if (actor.kind !== "user") throw new TacosError("A member is required", 403);
  if (!(await findVisibleIssueRow(workspaceId, id, actor.userId))) throw new TacosError("Task not found",404);
  const db = getDb();
  const memberMap = await membersById(workspaceId);
  let added: string | null = null;
  db.transaction((tx) => {
    const now = nowIso();
    let before: string[], after: string[];
    if (change.kind === "assignee") {
      if (!memberMap.has(change.value)) throw new TacosError("Assignee is not a member of this workspace",400);
      before = tx.select().from(issueAssignees).where(eq(issueAssignees.issueId,id)).all().map((row) => row.userId);
      if (change.selected) tx.insert(issueAssignees).values({issueId:id,userId:change.value,createdAt:now}).onConflictDoNothing().run();
      else tx.delete(issueAssignees).where(and(eq(issueAssignees.issueId,id),eq(issueAssignees.userId,change.value))).run();
      after = tx.select().from(issueAssignees).where(eq(issueAssignees.issueId,id)).all().map((row) => row.userId);
      if (!before.includes(change.value) && change.selected) added = change.value;
    } else {
      const label = tx.select().from(labels).where(and(eq(labels.workspaceId,workspaceId),eq(labels.name,change.value))).get();
      if (!label) throw new TacosError("Label not found",404);
      const names = () => tx.select({name:labels.name}).from(issueLabels).innerJoin(labels,eq(labels.id,issueLabels.labelId)).where(eq(issueLabels.issueId,id)).all().map((row) => row.name);
      before = names();
      if (change.selected) tx.insert(issueLabels).values({issueId:id,labelId:label.id}).onConflictDoNothing().run();
      else tx.delete(issueLabels).where(and(eq(issueLabels.issueId,id),eq(issueLabels.labelId,label.id))).run();
      after = names();
    }
    if (JSON.stringify([...before].sort()) === JSON.stringify([...after].sort())) return;
    tx.update(issues).set({updatedAt:now}).where(eq(issues.id,id)).run();
    tx.insert(events).values({id:crypto.randomUUID(),issueId:id,type:change.kind === "assignee" ? "assignee_changed" : "labels_changed",data:JSON.stringify({from:before,to:after}),createdAt:now,...actorFields(actor)}).run();
  });
  const detail = await getIssueDetail(workspaceId,id,actor.userId);
  if (!detail) throw new TacosError("Task not found",404);
  if (added && added !== actor.userId) await notifyAssigned(workspaceId,id,detail.issue.title,added,actor);
  return detail;
}
