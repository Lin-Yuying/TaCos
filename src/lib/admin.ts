import crypto from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, hashPassword, BUILT_IN_ADMIN } from "@/db/client";
import {
  apiKeys,
  deviceAccounts,
  issueAssignees,
  issues,
  notifications,
  retiredUsernames,
  runnerTokens,
  sessions,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { TacosError } from "./issues";
import { BUILTIN_AVATARS, nextFreeAvatar } from "./avatars";
import { normalizeUsername, validUsername } from "./mentions";

export type SiteMember = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  siteRole: "admin" | "member";
  workspaceCount: number;
  lastWorkspaceId: string | null;
  createdAt: string;
};

export async function listSiteMembers(): Promise<SiteMember[]> {
  const rows = await getDb()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      siteRole: users.role,
      lastWorkspaceId: users.lastWorkspaceId,
      createdAt: users.createdAt,
      workspaceCount: sql<number>`(
        select count(*) from workspace_members where workspace_members.user_id = ${users.id}
      )`,
    })
    .from(users)
    .orderBy(users.createdAt);

  return rows.map((row) => ({
    ...row,
    avatar: row.avatar ?? null,
    siteRole: row.siteRole === "admin" ? "admin" : "member",
    lastWorkspaceId: row.lastWorkspaceId ?? null,
  }));
}

export async function requireSiteMember(userId: string) {
  const [row] = await getDb()
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new TacosError("Member not found", 404);
  return row;
}

function assertPassword(password: string) {
  if (password.length < 8) throw new TacosError("Password must be at least 8 characters");
}

export async function createSiteMember(input: {
  username: string;
  displayName: string;
  password: string;
}) {
  const username = normalizeUsername(input.username);
  if (!validUsername(username)) {
    throw new TacosError("Username must be 1-40 characters without @, [, ] or line breaks");
  }
  assertPassword(input.password);
  const displayName = input.displayName.trim() || username;

  const db = getDb();
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  const retired = await db
    .select({ username: retiredUsernames.username })
    .from(retiredUsernames)
    .where(eq(retiredUsernames.username, username))
    .limit(1);
  if (taken.length > 0 || retired.length > 0) throw new TacosError("Username is already taken", 409);

  const id = crypto.randomUUID();
  const existing = await db.select({ avatar: users.avatar }).from(users);
  await db.insert(users).values({
    id,
    username,
    displayName,
    passwordHash: hashPassword(input.password),
    // A fresh account gets an animal nobody else on this server is using yet.
    avatar: nextFreeAvatar(
      existing.map((row) => row.avatar),
      crypto.randomInt(BUILTIN_AVATARS.length)
    ),
    role: "member",
    createdAt: new Date().toISOString(),
  });
  return { id, username, displayName };
}

export async function setMemberPassword(userId: string, password: string) {
  await requireSiteMember(userId);
  assertPassword(password);
  await getDb()
    .update(users)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(users.id, userId));
  // A reset password has to lock out whoever had the old one.
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
  await getDb().delete(deviceAccounts).where(eq(deviceAccounts.userId, userId));
  await getDb().delete(runnerTokens).where(eq(runnerTokens.userId, userId));
}

export async function setMemberDisplayName(userId: string, displayName: string) {
  await requireSiteMember(userId);
  const name = displayName.trim();
  if (!name) throw new TacosError("Display name is required");
  if (name.length > 40) throw new TacosError("Display name must be 40 characters or fewer");
  await getDb().update(users).set({ displayName: name }).where(eq(users.id, userId));
}

export async function deleteSiteMember(actorId: string, userId: string) {
  if (actorId === userId) throw new TacosError("You cannot delete your own account", 400);
  const target = await requireSiteMember(userId);
  if (target.username === BUILT_IN_ADMIN) {
    throw new TacosError("The built-in superuser cannot be deleted");
  }

  const db = getDb();

  // The person who created a workspace stays its owner until someone else takes that place.
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.createdBy, userId));
  for (const workspace of owned) {
    const [successor] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.id), ne(workspaceMembers.userId, userId)))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    if (successor) {
      await db.update(workspaces).set({ createdBy: successor.userId }).where(eq(workspaces.id, workspace.id));
    }
  }

  // A workspace left without any admin would be unmanageable, so hand it to the
  // longest-serving remaining member first.
  const adminOf = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, "admin")));
  for (const { workspaceId } of adminOf) {
    const [successor] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), ne(workspaceMembers.userId, userId)))
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    if (successor) {
      await db
        .update(workspaceMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, successor.userId)
          )
        );
    }
  }

  // Issues survive; only the assignments and creator credit are cleared. Comments and
  // events keep their text but lose their author, which the timeline renders as
  // "Deleted user".
  await db.delete(issueAssignees).where(eq(issueAssignees.userId, userId));
  await db.update(issues).set({ createdBy: null }).where(eq(issues.createdBy, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(deviceAccounts).where(eq(deviceAccounts.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(apiKeys).where(eq(apiKeys.createdBy, userId));
  await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db
    .insert(retiredUsernames)
    .values({ username: target.username, retiredAt: new Date().toISOString() })
    .onConflictDoNothing();

  return { username: target.username, displayName: target.displayName };
}

export async function setSiteRole(actorId: string, userId: string, role: "admin" | "member") {
  const target = await requireSiteMember(userId);
  if (target.username === BUILT_IN_ADMIN && role !== "admin") {
    throw new TacosError("The built-in superuser cannot be demoted");
  }
  if (actorId === userId && role !== "admin") {
    throw new TacosError("You cannot remove your own admin access");
  }
  await getDb().update(users).set({ role }).where(eq(users.id, userId));
}
