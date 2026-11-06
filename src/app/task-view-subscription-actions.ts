"use server";
import { requireWorkspace } from "@/lib/auth";
import {
  listViewSubscriptions,
  subscribeToTaskView,
  unsubscribeFromTaskView,
  updateTaskViewSubscription,
  type ViewNoticeKind,
} from "@/lib/task-view-subscriptions";
import type { ActionResult } from "./actions";

async function run<T>(work: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save. Retry.",
    };
  }
}

export async function listViewSubscriptionsAction(ws: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return listViewSubscriptions(ws, user.id);
  });
}

export async function subscribeToTaskViewAction(ws: string, viewId: string, events?: ViewNoticeKind[]) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return subscribeToTaskView(ws, user.id, viewId, events);
  });
}

export async function updateTaskViewSubscriptionAction(
  ws: string,
  viewId: string,
  patch: { events?: ViewNoticeKind[]; muted?: boolean }
) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return updateTaskViewSubscription(ws, user.id, viewId, patch);
  });
}

export async function unsubscribeFromTaskViewAction(ws: string, viewId: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    unsubscribeFromTaskView(ws, user.id, viewId);
  });
}
