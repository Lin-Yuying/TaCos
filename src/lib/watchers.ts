import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { issueAssignees, issues, pages, projects, users, watchers, workspaceMembers } from "../db/schema";
import type { WatchScopeType } from "./constants";
import { TacosError } from "./tacos-error";

/**
 * U-11: one follow model for tasks, projects and documents.
 *
 * A watcher row is the only truth: Follow inserts it, Unfollow removes it, and the
 * auto-follow triggers on create/assign/mention/comment write the same row with the
 * reason in `source`. Notifications ask this module who follows an object, so an
 * explicit Unfollow really stops comment notices. The bootstrap migration turns the
 * old implicit creator/assignee audience into the starting watcher set.
 */

export type WatchSource = "manual" | "creator" | "assignee" | "mention" | "comment" | "migrated";

export type Watcher = {
  id: string;
  displayName: string;
  avatar: string | null;
  source: WatchSource;
  muted: boolean;
  createdAt: string;
};

export type WatchState = {
  following: boolean;
  muted: boolean;
  watchers: Watcher[];
};

const SOURCES: WatchSource[] = ["manual", "creator", "assignee", "mention", "comment", "migrated"];

function asSource(value: string): WatchSource {
  return (SOURCES as string[]).includes(value) ? (value as WatchSource) : "manual";
}

async function scopeExists(workspaceId: string, scopeType: WatchScopeType, scopeId: string) {
  const db = getDb();
  if (scopeType === "issue") {
    const [row] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.id, scopeId)))
      .limit(1);
    return Boolean(row);
  }
  if (scopeType === "project") {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, scopeId)))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.id, scopeId)))
    .limit(1);
  return Boolean(row);
}

/** Explicit Follow: creates the row, or clears a mute on an existing one. */
export async function followScope(
  workspaceId: string,
  userId: string,
  scopeType: WatchScopeType,
  scopeId: string,
  source: WatchSource = "manual"
): Promise<void> {
  if (!(await scopeExists(workspaceId, scopeType, scopeId))) {
    throw new TacosError("This object no longer exists", 404);
  }
  await getDb()
    .insert(watchers)
    .values({
      workspaceId,
      userId,
      scopeType,
      scopeId,
      source,
      muted: 0,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [watchers.workspaceId, watchers.userId, watchers.scopeType, watchers.scopeId],
      set: { muted: 0 },
    });
}

/** Auto-follow never overrides a mute or an existing reason. */
export async function autoFollow(
  workspaceId: string,
  userId: string,
  scopeType: WatchScopeType,
  scopeId: string,
  source: Exclude<WatchSource, "manual">
): Promise<void> {
  if (!(await scopeExists(workspaceId, scopeType, scopeId))) return;
  await getDb()
    .insert(watchers)
    .values({
      workspaceId,
      userId,
      scopeType,
      scopeId,
      source,
      muted: 0,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

/** Explicit Unfollow removes the row, so neither comment notices nor the list include it. */
export async function unfollowScope(
  workspaceId: string,
  userId: string,
  scopeType: WatchScopeType,
  scopeId: string
): Promise<void> {
  await getDb()
    .delete(watchers)
    .where(
      and(
        eq(watchers.workspaceId, workspaceId),
        eq(watchers.userId, userId),
        eq(watchers.scopeType, scopeType),
        eq(watchers.scopeId, scopeId)
      )
    );
}

export async function setWatchMuted(
  workspaceId: string,
  userId: string,
  scopeType: WatchScopeType,
  scopeId: string,
  muted: boolean
): Promise<void> {
  await getDb()
    .update(watchers)
    .set({ muted: muted ? 1 : 0 })
    .where(
      and(
        eq(watchers.workspaceId, workspaceId),
        eq(watchers.userId, userId),
        eq(watchers.scopeType, scopeType),
        eq(watchers.scopeId, scopeId)
      )
    );
}

export async function listWatchers(
  workspaceId: string,
  scopeType: WatchScopeType,
  scopeId: string
): Promise<Watcher[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      displayName: users.displayName,
      avatar: users.avatar,
      source: watchers.source,
      muted: watchers.muted,
      createdAt: watchers.createdAt,
    })
    .from(watchers)
    .innerJoin(users, eq(users.id, watchers.userId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, watchers.userId),
        eq(workspaceMembers.workspaceId, watchers.workspaceId)
      )
    )
    .where(
      and(
        eq(watchers.workspaceId, workspaceId),
        eq(watchers.scopeType, scopeType),
        eq(watchers.scopeId, scopeId)
      )
    )
    .orderBy(asc(watchers.createdAt));
  return rows.map((row) => ({
    ...row,
    source: asSource(row.source),
    muted: row.muted === 1,
  }));
}

export async function watchState(
  workspaceId: string,
  viewerId: string,
  scopeType: WatchScopeType,
  scopeId: string
): Promise<WatchState> {
  const [people, own] = await Promise.all([
    listWatchers(workspaceId, scopeType, scopeId),
    getDb()
      .select({ muted: watchers.muted })
      .from(watchers)
      .where(
        and(
          eq(watchers.workspaceId, workspaceId),
          eq(watchers.userId, viewerId),
          eq(watchers.scopeType, scopeType),
          eq(watchers.scopeId, scopeId)
        )
      )
      .limit(1),
  ]);
  return {
    following: Boolean(own[0]),
    muted: own[0]?.muted === 1,
    watchers: people,
  };
}

/** People a comment notice should reach: everyone following, minus muted followers. */
export async function watcherIds(
  workspaceId: string,
  scopeType: WatchScopeType,
  scopeId: string
): Promise<string[]> {
  const rows = await getDb()
    .select({ userId: watchers.userId })
    .from(watchers)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.userId, watchers.userId),
        eq(workspaceMembers.workspaceId, watchers.workspaceId)
      )
    )
    .where(
      and(
        eq(watchers.workspaceId, workspaceId),
        eq(watchers.scopeType, scopeType),
        eq(watchers.scopeId, scopeId),
        eq(watchers.muted, 0)
      )
    );
  return rows.map((row) => row.userId);
}

export async function followedIds(
  workspaceId: string,
  userId: string,
  scopeType: WatchScopeType
): Promise<string[]> {
  const rows = await getDb()
    .select({ scopeId: watchers.scopeId })
    .from(watchers)
    .where(
      and(
        eq(watchers.workspaceId, workspaceId),
        eq(watchers.userId, userId),
        eq(watchers.scopeType, scopeType)
      )
    );
  return rows.map((row) => row.scopeId);
}

/** Create/assign auto-follow. A task's creator is its first watcher. */
export async function followIssueCreator(
  workspaceId: string,
  issueId: string,
  userId: string | null | undefined
): Promise<void> {
  if (!userId) return;
  await autoFollow(workspaceId, userId, "issue", issueId, "creator");
}

export async function followIssueAssignees(
  workspaceId: string,
  issueId: string
): Promise<void> {
  const rows = await getDb()
    .select({ userId: issueAssignees.userId })
    .from(issueAssignees)
    .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
    .where(and(eq(issueAssignees.issueId, issueId), eq(issues.workspaceId, workspaceId)));
  for (const row of rows) {
    await autoFollow(workspaceId, row.userId, "issue", issueId, "assignee");
  }
}

export async function followIssueAssigneesByIds(
  workspaceId: string,
  issueId: string,
  userIds: string[]
): Promise<void> {
  for (const userId of [...new Set(userIds)]) {
    await autoFollow(workspaceId, userId, "issue", issueId, "assignee");
  }
}

/** One page/project creator is the starting watcher of that object. */
export async function followObjectCreator(
  workspaceId: string,
  scopeType: "project" | "page",
  scopeId: string,
  userId: string | null | undefined
): Promise<void> {
  if (!userId) return;
  await autoFollow(workspaceId, userId, scopeType, scopeId, "creator");
}

/** Used by checks and cleanup: an object's watcher rows disappear with the object. */
export async function removeWatchers(scopeType: WatchScopeType, scopeIds: string[]): Promise<void> {
  if (scopeIds.length === 0) return;
  await getDb()
    .delete(watchers)
    .where(and(eq(watchers.scopeType, scopeType), inArray(watchers.scopeId, scopeIds)));
}
