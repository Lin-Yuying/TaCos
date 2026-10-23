import crypto from "node:crypto";
import { cookies } from "next/headers";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { deviceAccounts, sessions, users, workspaceMembers, workspaces } from "../db/schema";
import { TacosError } from "./issues";

export const SESSION_COOKIE = "tacos_session";
const SESSION_TTL_DAYS = 30;

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  // site-wide role; per-workspace roles live in workspace_members
  siteRole: "admin" | "member";
  lastWorkspaceId: string | null;
};

export async function createSession(userId: string): Promise<string> {
  const id = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  await getDb().insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString(),
    createdAt: now.toISOString(),
  });
  return id;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      siteRole: users.role,
      lastWorkspaceId: users.lastWorkspaceId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, token))
    .limit(1);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar ?? null,
    siteRole: row.siteRole === "admin" ? "admin" : "member",
    lastWorkspaceId: row.lastWorkspaceId ?? null,
  };
}

export async function deleteSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().delete(sessions).where(eq(sessions.id, token));
  }
  store.delete(SESSION_COOKIE);
}

export const DEVICE_COOKIE = "tacos_device";
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 730;

async function deviceId(): Promise<string | null> {
  const store = await cookies();
  return store.get(DEVICE_COOKIE)?.value ?? null;
}

async function ensureDeviceId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  if (existing) return existing;
  const id = crypto.randomBytes(32).toString("hex");
  store.set(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_TTL_SECONDS,
  });
  return id;
}

async function rememberDevice(id: string, userId: string) {
  const db = getDb();
  const known = await db
    .select({ deviceId: deviceAccounts.deviceId })
    .from(deviceAccounts)
    .where(and(eq(deviceAccounts.deviceId, id), eq(deviceAccounts.userId, userId)))
    .limit(1);
  if (known.length === 0) {
    await db.insert(deviceAccounts).values({ deviceId: id, userId, createdAt: new Date().toISOString() });
  }
}

// Remembers that this browser has authenticated as `userId`, which is what lets
// the avatar menu offer the account again without asking for the password.
// Only callable from a server action or route handler — it may set the cookie.
export async function linkDeviceAccount(userId: string) {
  await rememberDevice(await ensureDeviceId(), userId);
}

// Same link, but safe during a render: Server Components can read cookies but
// not set them, so a browser that has never been issued an id is skipped.
export async function linkSessionDevice(userId: string) {
  const id = await deviceId();
  if (id) await rememberDevice(id, userId);
}

export async function listDeviceAccounts() {
  const id = await deviceId();
  if (!id) return [];
  const rows = await getDb()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      lastWorkspaceId: users.lastWorkspaceId,
    })
    .from(deviceAccounts)
    .innerJoin(users, eq(users.id, deviceAccounts.userId))
    .where(eq(deviceAccounts.deviceId, id));
  return rows;
}

export async function deviceHasAccount(userId: string): Promise<boolean> {
  const id = await deviceId();
  if (!id) return false;
  const [row] = await getDb()
    .select({ deviceId: deviceAccounts.deviceId })
    .from(deviceAccounts)
    .where(and(eq(deviceAccounts.deviceId, id), eq(deviceAccounts.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new TacosError("Not signed in", 401, "Sign in at /login first");
  return user;
}

export async function requireSiteAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.siteRole !== "admin") {
    throw new TacosError("Only site admins can do that", 403);
  }
  return user;
}

export type WorkspaceContext = {
  user: SessionUser;
  workspace: { id: string; name: string; key: string; icon: string | null; createdBy: string | null };
  role: "admin" | "member";
};

export type UserWorkspace = {
  id: string;
  name: string;
  key: string;
  icon: string | null;
  role: "admin" | "member";
  createdBy: string | null;
};

export async function listUserWorkspaces(userId: string): Promise<UserWorkspace[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      key: workspaces.key,
      icon: workspaces.icon,
      createdBy: workspaces.createdBy,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    // A workspace in its owner's recycle bin is out of everyone's switcher until restored.
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    // The join is otherwise free to walk the primary-key index, which orders workspaces by
    // UUID — whatever looked "first" could change with a new membership. Keep it stable.
    .orderBy(asc(workspaceMembers.createdAt), asc(workspaces.createdAt), asc(workspaces.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.key,
    icon: row.icon ?? null,
    role: row.role as "admin" | "member",
    createdBy: row.createdBy ?? null,
  }));
}

// Where a freshly authenticated session lands. The account's own last workspace wins,
// but only while it still exists and the account is still a member; otherwise prefer a
// workspace they created, so one person signing in never inherits another's context.
export function landingWorkspaceId(
  userId: string,
  workspaces: UserWorkspace[],
  lastWorkspaceId: string | null
): string | null {
  if (lastWorkspaceId && workspaces.some((ws) => ws.id === lastWorkspaceId)) {
    return lastWorkspaceId;
  }
  const own = workspaces.find((ws) => ws.createdBy === userId);
  return (own ?? workspaces[0])?.id ?? null;
}

export async function resolveLandingWorkspace(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ lastWorkspaceId: users.lastWorkspaceId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const workspaces = await listUserWorkspaces(userId);
  return landingWorkspaceId(userId, workspaces, row?.lastWorkspaceId ?? null);
}

export async function setLastWorkspace(userId: string, workspaceId: string) {
  await getDb().update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, userId));
}

export async function requireWorkspace(workspaceId: string): Promise<WorkspaceContext> {
  const user = await requireUser();
  const db = getDb();
  const [row] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      key: workspaces.key,
      icon: workspaces.icon,
      createdBy: workspaces.createdBy,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id),
        isNull(workspaces.deletedAt)
      )
    )
    .limit(1);
  if (!row) throw new TacosError("Workspace not found or you are not a member", 404);
  return {
    user,
    workspace: {
      id: row.id,
      name: row.name,
      key: row.key,
      icon: row.icon ?? null,
      createdBy: row.createdBy ?? null,
    },
    role: row.role as "admin" | "member",
  };
}

export async function requireAdmin(workspaceId: string): Promise<WorkspaceContext> {
  const ctx = await requireWorkspace(workspaceId);
  if (ctx.role !== "admin") {
    throw new TacosError("Only workspace admins can do that", 403);
  }
  return ctx;
}
