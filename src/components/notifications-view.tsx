"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useUI, NOTIFICATIONS_READ } from "@/components/ui-context";
import {
  clearNotificationsAction,
  deleteNotificationAction,
  markNotificationReadAction,
  markNotificationsReadAction,
} from "@/app/workspace-misc-actions";
import type { NotificationRow } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";

export function NotificationsView({
  workspaceId,
  items,
}: {
  workspaceId: string;
  items: NotificationRow[];
}) {
  const router = useRouter();
  const { openIssue } = useUI();
  const [marking, setMarking] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Rows the user has opened since this view loaded. The server data refreshes a
  // moment later, but the dot should disappear the instant they click.
  const [opened, setOpened] = useState<string[]>([]);
  // Rows removed here; the refresh lands a moment later, but the list should shrink
  // the instant the trash icon is clicked.
  const [removed, setRemoved] = useState<string[]>([]);

  const visible = items.filter((item) => !removed.includes(item.id));

  function isUnread(item: NotificationRow) {
    return !item.readAt && !opened.includes(item.id);
  }

  function open(item: NotificationRow) {
    // Workspace-deletion notices have no issue behind them and no workspace left to
    // open; reading them is all a click can do.
    if (item.type !== "workspace_deleted") openIssue(item.issueId);
    if (!isUnread(item)) return;
    setOpened((prev) => [...prev, item.id]);
    void markNotificationReadAction(workspaceId, item.id).then(() => {
      window.dispatchEvent(new Event(NOTIFICATIONS_READ));
      router.refresh();
    });
  }

  async function markAll() {
    setMarking(true);
    await markNotificationsReadAction(workspaceId);
    setMarking(false);
    window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    router.refresh();
  }

  async function remove(item: NotificationRow) {
    setRemoved((prev) => [...prev, item.id]);
    const result = await deleteNotificationAction(workspaceId, item.id);
    if (!result.ok) {
      setRemoved((prev) => prev.filter((id) => id !== item.id));
      return;
    }
    window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    router.refresh();
  }

  async function clearAll() {
    if (visible.length === 0) return;
    if (
      !window.confirm(
        `Delete all ${visible.length} inbox notifications? This cannot be undone.`
      )
    ) {
      return;
    }
    setClearing(true);
    const result = await clearNotificationsAction(workspaceId);
    setClearing(false);
    if (!result.ok) return;
    setRemoved(items.map((item) => item.id));
    window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    router.refresh();
  }

  const unread = visible.filter(isUnread).length;

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-[14px] font-semibold">Inbox</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          {unread} unread
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={marking}
            className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-text"
          >
            Mark all read
          </button>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={clearing}
              className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-danger/40 hover:text-danger"
            >
              Clear all
            </button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-2xl divide-y divide-border">
        {visible.length === 0 && (
          <div className="p-6 text-[13px] text-faint">
            Nothing yet — you&apos;ll see mentions, assignments, and comments here.
          </div>
        )}
        {visible.map((item) => (
          <div
            key={item.id}
            className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/40 ${
              isUnread(item) ? "" : "opacity-60"
            }`}
          >
            <button
              type="button"
              onClick={() => open(item)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: isUnread(item) ? "var(--color-accent)" : "transparent" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-text">{item.body}</span>
                <span className="block text-[11px] text-faint">
                  {item.type === "workspace_deleted"
                    ? "Workspace deleted"
                    : `${issueRef({
                        projectName: item.issueProjectName,
                        number: item.issueNumber,
                        identifier: item.issueIdentifier,
                      })} · ${item.issueTitle}`}
                </span>
              </span>
            </button>
            <span suppressHydrationWarning className="shrink-0 text-[11px] text-faint">
              {timeAgo(item.createdAt)}
            </span>
            <button
              type="button"
              aria-label="Delete notification"
              onClick={() => void remove(item)}
              className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
