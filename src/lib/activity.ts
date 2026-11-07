import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  events,
  issues,
  pages,
  projectMembers,
  projects,
  users,
  watchers,
  workspaceMembers,
  workspaces,
} from "../db/schema";

/**
 * U-11 workspace activity.
 *
 * `events` already held the task timeline. It now also carries page and project rows,
 * each with the workspace, object, project and visibility captured at write time, so
 * the feed is one chronological keyset read instead of three unions. Visibility is
 * stored as a rule, not a recipient list:
 *   - workspace: every member (shared documents)
 *   - project:   only members of that project, unless the workspace shares all tasks
 *   - private:   only the object's owner (a private document)
 */
export type ActivityObjectType = "task" | "document" | "project";
export type ActivityScope = "all" | "mine" | "following";

export type ActivityActor =
  | { kind: "user"; userId: string; displayName: string }
  | { kind: "agent"; label: string };

export type RecordActivityInput = {
  workspaceId: string;
  objectType: ActivityObjectType;
  objectId: string;
  type: string;
  data?: Record<string, unknown>;
  actor: ActivityActor;
  projectId?: string | null;
  pageId?: string | null;
  ownerId?: string | null;
  visibility: "workspace" | "project" | "private";
  issueId?: string;
};

export type WorkspaceActivityItem = {
  id: string;
  type: string;
  objectType: ActivityObjectType;
  objectId: string;
  // The task id for a task event; a document or project event keeps this null.
  issueId: string | null;
  pageId: string | null;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  title: string;
  identifier: string | null;
  actor: { id: string; displayName: string; avatar: string | null } | null;
  agentActor: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceActivityPage = {
  items: WorkspaceActivityItem[];
  nextCursor: string | null;
};

export type WorkspaceActivityQuery = {
  scope?: ActivityScope;
  objectType?: ActivityObjectType;
  projectId?: string;
  personId?: string;
  cursor?: string | null;
  limit?: number;
};

type Cursor = { createdAt: string; id: string };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ k: cursor.createdAt, id: cursor.id })).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      k?: unknown;
      id?: unknown;
    };
    if (typeof value.k !== "string" || typeof value.id !== "string") throw new Error();
    return { createdAt: value.k, id: value.id };
  } catch {
    return { createdAt: new Date().toISOString(), id: "" };
  }
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function recordActivity(input: RecordActivityInput): Promise<void> {
  const actorFields =
    input.actor.kind === "user"
      ? { actorId: input.actor.userId, agentActor: null }
      : { actorId: null, agentActor: input.actor.label };
  await getDb().insert(events).values({
    id: crypto.randomUUID(),
    issueId: input.issueId ?? (input.objectType === "task" ? input.objectId : ""),
    type: input.type,
    data: JSON.stringify(input.data ?? {}),
    workspaceId: input.workspaceId,
    objectType: input.objectType,
    objectId: input.objectId,
    projectId: input.projectId ?? null,
    pageId: input.pageId ?? (input.objectType === "document" ? input.objectId : null),
    ownerId: input.ownerId ?? null,
    visibility: input.visibility,
    createdAt: new Date().toISOString(),
    ...actorFields,
  });
}

async function visibleActivityScope(workspaceId: string, viewerId: string) {
  const db = getDb();
  const [[workspace], [member]] = await Promise.all([
    db
      .select({ ownerId: workspaces.createdBy, seeAll: workspaces.membersSeeAllTasks })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1),
    db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, viewerId)
        )
      )
      .limit(1),
  ]);
  const seeAll =
    (workspace?.seeAll ?? 1) === 1 ||
    workspace?.ownerId === viewerId ||
    member?.role === "admin";
  if (seeAll) return { seeAll: true, projectIds: null as Set<string> | null };
  const [mine, joined] = await Promise.all([
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.createdBy, viewerId),
          isNotNull(projects.createdBy)
        )
      ),
    db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, viewerId)),
  ]);
  return {
    seeAll: false,
    projectIds: new Set([...mine.map((row) => row.id), ...joined.map((row) => row.id)]),
  };
}

async function followingSets(workspaceId: string, viewerId: string) {
  const rows = await getDb()
    .select({ scopeType: watchers.scopeType, scopeId: watchers.scopeId })
    .from(watchers)
    .where(and(eq(watchers.workspaceId, workspaceId), eq(watchers.userId, viewerId)));
  return {
    issue: new Set(rows.filter((row) => row.scopeType === "issue").map((row) => row.scopeId)),
    page: new Set(rows.filter((row) => row.scopeType === "page").map((row) => row.scopeId)),
    project: new Set(
      rows.filter((row) => row.scopeType === "project").map((row) => row.scopeId)
    ),
  };
}

async function hydrate(rows: (typeof events.$inferSelect)[]): Promise<WorkspaceActivityItem[]> {
  const db = getDb();
  const issueIds = [...new Set(rows.filter((row) => row.objectType === "task").map((row) => row.objectId ?? ""))].filter(Boolean);
  const pageIds = [...new Set(rows.filter((row) => row.objectType === "document").map((row) => row.objectId ?? ""))].filter(Boolean);
  const projectIds = [...new Set(rows.filter((row) => row.objectType === "project").map((row) => row.objectId ?? ""))].filter(Boolean);
  const actorIds = [...new Set(rows.map((row) => row.actorId).filter((id): id is string => Boolean(id)))];
  const projectIdsForNames = [
    ...new Set(rows.map((row) => row.projectId).filter((id): id is string => Boolean(id))),
  ];
  const [issueRows, pageRows, projectRows, actorRows, projectNameRows] = await Promise.all([
    issueIds.length
      ? db
          .select({ id: issues.id, title: issues.title, identifier: issues.identifier, projectId: issues.projectId })
          .from(issues)
          .where(inArray(issues.id, issueIds))
      : Promise.resolve([]),
    pageIds.length
      ? db.select({ id: pages.id, title: pages.title, projectId: pages.projectId }).from(pages).where(inArray(pages.id, pageIds))
      : Promise.resolve([]),
    projectIds.length
      ? db.select({ id: projects.id, name: projects.name, color: projects.color }).from(projects).where(inArray(projects.id, projectIds))
      : Promise.resolve([]),
    actorIds.length
      ? db
          .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
          .from(users)
          .where(inArray(users.id, actorIds))
      : Promise.resolve([]),
    projectIdsForNames.length
      ? db
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(inArray(projects.id, projectIdsForNames))
      : Promise.resolve([]),
  ]);
  const issueMap = new Map(issueRows.map((row) => [row.id, row]));
  const pageMap = new Map(pageRows.map((row) => [row.id, row]));
  const projectMap = new Map(projectRows.map((row) => [row.id, row]));
  const actorMap = new Map(actorRows.map((row) => [row.id, row]));
  const projectNameMap = new Map(projectNameRows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const data = parseData(row.data);
    const objectType = (row.objectType === "document" || row.objectType === "project"
      ? row.objectType
      : "task") as ActivityObjectType;
    const issue = objectType === "task" && row.objectId ? issueMap.get(row.objectId) : undefined;
    const page = objectType === "document" && row.objectId ? pageMap.get(row.objectId) : undefined;
    const project = objectType === "project" && row.objectId ? projectMap.get(row.objectId) : undefined;
    const projectMeta = projectNameMap.get(row.projectId ?? issue?.projectId ?? page?.projectId ?? "") ?? project;
    const actor = row.actorId ? actorMap.get(row.actorId) : undefined;
    const title =
      issue?.title ??
      page?.title ??
      project?.name ??
      (typeof data.title === "string" && data.title ? data.title : "");
    return {
      id: row.id,
      type: row.type,
      objectType,
      objectId: row.objectId ?? "",
      issueId: objectType === "task" ? row.objectId ?? row.issueId ?? null : row.issueId || null,
      pageId: objectType === "document" ? row.objectId ?? row.pageId ?? null : row.pageId,
      projectId: row.projectId ?? issue?.projectId ?? page?.projectId ?? project?.id ?? null,
      projectName: projectMeta?.name ?? null,
      projectColor: projectMeta?.color ?? null,
      title,
      identifier: issue?.identifier ?? null,
      actor: actor
        ? { id: actor.id, displayName: actor.displayName, avatar: actor.avatar }
        : null,
      agentActor: row.agentActor,
      data,
      createdAt: row.createdAt,
    };
  });
}

export async function listWorkspaceActivity(
  workspaceId: string,
  viewerId: string,
  query: WorkspaceActivityQuery = {}
): Promise<WorkspaceActivityPage> {
  const scope: ActivityScope = query.scope ?? "all";
  const limit = Math.min(50, Math.max(1, Math.trunc(query.limit ?? 30)));
  const [visible, following] = await Promise.all([
    visibleActivityScope(workspaceId, viewerId),
    scope === "following" ? followingSets(workspaceId, viewerId) : Promise.resolve(null),
  ]);
  const conditions = [eq(events.workspaceId, workspaceId)];
  if (query.objectType) conditions.push(eq(events.objectType, query.objectType));
  if (query.projectId) conditions.push(eq(events.projectId, query.projectId));
  if (query.personId) conditions.push(eq(events.actorId, query.personId));
  if (scope === "mine") conditions.push(eq(events.actorId, viewerId));

  const canSee = (row: typeof events.$inferSelect) => {
    if (row.visibility === "private") return row.ownerId === viewerId;
    if (row.visibility === "workspace") return true;
    if (visible.seeAll) return true;
    return row.projectId ? visible.projectIds?.has(row.projectId) ?? false : false;
  };
  const isFollowing = (row: typeof events.$inferSelect) => {
    if (!following) return true;
    if (row.projectId && following.project.has(row.projectId)) return true;
    if (row.objectType === "task" && row.objectId) return following.issue.has(row.objectId);
    if (row.objectType === "document" && row.objectId) return following.page.has(row.objectId);
    if (row.objectType === "project" && row.objectId) return following.project.has(row.objectId);
    return false;
  };

  let cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const found: (typeof events.$inferSelect)[] = [];
  let lastScanned: Cursor | null = null;
  let exhausted = false;
  const batchSize = Math.max(limit * 4, 40);
  for (let batch = 0; batch < 6 && found.length <= limit; batch += 1) {
    const after = cursor
      ? or(
          sql`${events.createdAt} < ${cursor.createdAt}`,
          and(eq(events.createdAt, cursor.createdAt), sql`${events.id} > ${cursor.id}`)
        )
      : undefined;
    const rows = await getDb()
      .select()
      .from(events)
      .where(and(...conditions, after))
      .orderBy(desc(events.createdAt), asc(events.id))
      .limit(batchSize);
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      lastScanned = { createdAt: row.createdAt, id: row.id };
      if (!canSee(row) || !isFollowing(row)) continue;
      found.push(row);
      if (found.length > limit) break;
    }
    cursor = lastScanned;
    if (rows.length < batchSize) {
      exhausted = true;
      break;
    }
  }
  const pageRows = found.slice(0, limit);
  const lastReturned = pageRows.at(-1);
  // Resume after the last row returned, not after the row that proved another page
  // exists, or the first item of the next page would be skipped.
  const nextCursor =
    found.length > limit && lastReturned
      ? encodeCursor({ createdAt: lastReturned.createdAt, id: lastReturned.id })
      : !exhausted && lastScanned
        ? encodeCursor(lastScanned)
        : null;
  return {
    items: await hydrate(pageRows),
    nextCursor,
  };
}

/** Used by checks: an object's activity goes with the object. */
export async function removeActivity(objectType: ActivityObjectType, objectIds: string[]): Promise<void> {
  if (objectIds.length === 0) return;
  await getDb()
    .delete(events)
    .where(and(eq(events.objectType, objectType), inArray(events.objectId, objectIds)));
}
