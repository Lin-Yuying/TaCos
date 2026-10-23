"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  createSiteMember,
  deleteSiteMember,
  listSiteMembers,
  requireSiteMember,
  setMemberDisplayName,
  setMemberPassword,
  setSiteRole,
  type SiteMember,
} from "@/lib/admin";
import {
  createSession,
  deviceHasAccount,
  linkDeviceAccount,
  landingWorkspaceId,
  listDeviceAccounts,
  listUserWorkspaces,
  requireSiteAdmin,
  requireUser,
  resolveLandingWorkspace,
  SESSION_COOKIE,
} from "@/lib/auth";
import { TacosError } from "@/lib/issues";
import type { ActionResult } from "./auth-actions";

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export type SwitchUser = Pick<
  SiteMember,
  "id" | "username" | "displayName" | "avatar"
> & {
  // where this account would land, so duplicate display names stay distinguishable
  workspaceName: string | null;
};

async function describeSwitchUser(
  account: Pick<SiteMember, "id" | "username" | "displayName" | "avatar" | "lastWorkspaceId">
): Promise<SwitchUser> {
  const workspaces = await listUserWorkspaces(account.id);
  const landing = landingWorkspaceId(account.id, workspaces, account.lastWorkspaceId);
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    avatar: account.avatar,
    workspaceName: workspaces.find((ws) => ws.id === landing)?.name ?? null,
  };
}

function accountsWithWorkspaceFirst(a: SwitchUser, b: SwitchUser) {
  if (Boolean(a.workspaceName) !== Boolean(b.workspaceName)) {
    return a.workspaceName ? -1 : 1;
  }
  return a.username.localeCompare(b.username);
}

// Site admins may switch into every account; everyone else gets the accounts this
// browser has already signed into.
export async function listSwitchableUsersAction() {
  return run<{ users: SwitchUser[]; siteAdmin: boolean }>(async () => {
    const me = await requireUser();
    const pool =
      me.siteRole === "admin"
        ? (await listSiteMembers()).filter((member) => member.id !== me.id)
        : (await listDeviceAccounts()).filter((member) => member.id !== me.id);
    const users = await Promise.all(pool.map(describeSwitchUser));
    return { users: users.sort(accountsWithWorkspaceFirst), siteAdmin: me.siteRole === "admin" };
  });
}

export async function adminCreateMemberAction(input: {
  username: string;
  displayName: string;
  password: string;
}) {
  return run<{ id: string; username: string }>(async () => {
    await requireSiteAdmin();
    const member = await createSiteMember(input);
    revalidatePath("/admin");
    return { id: member.id, username: member.username };
  });
}

export async function adminResetPasswordAction(userId: string, password: string) {
  return run<void>(async () => {
    await requireSiteAdmin();
    await setMemberPassword(userId, password);
  });
}

export async function adminRenameMemberAction(userId: string, displayName: string) {
  return run<void>(async () => {
    await requireSiteAdmin();
    await setMemberDisplayName(userId, displayName);
    revalidatePath("/", "layout");
  });
}

export async function adminSetSiteRoleAction(userId: string, role: "admin" | "member") {
  return run<void>(async () => {
    const actor = await requireSiteAdmin();
    await setSiteRole(actor.id, userId, role);
    revalidatePath("/", "layout");
  });
}

export async function adminDeleteMemberAction(userId: string) {
  return run<{ username: string }>(async () => {
    const actor = await requireSiteAdmin();
    const deleted = await deleteSiteMember(actor.id, userId);
    revalidatePath("/", "layout");
    return { username: deleted.username };
  });
}

// Starts a session as another account and hands back where to land.
export async function switchUserAction(userId: string) {
  return run<{ url: string }>(async () => {
    const actor = await requireUser();
    if (actor.siteRole !== "admin" && !(await deviceHasAccount(userId))) {
      throw new TacosError("Sign in to that account once before switching to it", 403);
    }
    const target = await requireSiteMember(userId);
    const store = await cookies();
    store.set(SESSION_COOKIE, await createSession(target.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    await linkDeviceAccount(target.id);
    // The target's own last workspace (or one they own) — never the workspace the
    // current account happened to be looking at.
    const landing = await resolveLandingWorkspace(target.id);
    revalidatePath("/", "layout");
    return { url: landing ? `/${landing}` : "/onboarding" };
  });
}
