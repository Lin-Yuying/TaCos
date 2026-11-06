"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import {
  BUILTIN_AVATAR_PREFIX,
  builtinAvatarId,
  nextFreeAvatar,
} from "@/lib/avatars";
import { createSiteMember, setMemberDisplayName } from "@/lib/admin";
import { asLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import {
  createSession,
  deleteSession,
  signIn,
  getSessionUser,
  landingWorkspaceId,
  linkDeviceAccount,
  listUserWorkspaces,
  requireAdmin,
  requireWorkspace,
  SESSION_COOKIE,
} from "@/lib/auth";
import { normalizeUsername } from "@/lib/mentions";
import {
  createWorkspace,
  deleteWorkspace,
  joinWorkspace,
  inviteMember,
  leaveWorkspace,
  restoreWorkspace,
  TacosError,
  rotateJoinCode,
  setMemberRole,
  removeMember,
  type Project,
} from "@/lib/issues";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function registerAction(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const { id } = await createSiteMember(input);
    const token = await createSession(id);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    await linkDeviceAccount(id);
    return { next: "/" };
  });
}

export async function loginAction(input: {
  username: string;
  password: string;
}): Promise<ActionResult<{ next: string }>> {
  return run(async () => {
    const user = await signIn(normalizeUsername(input.username), input.password);
    const token = await createSession(user.id);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    await linkDeviceAccount(user.id);
    const workspaces = await listUserWorkspaces(user.id);
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId ?? null);
    return { next: landing ? `/${landing}` : "/" };
  });
}

// Saved on the account so it follows the person to other browsers, and in a cookie so
// the sign-in screens of this browser match.
export async function saveLocaleAction(locale: string): Promise<ActionResult<{ locale: Locale }>> {
  return run(async () => {
    const chosen = asLocale(locale);
    if (!chosen) throw new TacosError("Unsupported language", 400);
    const user = await getSessionUser();
    if (user) {
      await getDb().update(users).set({ locale: chosen }).where(eq(users.id, user.id));
    }
    const store = await cookies();
    store.set(LOCALE_COOKIE, chosen, {
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 730,
    });
    revalidatePath("/", "layout");
    return { locale: chosen };
  });
}

export async function logoutAction() {
  await deleteSession();
  revalidatePath("/", "layout");
}

// Client resizes to 128x128 before uploading, so the cap only has to catch abuse.
const MAX_AVATAR_CHARS = 300_000;
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export async function saveAvatarAction(
  avatar: string | null
): Promise<ActionResult<{ avatar: string | null }>> {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new TacosError("Not signed in", 401);
    const db = getDb();
    let stored: string | null = null;
    if (avatar == null) {
      // Removing an upload returns to an animal nobody else on this server uses.
      const everyone = await db.select({ id: users.id, avatar: users.avatar }).from(users);
      stored = nextFreeAvatar(
        everyone.filter((row) => row.id !== user.id).map((row) => row.avatar)
      );
    } else {
      const builtin = builtinAvatarId(avatar);
      if (builtin) {
        stored = `${BUILTIN_AVATAR_PREFIX}${builtin}`;
      } else if (AVATAR_DATA_URL.test(avatar) && avatar.length <= MAX_AVATAR_CHARS) {
        stored = avatar;
      } else {
        throw new TacosError(
          "Pick one of the taco ingredients, or upload a PNG, JPEG or WebP image under 200 KB"
        );
      }
    }
    await db
      .update(users)
      .set({ avatar: stored })
      .where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { avatar: stored };
  });
}

export async function saveDisplayNameAction(displayName: string): Promise<ActionResult<void>> {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new TacosError("Not signed in", 401);
    await setMemberDisplayName(user.id, displayName);
    revalidatePath("/", "layout");
  });
}

export async function createWorkspaceAction(input: {
  name: string;
  key: string;
}): Promise<ActionResult<{ id: string; name: string; key: string; joinCode: string }>> {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new TacosError("Not signed in", 401);
    const result = await createWorkspace({ ...input, adminUserId: user.id });
    revalidatePath("/", "layout");
    return result;
  });
}

export async function joinWorkspaceAction(input: {
  code: string;
}): Promise<ActionResult<{ id: string; name: string; key: string }>> {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new TacosError("Not signed in", 401);
    const result = await joinWorkspace({ code: input.code, userId: user.id });
    revalidatePath("/", "layout");
    return result;
  });
}

// H-COLLAB-12: add an existing account to the workspace. Admins only.
export async function inviteMemberAction(
  workspaceId: string,
  who: string
): Promise<ActionResult<{ id: string; username: string; displayName: string }>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    const member = await inviteMember(workspaceId, who);
    revalidatePath(`/${workspaceId}`, "layout");
    return member;
  });
}

export async function rotateJoinCodeAction(workspaceId: string): Promise<ActionResult<{ code: string }>> {
  return run(async () => {
    const ws = await requireAdmin(workspaceId);
    const code = await rotateJoinCode(workspaceId, ws.user.id);
    return { code };
  });
}

export async function setMemberRoleAction(workspaceId: string, userId: string, role: "admin" | "member") {
  return run(async () => {
    await requireAdmin(workspaceId);
    await setMemberRole(workspaceId, userId, role);
    revalidatePath("/", "layout");
  });
}

export async function removeMemberAction(workspaceId: string, userId: string) {
  return run(async () => {
    const ws = await requireAdmin(workspaceId);
    if (ws.user.id === userId) {
      throw new TacosError("You cannot remove yourself from the workspace", 400);
    }
    await removeMember(workspaceId, userId);
    revalidatePath("/", "layout");
  });
}

// Anyone who joined by invitation may walk away again; the owner cannot leave their own
// team from here — the issues stay either way.
export async function leaveWorkspaceAction(workspaceId: string) {
  return run(async () => {
    const ws = await requireWorkspace(workspaceId);
    if (ws.workspace.createdBy === ws.user.id) {
      throw new TacosError("The workspace owner cannot leave — delete it from Settings instead", 400);
    }
    await leaveWorkspace(workspaceId, ws.user.id);
    revalidatePath("/", "layout");
  });
}

export async function deleteWorkspaceAction(workspaceId: string, confirmation: string) {
  return run(async () => {
    const ws = await requireWorkspace(workspaceId);
    await deleteWorkspace(workspaceId, ws.user.id, confirmation);
    revalidatePath("/", "layout");
  });
}

// Restoring comes from the recycle bin, where the workspace is already hidden from
// requireWorkspace — the owner check lives in the business layer instead.
export async function restoreWorkspaceAction(workspaceId: string) {
  return run(async () => {
    const user = await getSessionUser();
    if (!user) throw new TacosError("Not signed in", 401);
    const restored = await restoreWorkspace(workspaceId, user.id);
    revalidatePath("/", "layout");
    return restored;
  });
}

export type { Project };
