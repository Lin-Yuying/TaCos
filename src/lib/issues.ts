import { TacosError } from "./tacos-error";
import { removeWorkspaceAttachments } from "./attachments";
import crypto from "node:crypto";
import { mentionText, parseMentions } from "./mentions";
import {
  and,
  desc,
  eq,
  gt,
  inArray,
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
  issueLabels,
  taskFieldValues,
  taskFields,
  issues,
  joinCodes,
  labels,
  notifications,
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
  STATUS_ORDER,
  type Priority,
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
  projectKey: string;
  projectName: string;
  assignees: Assignee[];
  // YYYY-MM-DD, chosen from the calendar in the task panel
  dueDate: string | null;
  reminder: ReminderPreset | null;
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
export type IssueDetail = {
  issue: IssueWithLabels;
  comments: Comment[];
  events: ActivityEvent[];
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
async function purgeWorkspaceData(db: ReturnType<typeof getDb>, workspaceId: string) {
  const workspacePages = db.select({ id: pages.id }).from(pages).where(eq(pages.workspaceId, workspaceId));
  await db.delete(pageCollab).where(inArray(pageCollab.pageId, workspacePages));
  await db.delete(pageAccess).where(inArray(pageAccess.pageId, workspacePages));
  await db.delete(pageFavorites).where(inArray(pageFavorites.pageId, workspacePages));
  await removeWorkspaceAttachments(workspaceId);
  await db.delete(pageVersions).where(eq(pageVersions.workspaceId, workspaceId));
  await db.delete(pageComments).where(eq(pageComments.workspaceId, workspaceId));
  await db.delete(pages).where(eq(pages.workspaceId, workspaceId));
  const workspaceIssues = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.workspaceId, workspaceId));
  await db.delete(taskFields).where(eq(taskFields.workspaceId, workspaceId));
  for (const row of workspaceIssues) {
    await db.delete(taskFieldValues).where(eq(taskFieldValues.issueId, row.id));
    await db.delete(issueAssignees).where(eq(issueAssignees.issueId, row.id));
    await db.delete(issueLabels).where(eq(issueLabels.issueId, row.id));
    await db.delete(blockers).where(eq(blockers.issueId, row.id));
    await db.delete(comments).where(eq(comments.issueId, row.id));
    await db.delete(events).where(eq(events.issueId, row.id));
  }
  await db.delete(issues).where(eq(issues.workspaceId, workspaceId));

  const workspaceProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  if (workspaceProjects.length > 0) {
    const ids = workspaceProjects.map((row) => row.id);
    await db.delete(projectMembers).where(inArray(projectMembers.projectId, ids));
    await db.delete(favorites).where(inArray(favorites.projectId, ids));
  }
  await db.delete(projects).where(eq(projects.workspaceId, workspaceId));

  await db.delete(labels).where(eq(labels.workspaceId, workspaceId));
  await db.delete(notifications).where(eq(notifications.workspaceId, workspaceId));
  await db.delete(joinCodes).where(eq(joinCodes.workspaceId, workspaceId));
  await db.delete(apiKeys).where(eq(apiKeys.workspaceId, workspaceId));
  await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

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
      // Workspace notices have no issue; the empty id keeps the column shape and the
      // inbox renders them from the body alone.
      issueId: "",
      type: "workspace_deleted",
      body: `${owner?.displayName ?? "The owner"} deleted the workspace "${workspace.name}".`,
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

export type TrashedProject = Project & { deletedAt: string; issueCount: number };

export async function listTrashedProjects(workspaceId: string): Promise<TrashedProject[]> {
  const rows = await getDb()
    .select({
      ...projectColumns,
      deletedAt: projects.deletedAt,
      issueCount: sql<number>`(SELECT COUNT(*) FROM issues WHERE issues.project_id = ${projects.id})`,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNotNull(projects.deletedAt)))
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
    .orderBy(sql`${favorites.createdAt} DESC`);
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

export async function createProject(input: {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
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

export async function restoreProject(workspaceId: string, projectId: string) {
  await getDb()
    .update(projects)
    .set({ deletedAt: null })
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
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
    .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(projectMembers.createdAt);

  const members = joined.map((row) => ({ ...row, role: "member" as const }));
  if (!project?.createdBy) return members;

  const [lead] = await db
    .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
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
  await assertProjectOwner(workspaceId, projectId, userId);
  const db = getDb();
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.projectId, projectId)));
  for (const row of rows) {
    await db.delete(taskFieldValues).where(eq(taskFieldValues.issueId, row.id));
    await db.delete(issueLabels).where(eq(issueLabels.issueId, row.id));
    await db.delete(blockers).where(eq(blockers.issueId, row.id));
    await db.delete(comments).where(eq(comments.issueId, row.id));
    await db.delete(events).where(eq(events.issueId, row.id));
    await db.delete(notifications).where(eq(notifications.issueId, row.id));
  }
  await db.delete(issues).where(eq(issues.projectId, projectId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(favorites).where(eq(favorites.projectId, projectId));
  await db.delete(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
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
  idOrKey: string
): Promise<(Project & { doc: string }) | null> {
  const row = await findProjectRow(workspaceId, idOrKey);
  if (!row) return null;
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
      projectKey: project?.key ?? "?",
      projectName: project?.name ?? "Unknown",
      assignees: assigneesByIssue.get(row.id) ?? [],
      dueDate: row.dueDate ?? null,
      reminder: (row.reminder as ReminderPreset | null) ?? null,
      createdBy: row.createdBy,
      createdVia: row.createdVia as Via,
      claimedBy: row.claimedBy ?? null,
      claimedAt: row.claimedAt ?? null,
      publishedBy: row.publishedBy ?? null,
      sourceThreadId: row.sourceThreadId ?? null,
      reviewStatus: row.reviewStatus as ReviewStatus,
      reviewedBy: row.reviewedBy ?? null,
      reviewedAt: row.reviewedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      labels: (byIssue.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export type ListFilters = {
  status?: Status | "active" | "open" | "all";
  priority?: Priority;
  projectId?: string;
  assigneeId?: string | null; // null = unassigned
  createdByUserId?: string; // "My tasks" (assigned or created) handled by caller
  q?: string;
  label?: string;
  limit?: number;
  // The signed-in user. Omitted by agents, which are unrestricted; when present it
  // applies the workspace's task-visibility setting.
  viewerId?: string;
  // Tasks that one agent chat published (H-COLLAB-07).
  sourceThreadId?: string;
  // Tasks an agent created (API or MCP), not ones a person opened in the app.
  agent?: boolean;
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

export async function listIssues(
  workspaceId: string,
  filters: ListFilters = {}
): Promise<IssueWithLabels[]> {
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

  if (filters.sourceThreadId) {
    conditions.push(eq(issues.sourceThreadId, filters.sourceThreadId));
  }
  if (filters.agent) {
    conditions.push(inArray(issues.createdVia, ["api", "mcp"]));
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
  if (filters.assigneeId === null) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM issue_assignees WHERE issue_assignees.issue_id = ${issues.id})`
    );
  } else if (filters.assigneeId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM issue_assignees WHERE issue_assignees.issue_id = ${issues.id} AND issue_assignees.user_id = ${filters.assigneeId})`
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
    if (!labelRow) return [];
    const matched = await db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(eq(issueLabels.labelId, labelRow.id));
    const ids = matched.map((m) => m.issueId);
    if (ids.length === 0) return [];
    conditions.push(inArray(issues.id, ids));
  }

  const rows = await db
    .select()
    .from(issues)
    .where(and(...conditions));
  const sorted = rows.sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status as Status);
    const sb = STATUS_ORDER.indexOf(b.status as Status);
    if (sa !== sb) return sa - sb;
    // Manual board order wins: new issues are created at the top and dragging a card
    // persists its slot, so priority is no longer the sort key here.
    if (a.position !== b.position) return b.position - a.position;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const limited = filters.limit ? sorted.slice(0, filters.limit) : sorted;
  return toIssueRows(workspaceId, limited);
}

export async function findIssueRow(workspaceId: string, idOrIdentifier: string): Promise<IssueRow | null> {
  const raw = idOrIdentifier.trim();
  const db = getDb();
  const [row] = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        isNull(issues.deletedAt),
        sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.deleted_at IS NULL)`,
        // The UI labels issues "<project name>-<number>", so accept that spelling
        // alongside the stored key-based identifier and the row id.
        or(
          eq(issues.id, raw),
          sql`${issues.identifier} = ${raw} COLLATE NOCASE`,
          sql`(SELECT p.name FROM projects p WHERE p.id = ${issues.projectId}) || '-' || ${issues.number} = ${raw} COLLATE NOCASE`
        )
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getIssueDetail(
  workspaceId: string,
  idOrIdentifier: string,
  viewerId?: string
): Promise<IssueDetail | null> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) return null;
  const db = getDb();
  if (viewerId && !(await seesAllTasks(workspaceId, viewerId))) {
    // Same rule as the list: a member outside the project cannot open its tasks by id.
    const [visible] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, row.projectId),
          isNull(projects.deletedAt),
          ownProjectCondition(viewerId)
        )
      )
      .limit(1);
    if (!visible) return null;
  }
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
  };
}

export async function notify(input: {
  workspaceId: string;
  userId: string;
  issueId: string;
  type: "assigned" | "commented" | "mentioned" | "due_soon" | "handoff_done" | "handoff_failed" | "handoff_waiting" | "blocker" | ClaimNotice;
  body: string;
}) {
  await getDb().insert(notifications).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    issueId: input.issueId,
    type: input.type,
    body: input.body,
    createdAt: nowIso(),
  });
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
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeIds?: string[];
  labelNames?: string[];
  dueDate?: string | null;
  reminder?: ReminderPreset | null;
  project: string;
};
export type UpdateIssueInput = {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeIds?: string[];
  labelNames?: string[];
  dueDate?: string | null;
  reminder?: ReminderPreset | null;
};

function normalizeDueDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new TacosError("Due date must be a calendar date (YYYY-MM-DD)");
  }
  return text;
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
  const reminder = dueDate ? normalizeReminder(input.reminder) : null;
  const id = crypto.randomUUID();
  const now = nowIso();
  const actorUserId = actor.kind === "user" ? actor.userId : null;
  const publisherId = actor.kind === "user" ? actor.userId : actor.publishedBy ?? null;
  const reviewStatus: ReviewStatus = actor.kind === "agent" ? "pending" : "approved";
  const sourceThreadId = actor.kind === "agent" ? actor.sourceThreadId ?? null : null;

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
  await db.run(sql`INSERT INTO issues
    (id, workspace_id, project_id, number, identifier, title, description, status, priority, due_date, reminder, created_by, published_by, review_status, source_thread_id, created_via, created_at, updated_at, position)
    VALUES (${id}, ${workspaceId}, ${project.id},
      (SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ${project.id}),
      'pending', ${title}, ${description}, ${status}, ${priority}, ${dueDate}, ${reminder},
      ${publisherId}, ${publisherId}, ${reviewStatus}, ${sourceThreadId},
      ${actor.kind === "agent" ? actor.via : "web"}, ${now}, ${now},
      (SELECT COALESCE(MAX(position), 0) + 1 FROM issues WHERE workspace_id = ${workspaceId}))`);
  await db.run(
    sql`UPDATE issues SET identifier = ${project.key} || '-' || number WHERE id = ${id}`
  );

  const labelRecords = await getOrCreateLabels(workspaceId, input.labelNames ?? []);
  for (const label of labelRecords) {
    await db.insert(issueLabels).values({ issueId: id, labelId: label.id });
  }
  for (const assigneeId of assigneeIds) {
    await db.insert(issueAssignees).values({ issueId: id, userId: assigneeId, createdAt: now });
  }
  await recordEvent(id, "created", { title }, actor);
  if (description) await notifyMentions(workspaceId, id, description, actor);

  for (const assigneeId of assigneeIds) {
    if (assigneeId !== actorUserId) {
      await notifyAssigned(workspaceId, id, title, assigneeId, actor);
    }
  }

  const detail = await getIssueDetail(workspaceId, id);
  if (!detail) throw new TacosError("Failed to create issue", 500);
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
    body: `${who} assigned you to “${issueTitle}”`,
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

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while updating", 500);
  return detail;
}

export async function moveIssue(
  workspaceId: string,
  idOrIdentifier: string,
  input: MoveIssueInput,
  actor: MutationActor
): Promise<IssueDetail> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);

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

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while moving", 500);
  return detail;
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
export async function claimIssue(workspaceId: string, idOrIdentifier: string, userId: string): Promise<IssueClaim> {
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
  await recordEvent(row.id, "claimed", {}, await userActor(userId));
  await notifyClaimWatchers(workspaceId, row.id, "claimed", userId);
  return { id: row.id, identifier: row.identifier, claimedBy: userId, claimedAt: now };
}

// Only the current claimer can release. Reassign comes in a later id with notifications.
export async function releaseIssue(workspaceId: string, idOrIdentifier: string, userId: string): Promise<IssueClaim> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const updated = await getDb()
    .update(issues)
    .set({ claimedBy: null, claimedAt: null, updatedAt: nowIso() })
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, row.id), eq(issues.claimedBy, userId)))
    .returning({ id: issues.id });
  if (updated.length === 0) throw new TacosError("Only the person who claimed this task can release it", 403);
  await recordEvent(row.id, "released", {}, await userActor(userId));
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
    await notify({ workspaceId, userId: toUserId, issueId: row.id, type: "claim_transferred", body: actor.displayName });
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
  const actorUserId = actor.kind === "user" ? actor.userId : null;
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  for (const member of await listMembers(workspaceId)) {
    if (!names.includes(member.username.toLowerCase())) continue;
    if (member.id === actorUserId || skip.has(member.id)) continue;
    await notify({ workspaceId, userId: member.id, issueId, type: "mentioned", body: who });
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

export async function reportBlocker(
  workspaceId: string,
  idOrIdentifier: string,
  body: string,
  actor: MutationActor
): Promise<{ id: string }> {
  if (actor.kind !== "user") throw new TacosError("Only a member can report a blocker", 403);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) throw new TacosError("Say what is blocking this task", 400);
  const row = await findIssueRow(workspaceId, idOrIdentifier);
  if (!row) throw new TacosError(`Issue "${idOrIdentifier}" not found`, 404);
  const id = crypto.randomUUID();
  await getDb().insert(blockers).values({
    id,
    issueId: row.id,
    authorId: actor.userId,
    body: text,
    createdAt: nowIso(),
  });
  await recordEvent(row.id, "blocker_reported", { body: text }, actor);
  for (const userId of await blockerRecipient(workspaceId, row, actor.userId)) {
    await notify({ workspaceId, userId, issueId: row.id, type: "blocker", body: actor.displayName });
  }
  return { id };
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
    await notify({ workspaceId, userId, issueId, type, body: actor.displayName });
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
export async function reviewIssue(
  workspaceId: string,
  idOrIdentifier: string,
  reviewerId: string,
  decision: ReviewDecision
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
  await recordEvent(row.id, decision === "approve" ? "review_approved" : "review_rejected", {}, {
    kind: "user",
    userId: reviewerId,
    displayName: "",
  });
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
    projectKey: "",
    projectName: "",
    assignees: [],
    dueDate: row.dueDate ?? null,
    reminder: (row.reminder as ReminderPreset | null) ?? null,
    createdBy: row.createdBy,
    createdVia: row.createdVia as Via,
    claimedBy: row.claimedBy ?? null,
    claimedAt: row.claimedAt ?? null,
    publishedBy: row.publishedBy ?? null,
    sourceThreadId: row.sourceThreadId ?? null,
    reviewStatus: row.reviewStatus as ReviewStatus,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt ?? null,
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
    projectName: row.projectName ?? "(no project)",
    projectColor: row.projectColor ?? DEFAULT_PROJECT_COLOR,
  }));
}

export async function restoreIssue(workspaceId: string, issueId: string) {
  await getDb()
    .update(issues)
    .set({ deletedAt: null })
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.id, issueId),
        isNotNull(issues.deletedAt)
      )
    );
}

// Only ever called from the Trash, so the issue has to be soft-deleted first.
export async function purgeIssue(workspaceId: string, issueId: string) {
  const db = getDb();
  await db.delete(taskFieldValues).where(eq(taskFieldValues.issueId, issueId));
  await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
  await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
  await db.delete(blockers).where(eq(blockers.issueId, issueId));
  await db.delete(comments).where(eq(comments.issueId, issueId));
  await db.delete(events).where(eq(events.issueId, issueId));
  await db.delete(notifications).where(eq(notifications.issueId, issueId));
  await db
    .delete(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.id, issueId),
        isNotNull(issues.deletedAt)
      )
    );
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
      body: `${who} commented on “${row.title}”`,
    });
  }

  const detail = await getIssueDetail(workspaceId, row.id);
  if (!detail) throw new TacosError("Issue disappeared while commenting", 500);
  return detail;
}

// --- notifications ---

export type NotificationRow = {
  id: string;
  issueId: string;
  issueIdentifier: string;
  issueNumber: number | null;
  issueProjectName: string | null;
  issueTitle: string;
  pageId: string | null;
  pageTitle: string | null;
  type: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export async function listNotifications(workspaceId: string, userId: string): Promise<NotificationRow[]> {
  const rows = await getDb()
    .select({
      id: notifications.id,
      issueId: notifications.issueId,
      issueIdentifier: issues.identifier,
      issueNumber: issues.number,
      issueProjectName: projects.name,
      issueTitle: issues.title,
      pageId: notifications.pageId,
      pageTitle: pages.title,
      type: notifications.type,
      body: notifications.body,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(issues, eq(issues.id, notifications.issueId))
    .leftJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(pages, eq(pages.id, notifications.pageId))
    // A deleted workspace cannot be opened, so its farewell notice follows the member
    // into whichever workspace they still have.
    .where(
      and(
        eq(notifications.userId, userId),
        or(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted"))
      )
    )
    .orderBy(sql`${notifications.createdAt} DESC`)
    .limit(50);
  return rows.map((row) => ({
    ...row,
    issueIdentifier: row.issueIdentifier ?? "(deleted issue)",
    issueTitle: row.issueTitle ?? "(deleted issue)",
  }));
}

export async function unreadNotificationCount(workspaceId: string, userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        or(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted"))
      )
    );
  return Number(row?.n ?? 0);
}

// Members whose only workspace was deleted have no Inbox to read the farewell in;
// the onboarding screen shows these rows instead.
export type WorkspaceDeletionNotice = { id: string; workspaceId: string; body: string; createdAt: string };

export async function listWorkspaceDeletionNotices(userId: string): Promise<WorkspaceDeletionNotice[]> {
  return getDb()
    .select({
      id: notifications.id,
      workspaceId: notifications.workspaceId,
      body: notifications.body,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "workspace_deleted"),
        isNull(notifications.readAt)
      )
    )
    .orderBy(sql`${notifications.createdAt} DESC`)
    .limit(5);
}

export async function markNotificationsRead(workspaceId: string, userId: string) {
  await getDb()
    .update(notifications)
    .set({ readAt: nowIso() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        // Same set the inbox shows and the badge counts: this workspace plus any
        // workspace-deletion notices, so "Mark all read" actually clears the badge.
        or(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted"))
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
    .set({ readAt: nowIso() })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.id, notificationId),
        isNull(notifications.readAt)
      )
    );
}

// Same recipient-only scoping as markNotificationRead: a row is personal, and a
// deletion notice may belong to a workspace the user can no longer open.
export async function deleteNotification(userId: string, notificationId: string) {
  await getDb()
    .delete(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.id, notificationId)));
}

export async function clearNotifications(workspaceId: string, userId: string) {
  await getDb()
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        // Exactly the set the inbox lists and the badge counts.
        or(eq(notifications.workspaceId, workspaceId), eq(notifications.type, "workspace_deleted"))
      )
    );
}

// --- API keys ---

export type ApiKeyRecord = {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateApiKey() {
  return `tac_${crypto.randomBytes(24).toString("hex")}`;
}

export async function createApiKey(
  workspaceId: string,
  name: string,
  createdBy: string
): Promise<{ key: string; record: ApiKeyRecord }> {
  const trimmed = name.trim();
  if (!trimmed) throw new TacosError("API key name is required");
  const key = generateApiKey();
  const record = {
    id: crypto.randomUUID(),
    workspaceId,
    name: trimmed,
    createdAt: nowIso(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await getDb().insert(apiKeys).values({ ...record, keyHash: sha256(key), createdBy });
  return { key, record };
}

export async function verifyApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
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
  const record = row.key;
  // A key stands for the person who made it, so it leaves the workspace with them.
  const [creator] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, record.workspaceId), eq(workspaceMembers.userId, record.createdBy)))
    .limit(1);
  if (!creator) return null;
  await db.update(apiKeys).set({ lastUsedAt: nowIso() }).where(eq(apiKeys.id, record.id));
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
  };
}

export async function listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
  return getDb()
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(apiKeys.createdAt);
}

export async function revokeApiKey(workspaceId: string, id: string) {
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: nowIso() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, workspaceId)));
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
  const db = getDb();
  const rows = await db
    .select({
      id: issues.id,
      workspaceId: issues.workspaceId,
      dueDate: issues.dueDate,
      reminder: issues.reminder,
      sentFor: issues.reminderSentFor,
      createdBy: issues.createdBy,
      claimedBy: issues.claimedBy,
    })
    .from(issues)
    .where(
      and(
        isNotNull(issues.dueDate),
        isNotNull(issues.reminder),
        isNull(issues.deletedAt),
        notInArray(issues.status, ["done", "canceled"])
      )
    );
  let sent = 0;
  for (const row of rows) {
    const preset = row.reminder as ReminderPreset;
    if (!row.dueDate || !REMINDER_META[preset]) continue;
    const key = `${row.dueDate}|${preset}`;
    if (row.sentFor === key || reminderFireAt(row.dueDate, preset) > now) continue;
    // Claim the key first so two overlapping runs cannot both send.
    const claimed = await db
      .update(issues)
      .set({ reminderSentFor: key })
      .where(and(eq(issues.id, row.id), or(isNull(issues.reminderSentFor), ne(issues.reminderSentFor, key))))
      .returning({ id: issues.id });
    if (claimed.length === 0) continue;
    const people = new Set<string>();
    if (row.createdBy) people.add(row.createdBy);
    if (row.claimedBy) people.add(row.claimedBy);
    const assigned = await db
      .select({ userId: issueAssignees.userId })
      .from(issueAssignees)
      .where(eq(issueAssignees.issueId, row.id));
    for (const a of assigned) people.add(a.userId);
    for (const userId of people) {
      await notify({ workspaceId: row.workspaceId, userId, issueId: row.id, type: "due_soon", body: row.dueDate });
    }
    sent++;
  }
  return sent;
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

// H-COLLAB-13: a short fingerprint of what other members can change in a workspace:
// tasks (edits, claims, deletes), activity, comments, agent messages, and this user's
// notices. A window polls it and refreshes when it changes.
export async function workspacePulse(workspaceId: string, userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db.all<Record<string, string | number | null>>(sql`
    SELECT
      (SELECT count(*) || ':' || coalesce(max(updated_at), '') || ':' || coalesce(max(claimed_at), '') || ':' || coalesce(max(deleted_at), '') || ':' || coalesce(sum(claimed_by IS NULL), 0)
         FROM issues WHERE workspace_id = ${workspaceId}) AS t,
      (SELECT count(*) || ':' || coalesce(max(e.created_at), '')
         FROM events e JOIN issues i ON i.id = e.issue_id WHERE i.workspace_id = ${workspaceId}) AS e,
      (SELECT count(*) || ':' || coalesce(max(c.created_at), '')
         FROM comments c JOIN issues i ON i.id = c.issue_id WHERE i.workspace_id = ${workspaceId}) AS c,
      (SELECT count(*) || ':' || coalesce(max(m.created_at), '')
         FROM agent_messages m JOIN agent_threads th ON th.id = m.thread_id WHERE th.workspace_id = ${workspaceId}) AS m,
      (SELECT count(*) || ':' || coalesce(max(updated_at), '') || ':' || coalesce(sum(turn_user_id IS NOT NULL), 0)
         FROM agent_threads WHERE workspace_id = ${workspaceId}) AS a,
      (SELECT count(*) || ':' || coalesce(sum(read_at IS NULL), 0)
         FROM notifications WHERE workspace_id = ${workspaceId} AND user_id = ${userId}) AS n
  `);
  return crypto.createHash("sha1").update(JSON.stringify(row ?? {})).digest("hex").slice(0, 16);
}
