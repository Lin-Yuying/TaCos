// View subscriptions: notify a member when a task enters a view (added) or leaves it
// as done/canceled (completed). Delivery is the existing Inbox only.
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { taskViewSubscriptions } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import { getTaskView } from "@/lib/task-views";

export const VIEW_NOTICE_KINDS = ["added", "completed"] as const;
export type ViewNoticeKind = (typeof VIEW_NOTICE_KINDS)[number];

export type ViewSubscription = {
  viewId: string;
  events: ViewNoticeKind[];
  muted: boolean;
};

function parseEvents(raw: string): ViewNoticeKind[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [...VIEW_NOTICE_KINDS];
    const events = value.filter(
      (entry): entry is ViewNoticeKind =>
        typeof entry === "string" && (VIEW_NOTICE_KINDS as readonly string[]).includes(entry)
    );
    return events.length ? events : [...VIEW_NOTICE_KINDS];
  } catch {
    return [...VIEW_NOTICE_KINDS];
  }
}

export function listViewSubscriptions(workspaceId: string, userId: string): ViewSubscription[] {
  return getDb()
    .select()
    .from(taskViewSubscriptions)
    .where(
      and(
        eq(taskViewSubscriptions.workspaceId, workspaceId),
        eq(taskViewSubscriptions.userId, userId)
      )
    )
    .all()
    .map((row) => ({
      viewId: row.viewId,
      events: parseEvents(row.events),
      muted: Boolean(row.muted),
    }));
}

function sharedView(workspaceId: string, userId: string, viewId: string) {
  // getTaskView applies the owner/project-visibility rules, so a member cannot
  // subscribe to a view they could not open.
  const view = getTaskView(workspaceId, userId, viewId);
  if (!view.shared) throw new TacosError("View not found", 404);
  return view;
}

export function subscribeToTaskView(
  workspaceId: string,
  userId: string,
  viewId: string,
  events: ViewNoticeKind[] = [...VIEW_NOTICE_KINDS]
): ViewSubscription {
  sharedView(workspaceId, userId, viewId);
  const clean = [...new Set(events)].filter((event) =>
    (VIEW_NOTICE_KINDS as readonly string[]).includes(event)
  );
  if (clean.length === 0) throw new TacosError("Choose what to be notified about", 400);
  const now = new Date().toISOString();
  getDb()
    .insert(taskViewSubscriptions)
    .values({
      workspaceId,
      userId,
      viewId,
      events: JSON.stringify(clean),
      muted: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [taskViewSubscriptions.workspaceId, taskViewSubscriptions.userId, taskViewSubscriptions.viewId],
      set: { events: JSON.stringify(clean), muted: 0, updatedAt: now },
    })
    .run();
  return { viewId, events: clean, muted: false };
}

export function updateTaskViewSubscription(
  workspaceId: string,
  userId: string,
  viewId: string,
  patch: { events?: ViewNoticeKind[]; muted?: boolean }
): ViewSubscription {
  sharedView(workspaceId, userId, viewId);
  const existing = getDb()
    .select()
    .from(taskViewSubscriptions)
    .where(
      and(
        eq(taskViewSubscriptions.workspaceId, workspaceId),
        eq(taskViewSubscriptions.userId, userId),
        eq(taskViewSubscriptions.viewId, viewId)
      )
    )
    .get();
  if (!existing) throw new TacosError("Subscribe to this view first", 404);
  const events =
    patch.events === undefined
      ? parseEvents(existing.events)
      : [...new Set(patch.events)].filter((event) =>
          (VIEW_NOTICE_KINDS as readonly string[]).includes(event)
        );
  if (patch.events !== undefined && events.length === 0) {
    throw new TacosError("Choose what to be notified about", 400);
  }
  const muted = patch.muted === undefined ? Boolean(existing.muted) : Boolean(patch.muted);
  getDb()
    .update(taskViewSubscriptions)
    .set({ events: JSON.stringify(events), muted: muted ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(taskViewSubscriptions.workspaceId, workspaceId),
        eq(taskViewSubscriptions.userId, userId),
        eq(taskViewSubscriptions.viewId, viewId)
      )
    )
    .run();
  return { viewId, events, muted };
}

export function unsubscribeFromTaskView(workspaceId: string, userId: string, viewId: string) {
  getDb()
    .delete(taskViewSubscriptions)
    .where(
      and(
        eq(taskViewSubscriptions.workspaceId, workspaceId),
        eq(taskViewSubscriptions.userId, userId),
        eq(taskViewSubscriptions.viewId, viewId)
      )
    )
    .run();
}

/** Ids only, for callers that just need to know which views are watched. */
export function subscribedViewIds(workspaceId: string, userId: string): string[] {
  return listViewSubscriptions(workspaceId, userId).map((row) => row.viewId);
}
