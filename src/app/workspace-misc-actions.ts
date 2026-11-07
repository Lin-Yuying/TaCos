"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import {
  addNotificationMute,
  clearNotifications,
  deleteNotification,
  listNotificationPage,
  markNotificationRead,
  markNotificationUnread,
  markNotificationsRead,
  removeNotificationMute,
  restoreNotifications,
  saveNotificationPrefs,
  setNotificationState,
  snoozeNotification,
} from "@/lib/issues";

export async function markNotificationsReadAction(workspaceId: string) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await markNotificationsRead(workspaceId, ws.user.id);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function markNotificationReadAction(workspaceId: string, notificationId: string) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await markNotificationRead(workspaceId, ws.user.id, notificationId);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

// A workspace-deletion notice belongs to a team the member can no longer open, so
// dismissing it from the onboarding screen must not go through requireWorkspace.
export async function markWorkspaceNoticeReadAction(notificationId: string) {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false as const, error: "Not signed in" };
    await markNotificationRead("", user.id, notificationId);
    revalidatePath("/onboarding");
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function deleteNotificationAction(workspaceId: string, notificationId: string) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await deleteNotification(ws.user.id, notificationId);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function clearNotificationsAction(workspaceId: string) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await clearNotifications(workspaceId, ws.user.id);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function markNotificationUnreadAction(workspaceId: string, notificationId: string) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await markNotificationUnread(ws.user.id, notificationId);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function setNotificationStateAction(
  workspaceId: string,
  notificationId: string,
  state: "unread" | "read" | "done"
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await setNotificationState(ws.user.id, notificationId, state);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function snoozeNotificationAction(
  workspaceId: string,
  notificationId: string,
  until: string | null
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await snoozeNotification(ws.user.id, notificationId, until);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function restoreNotificationsAction(workspaceId: string, notificationIds: string[]) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await restoreNotifications(ws.user.id, notificationIds);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveNotificationPrefsAction(
  workspaceId: string,
  types: Record<string, boolean>
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await saveNotificationPrefs(workspaceId, ws.user.id, types);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function muteNotificationScopeAction(
  workspaceId: string,
  scopeType: "issue" | "page" | "project",
  scopeId: string,
  label: string
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await addNotificationMute(workspaceId, ws.user.id, scopeType, scopeId, label);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function unmuteNotificationScopeAction(
  workspaceId: string,
  scopeType: string,
  scopeId: string
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    await removeNotificationMute(workspaceId, ws.user.id, scopeType, scopeId);
    revalidatePath(`/${workspaceId}/notifications`);
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function loadNotificationsAction(
  workspaceId: string,
  options: { tab?: "unread" | "mentions" | "assigned" | "reviews" | "all"; q?: string; cursor?: string | null }
) {
  try {
    const ws = await requireWorkspace(workspaceId);
    const page = await listNotificationPage(workspaceId, ws.user.id, options);
    return { ok: true as const, data: page };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Failed" };
  }
}
