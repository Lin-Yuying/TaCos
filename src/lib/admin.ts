import crypto from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, hashPassword, BUILT_IN_ADMIN } from "@/db/client";
import {
  apiKeys,
  deviceAccounts,
  issueAssignees,
  issues,
  notifications,
  sessions,
  users,
  workspaceMembers,
} from "@/db/schema";
import { TacosError } from "./issues";

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
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,20}$/.test(username)) {
    throw new TacosError("Username must be 2-20 characters (letters, digits, - or _)");
  }
  assertPassword(input.password);
  const displayName = input.displayName.trim() || username;

  const db = getDb();
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (taken.length > 0) throw new TacosError("Username is already taken", 409);

  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    username,
    displayName,
    passwordHash: hashPassword(input.password),
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
