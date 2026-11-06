"use client";
import { useEffect, useRef, useState } from "react";
import {
  listPersonalViewsAction,
  savePersonalViewAction,
  deletePersonalViewAction,
} from "@/app/personal-view-actions";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import { Menu } from "@/components/menu";
import type { PersonalView } from "@/lib/personal-views";
import type { TaskView } from "@/lib/task-view";
export function PersonalViews({
  workspaceId,
  viewScope,
  view,
  onChange,
}: {
  workspaceId: string;
  viewScope: string;
  view: TaskView;
  onChange: (view: TaskView) => void;
}) {
  const t = useT(),
    { layout, setLayout, confirm } = useUI();
  const [items, setItems] = useState<PersonalView[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void listPersonalViewsAction(workspaceId, viewScope)
      .then((result) => {
        if (!live) return;
        if (result.ok) setItems(result.data);
        else setError(result.error);
      })
      .catch(() => {
        if (live) setError("Could not load views. Reopen to retry.");
      });
    return () => {
      live = false;
    };
  }, [workspaceId, viewScope, attempt]);
  async function save(remove?: string) {
    if (running.current) return;
    if (
      remove &&
      !(await confirm(t("Delete personal view “{name}”?", { name: remove })))
    )
      return;
    running.current = true;
    setBusy(true);
    try {
      const result = remove
        ? await deletePersonalViewAction(workspaceId, viewScope, remove)
        : await savePersonalViewAction(workspaceId, viewScope, name, {
            ...view,
            layout,
          });
      if (result.ok) {
        setItems(result.data);
        setName("");
        setError(null);
      } else setError(result.error);
    } catch {
      setError("Could not save. Retry.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Menu
      onOpenChange={(open) => {
        if (open) setAttempt((old) => old + 1);
      }}
      width={320}
      trigger={t("Personal views")}
    >
      {(close) => (
        <div className="space-y-2 p-2 text-small">
          {items.map((item) => (
            <div key={item.name} className="flex gap-2">
              <button
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => {
                  onChange({
                    filters: item.view.filters,
                    sort: item.view.sort,
                  });
                  setLayout(item.view.layout);
                  close();
                }}
              >
                {item.name}
              </button>
              <button disabled={busy} onClick={() => void save(item.name)}>
                {t("Delete")}
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="flex gap-2"
          >
            <input
              disabled={busy}
              aria-label={t("View name")}
              placeholder={t("View name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-bg p-1"
            />
            <button disabled={busy || !name.trim()}>{t("Save view")}</button>
          </form>
          {error && (
            <p role="alert" className="text-danger">
              {t(error)}
            </p>
          )}
        </div>
      )}
    </Menu>
  );
}
