"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { markNotificationRead, markNotificationsRead } from "@/lib/issues";

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
