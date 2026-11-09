"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronDown, ChevronRight, Clock, Inbox, MoreHorizontal, Search, X } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { useUI, NOTIFICATIONS_READ } from "@/components/ui-context";
import { Menu, MenuItem } from "@/components/menu";
import { Modal } from "@/components/ui/modal";
import {
  clearNotificationsAction,
  deleteNotificationAction,
  loadNotificationsAction,
  markNotificationReadAction,
  markNotificationUnreadAction,
  markNotificationsReadAction,
  muteNotificationScopeAction,
  restoreNotificationsAction,
  saveNotificationPrefsAction,
  setNotificationStateAction,
  snoozeNotificationAction,
  unmuteNotificationScopeAction,
} from "@/app/workspace-misc-actions";
import type {
  NotificationCounts,
  NotificationMute,
  NotificationRow,
  NotificationTab,
} from "@/lib/issues";
import { parseLegacyNotificationBody, type NotificationData } from "@/lib/notification-data";
import { timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";
import { BTN, BTN_GHOST, FILTER_BAR, ICON_BTN, LINE, LINE_SUB, PAGE_HEADER, PAGE_INSET, PAGE_TITLE, SEARCH_FIELD, SEGMENTED, segment } from "@/lib/page-chrome";

type EventGroup = { id: string; label: string };
type Props = {
  workspaceId: string;
  items: NotificationRow[];
  nextCursor: string | null;
  initialTab: NotificationTab;
  initialQuery: string;
  counts: NotificationCounts;
  prefs: Record<string, boolean>;
  mutes: NotificationMute[];
  eventGroups: EventGroup[];
};
type Undo = { message: string; run: () => Promise<unknown> };

// Rows read while Unread is open stay where they are until the reader opens another row, and
// the list is only re-read from the server at that point. This has to outlive the component:
// a server refresh re-mounts the view, and a ref would come back empty — dropping the row the
// reader had just opened, which is exactly the flicker we are avoiding.
type InboxMemory = { kept: Set<string>; pending: boolean };
const inboxMemory = new Map<string, InboxMemory>();
function memoryFor(workspaceId: string): InboxMemory {
  let memory = inboxMemory.get(workspaceId);
  if (!memory) {
    memory = { kept: new Set(), pending: false };
    inboxMemory.set(workspaceId, memory);
  }
  return memory;
}

const TABS: { id: NotificationTab; key: keyof NotificationCounts; label: string }[] = [
  { id: "unread", key: "unread", label: "Unread" },
  { id: "mentions", key: "mentions", label: "Mentions" },
  { id: "assigned", key: "assigned", label: "Assigned" },
  { id: "reviews", key: "reviews", label: "Reviews" },
  { id: "all", key: "all", label: "All" },
];

function dataFor(item: NotificationRow): NotificationData {
  return item.data ?? parseLegacyNotificationBody(item.type, item.body) ?? {};
}

function resourceKey(item: NotificationRow): string {
  if (item.pageId) return `page:${item.pageId}`;
  if (item.issueId) return `issue:${item.issueId}`;
  return `row:${item.id}`;
}

function groupTitle(item: NotificationRow, t: ReturnType<typeof useT>): string {
  if (item.pageId) return item.pageTitle ?? t("Deleted document");
  if (item.issueId) return `${item.issueIdentifier} · ${item.issueTitle}`;
  return t("Workspace");
}

function sentence(item: NotificationRow, t: ReturnType<typeof useT>): string {
  const data = dataFor(item);
  const name = data.actorName ?? "";
  const title = data.title ?? item.issueTitle;
  switch (item.type) {
    case "assigned":
      return t("{name} assigned you to “{title}”", { name, title });
    case "mentioned":
      return t("{name} mentioned you", { name });
    case "review_decision":
      return data.decision === "approved"
        ? t("{name} approved “{title}”", { name, title })
        : t("{name} requested changes on “{title}”", { name, title });
    case "commented":
      return data.replyToName
        ? t("{name} replied to your comment on “{title}”", { name, title })
        : t("{name} commented on “{title}”", { name, title });
    case "doc_mentioned":
      return t("{name} mentioned you in a document", { name });
    case "doc_commented":
      return t("{name} commented on your document", { name });
    case "claimed":
      return t("{name} claimed a task you follow", { name });
    case "released":
      return t("{name} released a task you follow", { name });
    case "claim_transferred":
      return t("{name} handed a task to you", { name });
    case "blocker":
      return t("{name} reported a blocker", { name });
    case "view_added":
      return t("{name} added “{title}” to {view}", {
        name,
        title,
        view: data.viewName ?? t("a view you follow"),
      });
    case "view_completed":
      return t("{name} moved “{title}” to {status} in {view}", {
        name,
        title,
        status: data.statusLabel ?? "",
        view: data.viewName ?? t("a view you follow"),
      });
    case "automation":
      return t("{name}: {note}", {
        name: data.ruleName ?? data.actorName ?? t("Automation"),
        note: data.note ?? "",
      });
    case "due_soon":
      return t("Due {date}: reminder", { date: data.date ?? item.body });
    case "handoff_done":
      return t("Your Agent finished {task}", { task: data.task ?? item.body });
    case "handoff_failed":
      return t("Your Agent could not finish {task}", { task: data.task ?? item.body });
    case "handoff_waiting":
      return t("Your Agent needs your approval on {task}", { task: data.task ?? item.body });
    case "delegation_started":
      return t("{name} started on {task}", { name: name || t("An agent"), task: data.task ?? item.body });
    case "delegation_review":
      return t("{name} finished {task} and needs your review", {
        name: name || t("An agent"),
        task: data.task ?? item.body,
      });
    case "delegation_failed":
      return t("{name} could not finish {task}", { name: name || t("An agent"), task: data.task ?? item.body });
    case "delegation_changes_requested":
      return t("Changes requested on {task}", { task: data.task ?? item.body });
    case "workspace_deleted":
      return t("{name} deleted the workspace “{workspace}”", {
        name: data.ownerName ?? t("The owner"),
        workspace: data.workspaceName ?? "",
      });
    default:
      return item.body;
  }
}

function snoozePresets(t: ReturnType<typeof useT>) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const week = new Date(now);
  week.setDate(now.getDate() + 7);
  week.setHours(9, 0, 0, 0);
  return [
    { label: t("In 1 hour"), at: new Date(now.getTime() + 3600_000) },
    { label: t("Tomorrow at 9am"), at: tomorrow },
    { label: t("In 3 days"), at: new Date(now.getTime() + 3 * 86_400_000) },
    { label: t("In a week"), at: week },
  ];
}

export function NotificationsView({
  workspaceId,
  items: initialItems,
  nextCursor: initialNextCursor,
  initialTab,
  initialQuery,
  counts: initialCounts,
  prefs: initialPrefs,
  mutes: initialMutes,
  eventGroups,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue, openPage, confirm } = useUI();
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [counts, setCounts] = useState(initialCounts);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [mutes, setMutes] = useState(initialMutes);
  const [tab, setTab] = useState<NotificationTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState(-1);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [mutedOpen, setMutedOpen] = useState(false);
  const [busy, setBusy] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(new Set<string>());
  const memory = useRef(memoryFor(workspaceId));

  // Re-sync after router.refresh(): the server owns the authoritative rows and counts.
  useEffect(() => {
    setItems((old) => keepReadRows(old, initialItems, memory.current.kept));
    setNextCursor(initialNextCursor);
    setCounts(initialCounts);
    setPrefs(initialPrefs);
    setMutes(initialMutes);
  }, [initialItems, initialNextCursor, initialCounts, initialPrefs, initialMutes]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  function showUndo(message: string, run: () => Promise<unknown>) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ message, run });
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
  }

  function markBusy(key: string, on: boolean) {
    if (on) pending.current.add(key);
    else pending.current.delete(key);
    setBusy([...pending.current]);
  }

  async function perform(key: string, work: () => Promise<{ ok: boolean; error?: string }>) {
    markBusy(key, true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) throw new Error(result.error ?? "Failed");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      markBusy(key, false);
    }
  }

  function refreshed() {
    window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    router.refresh();
  }

  function patch(id: string, values: Partial<NotificationRow>) {
    setItems((old) => old.map((item) => (item.id === id ? { ...item, ...values } : item)));
  }

  function applyCounts(delta: { unread?: number; mentions?: number; assigned?: number; reviews?: number; all?: number }) {
    setCounts((old) => ({
      unread: Math.max(0, old.unread + (delta.unread ?? 0)),
      mentions: Math.max(0, old.mentions + (delta.mentions ?? 0)),
      assigned: Math.max(0, old.assigned + (delta.assigned ?? 0)),
      reviews: Math.max(0, old.reviews + (delta.reviews ?? 0)),
      all: Math.max(0, old.all + (delta.all ?? 0)),
    }));
  }

  async function toggleRead(item: NotificationRow) {
    const unread = item.state === "unread";
    const ok = await perform(item.id, () =>
      unread ? markNotificationReadAction(workspaceId, item.id) : markNotificationUnreadAction(workspaceId, item.id)
    );
    if (!ok) return;
    if (unread && tab === "unread") {
      memory.current.kept.add(item.id);
      memory.current.pending = true;
    } else {
      memory.current.kept.delete(item.id);
    }
    patch(item.id, { state: unread ? "read" : "unread", readAt: unread ? new Date().toISOString() : null });
    applyCounts({
      unread: unread ? -1 : 1,
      mentions: item.type === "mentioned" || item.type === "doc_mentioned" ? (unread ? -1 : 1) : 0,
      assigned: item.type === "assigned" ? (unread ? -1 : 1) : 0,
      reviews: item.type === "review_decision" ? (unread ? -1 : 1) : 0,
    });
    // The badge updates now; the Unread list itself is re-read when the reader opens another
    // row, so the row they just clicked does not slide out from under them.
    window.dispatchEvent(new Event(NOTIFICATIONS_READ));
    if (!unread) refreshed();
  }

  async function markDone(item: NotificationRow) {
    const previous = item.state === "unread" || item.state === "read" ? item.state : "read";
    const ok = await perform(`done:${item.id}`, () =>
      setNotificationStateAction(workspaceId, item.id, "done")
    );
    if (!ok) return;
    removeLocally(item, { unread: item.state === "unread" ? -1 : 0, all: -1 });
    showUndo(t("Notification archived"), () => setNotificationStateAction(workspaceId, item.id, previous));
    refreshed();
  }

  async function snooze(item: NotificationRow, at: Date | null) {
    const ok = await perform(`snooze:${item.id}`, () =>
      snoozeNotificationAction(workspaceId, item.id, at ? at.toISOString() : null)
    );
    if (!ok) return;
    setSnoozing(null);
    removeLocally(item, { unread: item.state === "unread" ? -1 : 0, all: -1 });
    showUndo(t("Snooze removed"), () => snoozeNotificationAction(workspaceId, item.id, item.snoozedUntil));
    refreshed();
  }

  async function remove(item: NotificationRow) {
    const ok = await perform(`delete:${item.id}`, () => deleteNotificationAction(workspaceId, item.id));
    if (!ok) return;
    removeLocally(item, { unread: item.state === "unread" ? -1 : 0, all: -1, mentions: item.type === "mentioned" || item.type === "doc_mentioned" ? (item.state === "unread" ? -1 : 0) : 0, assigned: item.type === "assigned" ? (item.state === "unread" ? -1 : 0) : 0, reviews: item.type === "review_decision" ? (item.state === "unread" ? -1 : 0) : 0 });
    showUndo(t("Notification deleted"), () => restoreNotificationsAction(workspaceId, [item.id]));
    refreshed();
  }

  function removeLocally(item: NotificationRow, delta: { unread?: number; mentions?: number; assigned?: number; reviews?: number; all?: number }) {
    setItems((old) => old.filter((row) => row.id !== item.id));
    applyCounts(delta);
    setUndo((old) => old);
  }

  async function markAll() {
    const ok = await perform("all", () => markNotificationsReadAction(workspaceId));
    if (!ok) return;
    setItems((old) => old.map((item) => (item.state === "unread" ? { ...item, state: "read", readAt: new Date().toISOString() } : item)));
    setCounts({ unread: 0, mentions: 0, assigned: 0, reviews: counts.reviews, all: counts.all });
    refreshed();
  }

  async function clearAll() {
    if (!items.length) return;
    if (!(await confirm(t("Clear all {count} notifications?", { count: items.length }), { body: t("You can undo this."), action: t("Clear all") }))) return;
    const ids = items.map((item) => item.id);
    const ok = await perform("all", () => clearNotificationsAction(workspaceId));
    if (!ok) return;
    setItems([]);
    setCounts({ unread: 0, mentions: 0, assigned: 0, reviews: 0, all: 0 });
    showUndo(t("Inbox cleared"), () => restoreNotificationsAction(workspaceId, ids));
    refreshed();
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const result = await loadNotificationsAction(workspaceId, { tab, q: initialQuery, cursor: nextCursor });
    setLoadingMore(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const known = new Set(items.map((item) => item.id));
    setItems((old) => [...old, ...result.data.rows.filter((row) => !known.has(row.id))]);
    setNextCursor(result.data.nextCursor);
  }

  function open(item: NotificationRow) {
    // Rows read earlier leave the Unread list here, one click later than the read itself.
    const flush = memory.current.pending;
    memory.current.pending = false;
    const reading = item.state === "unread" ? toggleRead(item) : null;
    if (item.pageId) openPage(item.pageId);
    else if (item.type !== "workspace_deleted" && item.issueId) openIssue(item.issueId);
    if (!flush) return;
    // Wait for this read to land, then take the server's list as it is: everything read so
    // far drops out, including the row just opened.
    void Promise.resolve(reading).then(() => {
      memory.current.kept.clear();
      memory.current.pending = false;
      refreshed();
    });
  }

  function goTab(next: NotificationTab) {
    memory.current.kept.clear();
    memory.current.pending = false;
    setTab(next);
    setSelected(-1);
    const params = new URLSearchParams({ tab: next });
    if (initialQuery) params.set("q", initialQuery);
    router.push(`/${workspaceId}/notifications?${params.toString()}`);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const next = query.trim();
    const params = new URLSearchParams();
    if (next) {
      params.set("q", next);
      params.set("tab", "all");
    } else {
      params.set("tab", tab);
    }
    router.push(`/${workspaceId}/notifications?${params.toString()}`);
  }

  async function mute(item: NotificationRow, scopeType: "issue" | "page" | "project", scopeId: string, label: string) {
    const ok = await perform(`mute:${item.id}`, () =>
      muteNotificationScopeAction(workspaceId, scopeType, scopeId, label)
    );
    if (!ok) return;
    setMutes((old) => [...old, { scopeType, scopeId, label }]);
    refreshed();
  }

  async function unmute(muteRow: NotificationMute) {
    const ok = await perform(`unmute:${muteRow.scopeId}`, () =>
      unmuteNotificationScopeAction(workspaceId, muteRow.scopeType, muteRow.scopeId)
    );
    if (!ok) return;
    setMutes((old) => old.filter((row) => !(row.scopeType === muteRow.scopeType && row.scopeId === muteRow.scopeId)));
    refreshed();
  }

  async function savePrefs(next: Record<string, boolean>) {
    setPrefs(next);
    const ok = await perform("prefs", () => saveNotificationPrefsAction(workspaceId, next));
    if (!ok) {
      setPrefs(initialPrefs);
      return;
    }
    refreshed();
  }

  const groups = useMemo(() => {
    const map = new Map<string, NotificationRow[]>();
    for (const item of items) {
      const key = resourceKey(item);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
  }, [items]);

  const visibleRows = useMemo(() => {
    const rows: NotificationRow[] = [];
    for (const group of groups) {
      if (group.rows.length === 1 || expanded[group.key]) rows.push(...group.rows);
    }
    return rows;
  }, [groups, expanded]);

  // Read the latest values inside the window listener without re-registering it.
  const latest = useRef({ visibleRows, selected, prefsOpen, mutedOpen });
  useEffect(() => {
    latest.current = { visibleRows, selected, prefsOpen, mutedOpen };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (latest.current.prefsOpen || latest.current.mutedOpen) return;
      const rows = latest.current.visibleRows;
      const item = latest.current.selected >= 0 ? rows[latest.current.selected] : null;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((old) => Math.min(rows.length - 1, old + 1));
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((old) => Math.max(0, old - 1));
        return;
      }
      if (event.altKey && (event.key === "u" || event.key === "U")) {
        event.preventDefault();
        void markAll();
        return;
      }
      if (!item) return;
      if (event.key === "u" || event.key === "U") {
        event.preventDefault();
        void toggleRead(item);
      } else if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        setSnoozing(item.id);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        void remove(item);
      } else if (event.shiftKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (item.pageId) void mute(item, "page", item.pageId, item.pageTitle ?? t("Document"));
        else if (item.issueId) void mute(item, "issue", item.issueId, `${item.issueIdentifier} · ${item.issueTitle}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The handlers close over the latest render; the listener is cheap to re-register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, initialQuery, counts.all]);

  const busySet = new Set(busy);

  return (
    <div className="flex-1 overflow-y-auto">
      <header className={`${PAGE_HEADER} ${PAGE_INSET} max-[600px]:min-h-11 max-[600px]:pl-3 max-[600px]:pr-3`}>
        <h1 className={`${PAGE_TITLE} max-[600px]:flex-1`}>{t("Inbox")}</h1>
        <span className="tabular-nums text-small text-faint">
          {t("{count} unread", { count: counts.unread })}
        </span>
        <div className="hidden max-[600px]:block">
          <Menu
            width={220}
            align="right"
            triggerClassName="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text"
            trigger={<span aria-label={t("More")} title={t("More")}><MoreHorizontal size={15} /></span>}
          >
            {(close) => (
              <>
                <MenuItem disabled={counts.unread === 0 || busySet.has("all")} onSelect={() => { close(); void markAll(); }}>{t("Mark all read")}</MenuItem>
                {items.length > 0 && <MenuItem danger disabled={busySet.has("all")} onSelect={() => { close(); void clearAll(); }}>{t("Clear all")}</MenuItem>}
                <div className="my-1 h-px bg-border" />
                <MenuItem onSelect={() => { close(); setPhoneSearch((open) => !open); }}>{t("Search notifications…")}</MenuItem>
                <MenuItem onSelect={() => { close(); setPrefsOpen((open) => !open); }}>{t("Notification preferences")}</MenuItem>
                <MenuItem onSelect={() => { close(); setMutedOpen(true); }}>{t("Muted tasks and documents")}</MenuItem>
                <MenuItem onSelect={() => { close(); router.push(`/${workspaceId}/review`); }}>{t("Open the review queue")}</MenuItem>
                <p className="px-2 py-1 text-caption text-faint">{t("Notifications are kept for 90 days.")}</p>
              </>
            )}
          </Menu>
        </div>
        <div className="ml-auto flex items-center gap-2 max-[600px]:hidden">
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={counts.unread === 0 || busySet.has("all")}
            className={BTN}
          >
            {t("Mark all read")}
          </button>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={busySet.has("all")}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors hover:border-danger/40 hover:text-danger disabled:opacity-40 bg-bg text-text hover:bg-active"
            >
              {t("Clear all")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPrefsOpen((open) => !open)}
            aria-label={t("Notification preferences")}
            aria-pressed={prefsOpen}
            className={`${ICON_BTN} ${prefsOpen ? "bg-elevated text-text" : ""}`}
          >
            <Bell size={14} />
          </button>
          <button
            type="button"
            onClick={() => setMutedOpen(true)}
            aria-label={t("Muted tasks and documents")}
            data-inbox-muted-open
            className={ICON_BTN}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </header>

      <div className={`${FILTER_BAR} max-[600px]:flex-nowrap max-[600px]:overflow-x-auto max-[600px]:px-3`} data-inbox-tabs>
        <div className={SEGMENTED} role="group">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => goTab(entry.id)}
            data-testid={`inbox-tab-${entry.id}`}
            className={segment(tab === entry.id)}
          >
            {t(entry.label)} {counts[entry.key]}
          </button>
        ))}
        </div>
        <div className="ml-auto max-[600px]:hidden">
          <form onSubmit={submitSearch} className={`${SEARCH_FIELD} w-52`}>
            <Search size={13} className="shrink-0 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search notifications…")}
              aria-label={t("Search notifications…")}
              className="min-w-0 flex-1 bg-transparent text-small text-text placeholder:text-faint"
            />
          </form>
        </div>
      </div>

      {(phoneSearch || query) && (
        <form onSubmit={submitSearch} className="relative hidden items-center border-b border-border px-3 py-2 max-[600px]:flex">
          <Search size={13} className="pointer-events-none absolute left-5 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search notifications…")}
            className="h-[34px] rounded-lg px-2.5 h-8 w-full border border-border-strong bg-elevated/40 pl-7 pr-2 text-text placeholder:text-faint focus:border-border-strong text-body"
          />
        </form>
      )}

      {error && <p role="alert" className={`py-2 text-small text-danger ${PAGE_INSET}`}>{error}</p>}

      {prefsOpen && (
        <div className={`space-y-3 border-b border-border py-3 text-small ${PAGE_INSET}`} data-inbox-preferences>
          <div className="flex items-center justify-between">
            <span className="font-medium">{t("Notifications")}</span>
            <button type="button" onClick={() => setPrefsOpen(false)} className="text-caption text-faint hover:text-text">{t("Close")}</button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {eventGroups.map((group) => (
              <label key={group.id} className="flex items-center gap-1.5 text-muted">
                <input
                  type="checkbox"
                  checked={prefs[group.id] !== false}
                  onChange={(event) => void savePrefs({ ...prefs, [group.id]: event.target.checked })}
                />
                {t(group.label)}
              </label>
            ))}
          </div>
        </div>
      )}

      {snoozing && (
        <div className={`flex flex-wrap items-center gap-2 border-b border-border py-2 text-small ${PAGE_INSET}`} data-inbox-snooze>
          <Clock size={13} className="text-muted" />
          <span className="text-muted">{t("Snooze until")}:</span>
          {snoozePresets(t).map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                const item = items.find((row) => row.id === snoozing);
                if (item) void snooze(item, preset.at);
              }}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border bg-bg text-text hover:bg-active"
            >
              {preset.label}
            </button>
          ))}
          <button type="button" onClick={() => setSnoozing(null)} className="ml-auto text-caption text-faint hover:text-text">{t("Cancel")}</button>
        </div>
      )}

      <div>
        {items.length === 0 && (
          <EmptyState
            icon={initialQuery ? <Search size={16} /> : <Inbox size={16} />}
            title={initialQuery ? t("No notifications match this search.") : t("Your inbox is empty")}
            hint={initialQuery ? undefined : t("Nothing yet — you'll see mentions, assignments, and comments here.")}
          />
        )}
        {groups.map((group) => {
          const head = group.rows[0];
          if (group.rows.length === 1) return renderRow(head);
          const open = Boolean(expanded[group.key]);
          return (
            <div key={group.key} data-inbox-group>
              {/* The header names the task or document; the notifications sit under it, so the
                  newest one is not shown twice when the group is open. */}
              <button
                type="button"
                onClick={() => setExpanded((old) => ({ ...old, [group.key]: !open }))}
                className={`${LINE} w-full text-left focus-visible:bg-active focus-visible:outline-none`}
              >
                {open ? <ChevronDown size={13} className="shrink-0 text-faint" /> : <ChevronRight size={13} className="shrink-0 text-faint" />}
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: group.rows.some((row) => row.state === "unread") ? "var(--color-accent)" : "transparent" }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-body ${group.rows.some((row) => row.state === "unread") ? "text-text" : "text-muted"}`}>{groupTitle(head, t)}</span>
                  <span className={`block truncate ${LINE_SUB}`}>
                    {open ? t("{count} updates", { count: String(group.rows.length) }) : sentence(head, t)}
                  </span>
                </span>
                <span className="shrink-0 text-small tabular-nums text-faint max-[600px]:hidden" suppressHydrationWarning>{timeAgo(head.createdAt, locale)}</span>
                <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-muted">{group.rows.length}</span>
              </button>
              {open && <div className="[&>div]:!pl-12">{group.rows.map((item) => renderRow(item, true))}</div>}
            </div>
          );
        })}
        {nextCursor && (
          <div className={`pt-4 ${PAGE_INSET}`}>
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border disabled:opacity-40 bg-bg text-text hover:bg-active"
            >
              {loadingMore ? t("Loading…") : t("Load more")}
            </button>
          </div>
        )}
      </div>

      <div className={`flex min-h-11 flex-wrap items-center gap-2.5 py-2 text-small text-faint ${PAGE_INSET} max-[600px]:hidden`}>
        <span>{t("Notifications are kept for 90 days.")}</span>
        <Link
          href={`/${workspaceId}/review`}
          data-testid="inbox-review-queue-link"
          className={`${BTN_GHOST} ml-auto`}
        >
          {t("Open the review queue")}
        </Link>
      </div>

      <Modal open={mutedOpen} onClose={() => setMutedOpen(false)} title={t("Muted tasks and documents")} className="max-w-[440px]">
        <div className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15" data-inbox-muted>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-lead font-semibold text-text">{t("Muted tasks and documents")}</h2>
            <button type="button" aria-label={t("Close")} onClick={() => setMutedOpen(false)} className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"><X size={14} /></button>
          </div>
          <div className="max-h-[60dvh] divide-y divide-border overflow-y-auto">
            {mutes.length === 0 ? (
              <p className="px-4 py-3 text-body text-faint">{t("Nothing muted.")}</p>
            ) : (
              mutes.map((muteRow) => (
                <div key={`${muteRow.scopeType}:${muteRow.scopeId}`} className="flex items-center gap-2 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-body text-text">{muteRow.label || muteRow.scopeId}</span>
                  <button type="button" onClick={() => void unmute(muteRow)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 border border-border transition-colors bg-bg text-text hover:bg-active">{t("Unmute")}</button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {undo && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-overlay px-3 py-2 text-small text-text shadow-xl" data-inbox-undo>
          <span>{undo.message}</span>
          <button
            type="button"
            onClick={() => {
              const action = undo.run;
              setUndo(null);
              if (undoTimer.current) clearTimeout(undoTimer.current);
              void action().then(() => refreshed());
            }}
            className="font-medium text-accent hover:underline"
          >
            {t("Undo")}
          </button>
        </div>
      )}
    </div>
  );

  // Rows inside an open group skip the task line: the group header above already names the task.
  function renderRow(item: NotificationRow, inGroup = false) {
    const unread = item.state === "unread";
    const flatIndex = visibleRows.indexOf(item);
    const isSelected = flatIndex >= 0 && flatIndex === selected;
    const muted = mutes.some((muteRow) =>
      (item.pageId && muteRow.scopeType === "page" && muteRow.scopeId === item.pageId) ||
      (item.issueId && muteRow.scopeType === "issue" && muteRow.scopeId === item.issueId) ||
      (item.issueProjectId && muteRow.scopeType === "project" && muteRow.scopeId === item.issueProjectId)
    );
    return (
      <div
        key={item.id}
        data-inbox-read={unread ? "false" : "true"}
        className={`group ${LINE} ${isSelected ? "bg-active" : ""}`}
      >
        <button
          type="button"
          title={unread ? t("Mark read") : t("Mark unread")}
          disabled={busySet.has(item.id)}
          onClick={(event) => {
            event.stopPropagation();
            void toggleRead(item);
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-transparent hover:text-faint"
          data-inbox-dot
        >
          {unread ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : <Check size={10} />}
        </button>
        <span className="flex size-[22px] shrink-0 items-center justify-center">
          {dataFor(item).actorName && <AssigneeAvatar displayName={dataFor(item).actorName ?? ""} size={22} />}
        </span>
        <button type="button" onClick={() => open(item)} className="min-w-0 flex-1 text-left">
          <span className={`block truncate text-body ${unread ? "text-text" : "text-muted"}`}>
            {sentence(item, t)}
          </span>
          <span className={`${inGroup && !muted ? "hidden max-[600px]:block" : "block"} truncate ${LINE_SUB}`}>
            {inGroup ? (muted ? t("Muted") : "") : groupTitle(item, t)}
            {!inGroup && muted ? ` · ${t("Muted")}` : ""}
            <span className="hidden max-[600px]:inline" suppressHydrationWarning>{inGroup && !muted ? "" : " · "}{timeAgo(item.createdAt, locale)}</span>
          </span>
        </button>
        <span className="shrink-0 text-small tabular-nums text-faint max-[600px]:hidden" suppressHydrationWarning>{timeAgo(item.createdAt, locale)}</span>
        {item.state === "done" && <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap mt-1 bg-elevated text-caption text-muted">{t("Done")}</span>}
        <Menu
          width={200}
          align="right"
          trigger={<span className="text-muted">…</span>}
          triggerClassName="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-text focus-visible:opacity-100 group-hover:opacity-100 max-[600px]:opacity-100"
        >
          {(close) => (
            <>
              <MenuItem onSelect={() => { close(); void toggleRead(item); }}>
                {unread ? t("Mark read") : t("Mark unread")}
              </MenuItem>
              <MenuItem onSelect={() => { close(); setSnoozing(item.id); }}>{t("Snooze…")}</MenuItem>
              {item.pageId && (
                <MenuItem onSelect={() => { close(); void mute(item, "page", item.pageId!, item.pageTitle ?? t("Document")); }}>
                  {t("Mute this document")}
                </MenuItem>
              )}
              {item.issueId && (
                <MenuItem onSelect={() => { close(); void mute(item, "issue", item.issueId, `${item.issueIdentifier} · ${item.issueTitle}`); }}>
                  {t("Mute this task")}
                </MenuItem>
              )}
              {item.issueProjectId && (
                <MenuItem onSelect={() => { close(); void mute(item, "project", item.issueProjectId!, item.issueProjectName ?? t("Project")); }}>
                  {t("Mute this project")}
                </MenuItem>
              )}
              <MenuItem onSelect={() => { close(); void markDone(item); }}>{t("Done")}</MenuItem>
              <MenuItem danger onSelect={() => { close(); void remove(item); }}>{t("Delete")}</MenuItem>
            </>
          )}
        </Menu>
      </div>
    );
  }
}

// The server's rows, in the order already on screen, plus the rows read here that the server no
// longer lists. Rows the server added go on top, where it puts them.
function keepReadRows(shown: NotificationRow[], server: NotificationRow[], kept: Set<string>): NotificationRow[] {
  if (kept.size === 0) return server;
  const fresh = new Map(server.map((row) => [row.id, row]));
  const seen = new Set(shown.map((row) => row.id));
  const merged: NotificationRow[] = server.filter((row) => !seen.has(row.id));
  for (const row of shown) {
    const next = fresh.get(row.id);
    if (next) merged.push(next);
    else if (kept.has(row.id)) merged.push(row);
  }
  return merged;
}
