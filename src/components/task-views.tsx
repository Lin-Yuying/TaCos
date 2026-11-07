"use client";

import { BTN, BTN_PRIMARY, CHIP, ICON_BTN } from "@/lib/page-chrome";
import { MODAL_BODY, MODAL_FOOT, MODAL_HEAD, MODAL_TITLE, Modal } from "@/components/ui/modal";
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, Copy, MoreHorizontal, Pencil, Star, Trash2, X } from "lucide-react";
import { Menu } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import {
  clearDefaultTaskViewAction,
  createTaskViewAction,
  deleteTaskViewAction,
  duplicateTaskViewAction,
  listTaskViewsAction,
  setDefaultTaskViewAction,
  saveTaskViewDefinitionAction,
  toggleTaskViewFavoriteAction,
  updateTaskViewAction,
} from "@/app/task-view-actions";
import type { TaskViewDefinition, TaskViewSummary, ViewScope } from "@/lib/task-views";
import type { ViewSubscription } from "@/lib/task-view-subscriptions";
import {
  listViewSubscriptionsAction,
  subscribeToTaskViewAction,
  unsubscribeFromTaskViewAction,
  updateTaskViewSubscriptionAction,
} from "@/app/task-view-subscription-actions";

const triggerClass = CHIP;

export const SAVE_VIEW_EVENT = "tacos:save-view";

/**
 * Saved views for the current list: shared workspace/project views first, then the
 * member's private views for this URL context. The menu is the place to open, save,
 * favorite, duplicate, rename, share and set a default.
 */
export function TaskViews({
  workspaceId,
  scope,
  projectId,
  context,
  definition,
  active,
  onSelect,
}: {
  workspaceId: string;
  scope: ViewScope;
  projectId?: string | null;
  // Personal views are kept separate per page context (path + quick filters).
  context: string;
  definition: TaskViewDefinition;
  active: TaskViewSummary | null;
  onSelect: (view: TaskViewSummary | null) => void;
}) {
  const t = useT();
  const { confirm } = useUI();
  const [items, setItems] = useState<TaskViewSummary[]>([]);
  const [subscriptions, setSubscriptions] = useState<Record<string, ViewSubscription>>({});
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const options = useMemo(
    () => ({ scope, projectId: projectId ?? null, context }),
    [scope, projectId, context]
  );

  useEffect(() => {
    const openSave = () => setSaving(true);
    window.addEventListener(SAVE_VIEW_EVENT, openSave);
    return () => window.removeEventListener(SAVE_VIEW_EVENT, openSave);
  }, []);

  async function refresh() {
    const [result, subscriptionResult] = await Promise.all([
      listTaskViewsAction(workspaceId, options),
      listViewSubscriptionsAction(workspaceId),
    ]);
    if (result.ok) {
      setItems(result.data);
      setError(null);
      window.dispatchEvent(new Event("tacos:task-views-changed"));
    } else setError(result.error);
    if (subscriptionResult.ok) {
      setSubscriptions(
        Object.fromEntries(subscriptionResult.data.map((row) => [row.viewId, row]))
      );
    }
    return result.ok ? result.data : null;
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.all([
      listTaskViewsAction(workspaceId, options),
      listViewSubscriptionsAction(workspaceId),
    ])
      .then(([result, subscriptionResult]) => {
        if (!live) return;
        if (result.ok) setItems(result.data);
        else setError(result.error);
        if (subscriptionResult.ok) {
          setSubscriptions(
            Object.fromEntries(subscriptionResult.data.map((row) => [row.viewId, row]))
          );
        }
      })
      .catch(() => {
        if (live) setError(t("Could not load views. Reopen to retry."));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, options]);

  async function act(work: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) setError(result.error ?? t("Could not save. Retry."));
      else setError(null);
      await refresh();
    } catch {
      setError(t("Could not save. Retry."));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await createTaskViewAction(workspaceId, {
        name,
        scope,
        projectId: projectId ?? null,
        shared,
        definition: {
          ...definition,
          context: shared ? undefined : context,
        },
      });
      if (result.ok) {
        setName("");
        setError(null);
        await refresh();
        onSelect(result.data);
        setOpen(false);
        setSaving(false);
      } else setError(result.error);
    } catch {
      setError(t("Could not save. Retry."));
    } finally {
      setBusy(false);
    }
  }

  async function rename(view: TaskViewSummary) {
    if (!renameName.trim() || busy) return;
    setBusy(true);
    try {
      const result = await updateTaskViewAction(workspaceId, view.id, { name: renameName });
      if (result.ok) {
        setRenaming(null);
        if (active?.id === view.id) onSelect(result.data);
        await refresh();
      } else setError(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove(view: TaskViewSummary) {
    if (!(await confirm(t("Delete the view “{name}”?", { name: view.name }), { action: t("Delete") }))) return;
    await act(async () => {
      const result = await deleteTaskViewAction(workspaceId, view.id);
      if (result.ok && active?.id === view.id) onSelect(null);
      return result;
    });
  }

  const groups = [
    { key: "shared", label: t("Shared views"), views: items.filter((item) => item.shared) },
    { key: "personal", label: t("Personal views"), views: items.filter((item) => !item.shared) },
  ].filter((group) => group.views.length > 0);

  return (
    <>
    <Modal open={saving} bare onClose={() => setSaving(false)} title={t("Save view")} className="max-w-[420px]">
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className={MODAL_HEAD}>
          <h2 className={MODAL_TITLE}>{t("Save view")}</h2>
          <button type="button" onClick={() => setSaving(false)} aria-label={t("Close")} className={`${ICON_BTN} !size-[26px]`}><X size={14} /></button>
        </div>
        <div className={MODAL_BODY}>
          <label className="flex flex-col gap-1 text-small font-medium">
            {t("View name")}
            <input autoFocus disabled={busy} value={name} onChange={(event) => setName(event.target.value)} className="h-[34px] rounded-lg border border-border-strong bg-bg px-2.5 text-body font-normal" />
          </label>
          <p className="text-small text-muted">{t("Save the current filters and display as a view.")}</p>
          <label className="flex items-center gap-1.5 text-small text-muted">
            <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
            {t("Share with everyone")}
          </label>
          {error ? <p role="alert" className="text-small text-danger">{t(error)}</p> : null}
        </div>
        <div className={MODAL_FOOT}>
          <button type="button" onClick={() => setSaving(false)} className={BTN}>{t("Cancel")}</button>
          <button type="submit" disabled={busy || !name.trim()} className={BTN_PRIMARY}>{t("Save")}</button>
        </div>
      </form>
    </Modal>
    <Menu
      width={400}
      open={open}
      onOpenChange={setOpen}
      triggerClassName={triggerClass}
      trigger={
        <>
          <span className="font-medium">{t("Views")}</span>
          {active ? <span className="max-w-[120px] truncate text-faint">{active.name}</span> : null}
        </>
      }
    >
      {(close) => (
        <div data-task-views className="space-y-2 p-2 text-small">
          <button
            type="button"
            data-view-clear
            onClick={() => {
              onSelect(null);
              close();
            }}
            aria-pressed={!active}
            className={`w-full rounded px-2 py-1 text-left hover:bg-elevated ${
              active ? "text-muted" : "font-medium text-text"
            }`}
          >
            {t("All tasks")}
          </button>
          {groups.map((group) => (
            <div key={group.key}>
              <div className="px-2 pb-1 pt-1 text-caption uppercase tracking-wide text-faint">
                {group.label}
              </div>
              {group.views.map((view) => (
                <div key={view.id} data-view-row data-view-name={view.name}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-view-open
                      aria-label={t("Open view {name}", { name: view.name })}
                      aria-pressed={active?.id === view.id}
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left hover:bg-elevated ${
                        active?.id === view.id ? "bg-elevated font-medium text-text" : "text-muted"
                      }`}
                      onClick={() => {
                        onSelect(view);
                        close();
                      }}
                    >
                      {view.name}
                      {view.isDefault ? (
                        <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap ml-2 border border-border text-caption text-faint">
                          {t("Default")}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label={
                        view.favorite
                          ? t("Remove {name} from favorites", { name: view.name })
                          : t("Add {name} to favorites", { name: view.name })
                      }
                      aria-pressed={view.favorite}
                      className={`rounded p-1 hover:bg-elevated ${view.favorite ? "text-accent" : "text-faint hover:text-text"}`}
                      onClick={() =>
                        void act(async () => {
                          const result = await toggleTaskViewFavoriteAction(workspaceId, view.id);
                          return result;
                        })
                      }
                    >
                      <Star size={12} fill={view.favorite ? "currentColor" : "none"} />
                    </button>
                    {view.shared ? (
                      <button
                        type="button"
                        data-view-subscribe
                        aria-label={
                          subscriptions[view.id]
                            ? t("Unsubscribe from {name}", { name: view.name })
                            : t("Subscribe to {name}", { name: view.name })
                        }
                        aria-pressed={Boolean(subscriptions[view.id])}
                        title={t("View notifications go to your Inbox.")}
                        className={`rounded p-1 hover:bg-elevated ${
                          subscriptions[view.id]
                            ? "text-accent"
                            : "text-faint hover:text-text"
                        }`}
                        onClick={() => {
                          const subscription = subscriptions[view.id];
                          void act(async () =>
                            subscription
                              ? unsubscribeFromTaskViewAction(workspaceId, view.id)
                              : subscribeToTaskViewAction(workspaceId, view.id)
                          );
                        }}
                      >
                        {subscriptions[view.id] ? <Bell size={12} /> : <BellOff size={12} />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-view-options
                      aria-label={t("View options for {name}", { name: view.name })}
                      aria-expanded={expanded === view.id}
                      className="rounded p-1 text-faint hover:bg-elevated hover:text-text"
                      onClick={() => {
                        setExpanded((current) => (current === view.id ? null : view.id));
                        setRenaming(null);
                      }}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </div>
                  {renaming === view.id ? (
                    <form
                      className="flex gap-1 px-2 py-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void rename(view);
                      }}
                    >
                      <input
                        aria-label={t("New name for {name}", { name: view.name })}
                        value={renameName}
                        onChange={(event) => setRenameName(event.target.value)}
                        className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg p-1 text-body"
                      />
                      <button disabled={busy || !renameName.trim()} type="submit">
                        {t("Save")}
                      </button>
                    </form>
                  ) : null}
                  {expanded === view.id ? (
                    <div className="flex flex-wrap gap-2 px-3 pb-1 pt-0.5 text-caption text-muted">
                      <button type="button" className="hover:text-text" onClick={() => void act(async () => duplicateTaskViewAction(workspaceId, view.id, context))}>
                        <Copy size={11} className="mr-1 inline" />
                        {t("Duplicate")}
                      </button>
                      {active?.id === view.id ? (
                        <button
                          type="button"
                          data-view-save-current
                          className="hover:text-text"
                          onClick={() =>
                            void act(async () => {
                              const result = await saveTaskViewDefinitionAction(
                                workspaceId,
                                view.id,
                                definition
                              );
                              if (result.ok) onSelect(result.data);
                              return result;
                            })
                          }
                        >
                          {view.canManage ? t("Update view with current filters") : t("Save my filters")}
                        </button>
                      ) : null}
                      {view.canManage ? (
                        <button
                          type="button"
                          className="hover:text-text"
                          onClick={() => {
                            setRenaming(view.id);
                            setRenameName(view.name);
                          }}
                        >
                          <Pencil size={11} className="mr-1 inline" />
                          {t("Rename")}
                        </button>
                      ) : null}
                      {view.canManage ? (
                        <button
                          type="button"
                          className="hover:text-text"
                          onClick={() =>
                            void act(async () => {
                              const result = await updateTaskViewAction(workspaceId, view.id, {
                                shared: !view.shared,
                              });
                              if (result.ok && active?.id === view.id) onSelect(result.data);
                              return result;
                            })
                          }
                        >
                          {view.shared ? t("Make private") : t("Share with everyone")}
                        </button>
                      ) : null}
                      {view.canSetDefault ? (
                        <button
                          type="button"
                          className="hover:text-text"
                          onClick={() =>
                            void act(async () =>
                              view.isDefault
                                ? clearDefaultTaskViewAction(workspaceId, view.id)
                                : setDefaultTaskViewAction(workspaceId, view.id)
                            )
                          }
                        >
                          {view.isDefault ? t("Clear default") : t("Set as default")}
                        </button>
                      ) : null}
                      {subscriptions[view.id] ? (
                        <div className="w-full space-y-1 border-t border-border/60 pt-1" data-view-subscription>
                          <div className="flex gap-3">
                            {(["added", "completed"] as const).map((event) => (
                              <label key={event} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  data-view-notice={event}
                                  checked={subscriptions[view.id].events.includes(event)}
                                  onChange={(inputEvent) => {
                                    const current = subscriptions[view.id];
                                    const events = inputEvent.target.checked
                                      ? [...current.events, event]
                                      : current.events.filter((value) => value !== event);
                                    if (events.length === 0) return;
                                    void act(async () =>
                                      updateTaskViewSubscriptionAction(workspaceId, view.id, {
                                        events,
                                      })
                                    );
                                  }}
                                />
                                {event === "added" ? t("Added tasks") : t("Completed tasks")}
                              </label>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="hover:text-text"
                            onClick={() =>
                              void act(async () =>
                                updateTaskViewSubscriptionAction(workspaceId, view.id, {
                                  muted: !subscriptions[view.id].muted,
                                })
                              )
                            }
                          >
                            {subscriptions[view.id].muted ? t("Unmute notifications") : t("Mute notifications")}
                          </button>
                        </div>
                      ) : null}
                      {view.canManage ? (
                        <button
                          type="button"
                          className="text-danger hover:underline"
                          onClick={() => void remove(view)}
                        >
                          <Trash2 size={11} className="mr-1 inline" />
                          {t("Delete")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="space-y-1 border-t border-border pt-2"
          >
            <div className="flex gap-2">
              <input
                data-view-name
                disabled={busy}
                aria-label={t("View name")}
                placeholder={t("View name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg p-1 text-body"
              />
              <button type="submit" disabled={busy || !name.trim()}>
                {t("Save view")}
              </button>
            </div>
            <label className="flex items-center gap-1.5 px-1 text-caption text-muted">
              <input
                data-view-shared
                type="checkbox"
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
              />
              {t("Share with everyone")}
            </label>
          </form>
          {error ? (
            <p role="alert" className="text-danger">
              {t(error)}
            </p>
          ) : null}
        </div>
      )}
    </Menu>
    </>
  );
}
