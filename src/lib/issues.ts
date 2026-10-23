import crypto from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  apiKeys,
  comments,
  events,
  favorites,
  issueAssignees,
  issueLabels,
  issues,
  joinCodes,
  labels,
  notifications,
  projectMembers,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import {
  LABEL_COLORS,
  PROJECT_COLORS,
  DEFAULT_PROJECT_COLOR,
  STATUS_ORDER,
  type Priority,
  type Status,
  type Via,
} from "./constants";

export { LABEL_COLORS, PRIORITY_NAMES, STATUS_ORDER, STATUS_META } from "./constants";
export type { Priority, Status, Via } from "./constants";

export class TacosError extends Error {
  status: number;
  hint?: string;

  constructor(message: string, status = 400, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

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
  // null for agent-created issues; the creator and assignees own status changes
  createdBy: string | null;
  createdVia: Via;
  createdAt: string;
  updatedAt: string;
};
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
  const workspaceIssues = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.workspaceId, workspaceId));
  for (const row of workspaceIssues) {
    await db.delete(issueAssignees).where(eq(issueAssignees.issueId, row.id));
    await db.delete(issueLabels).where(eq(issueLabels.issueId, row.id));
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
  description: projects.description,
  createdBy: projects.createdBy,
};

export async function listProjects(workspaceId: string): Promise<Project[]> {
  return getDb()
    .select(projectColumns)
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
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

// The sidebar's Favorites group: projects this user starred, newest star first.
// Trashed projects drop out of the list but keep their row, so un-trashing brings the
// star back.
export async function listFavoriteProjects(workspaceId: string, userId: string): Promise<Project[]> {
  return getDb()
    .select(projectColumns)
    .from(favorites)
    .innerJoin(projects, eq(projects.id, favorites.projectId))
    .where(
      and(
        eq(favorites.userId, userId),
        eq(projects.workspaceId, workspaceId),
        isNull(projects.deletedAt)
      )
    )
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
async function assertProjectCreator(workspaceId: string, projectId: string, userId: string) {
  const project = await findProjectById(workspaceId, projectId);
  if (!project) throw new TacosError("Project not found", 404);
  if (project.createdBy !== userId) {
    throw new TacosError("Only the project creator can delete this project", 403);
  }
}

export async function trashProject(workspaceId: string, projectId: string, userId: string) {
  await assertProjectCreator(workspaceId, projectId, userId);
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
  patch: { name?: string; description?: string; doc?: string; color?: string }
): Promise<Project> {
  const next: Partial<typeof projects.$inferInsert> = {};
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
    if (patch.doc.length > 50_000) throw new TacosError("Document is too long (50k characters max)");
    next.doc = patch.doc;
  }
  if (patch.color != null) {
    if (!PROJECT_COLORS.includes(patch.color)) throw new TacosError("Unknown project color");
    next.color = patch.color;
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
  await assertProjectCreator(workspaceId, projectId, userId);
  const db = getDb();
  const rows = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), eq(issues.projectId, projectId)));
  for (const row of rows) {
    await db.delete(issueLabels).where(eq(issueLabels.issueId, row.id));
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
  const { id, workspaceId: ws, name, key, color, description, doc, createdBy } = row;
  return {
    id,
    workspaceId: ws,
    name,
    key,
    color,
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
      createdBy: row.createdBy,
      createdVia: row.createdVia as Via,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      labels: (byIssue.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export type ListFilters = {
  status?: Status | "active" | "all";
  priority?: Priority;
  projectId?: string;
  assigneeId?: string | null; // null = unassigned
  createdByUserId?: string; // "My issues" (assigned or created) handled by caller
  q?: string;
  label?: string;
  limit?: number;
};

// Totals for a project's Overview page; grouped in SQL so the count stays right
// however large the backlog gets.
export async function countIssuesByStatus(
  workspaceId: string,
  projectId: string
): Promise<Record<Status, number> & { total: number }> {
  const rows = await getDb()
    .select({ status: issues.status, n: sql<number>`COUNT(*)` })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt)
      )
    )
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
    sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.deleted_at IS NULL)`,
  ];

  if (filters.status === "active") {
    conditions.push(inArray(issues.status, ["todo", "in_progress"]));
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
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.updatedAt.localeCompare(a.updatedAt);
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
  idOrIdentifier: string
): Promise<IssueDetail | null> {
  const row = await findIssueRow(workspaceId, idOrIdentifier);
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

async function notify(input: {
  workspaceId: string;
  userId: string;
  issueId: string;
  type: "assigned" | "commented";
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

type MutationActor =
  | { kind: "user"; userId: string; displayName: string }
  | { kind: "agent"; label: string; via: Via };

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

async function recordEvent(
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
  project: string;
};
export type UpdateIssueInput = {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  assigneeIds?: string[];
  labelNames?: string[];
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
  const id = crypto.randomUUID();
  const now = nowIso();
  const actorUserId = actor.kind === "user" ? actor.userId : null;

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
    (id, workspace_id, project_id, number, identifier, title, description, status, priority, created_by, created_via, created_at, updated_at)
    VALUES (${id}, ${workspaceId}, ${project.id},
      (SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE project_id = ${project.id}),
      'pending', ${title}, ${description}, ${status}, ${priority},
      ${actorUserId}, ${actor.kind === "agent" ? actor.via : "web"}, ${now}, ${now})`);
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
  if (row.createdBy === actor.userId) return;
  const assigned = await getDb()
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, row.id));
  if (assigned.some((entry) => entry.userId === actor.userId)) return;
  // Agent-created issues with nobody assigned have no human owner to protect.
  if (!row.createdBy && assigned.length === 0) return;
  throw new TacosError(
    "Only the issue's creator or assignees can change its status",
    403,
    "Ask the creator or one of the assignees to move it"
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

// Deleting an issue sends it to the Trash rather than erasing it: comments and history
// stay attached so a restore brings the issue back exactly as it was.
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
    createdBy: row.createdBy,
    createdVia: row.createdVia as Via,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
  await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
  await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
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
  actor: MutationActor
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
  const who = actor.kind === "user" ? actor.displayName : `Agent (${actor.label})`;
  for (const userId of targets) {
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
      type: notifications.type,
      body: notifications.body,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(issues, eq(issues.id, notifications.issueId))
    .leftJoin(projects, eq(projects.id, issues.projectId))
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
