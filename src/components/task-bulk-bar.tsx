"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckSquare, Tag, Trash2, UserRound, X } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { readJson } from "@/lib/ui/request";
import { PRIORITY_NAMES, STATUS_META, STATUS_ORDER, type Priority, type Status } from "@/lib/constants";
import { bulkUpdateIssuesAction } from "@/app/actions";
import type { BulkTaskPatch, BulkTaskResult } from "@/lib/issues";

const triggerClass =
  "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text";

/** One bar for the multi-select of the list, board and table. */
export function TaskBulkBar({
  workspaceId,
  selected,
  clear,
  onResults,
}: {
  workspaceId: string;
  selected: string[];
  clear: () => void;
  onResults: (results: BulkTaskResult[]) => void;
}) {
  const t = useT();
  const router = useRouter();
  type Option = { id: string; name: string };
  const [members, setMembers] = useState<Option[]>([]);
  const [labels, setLabels] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [due, setDue] = useState("");

  useEffect(() => {
    let live = true;
    for (const [kind, setter] of [
      ["members", setMembers],
      ["labels", setLabels],
      ["projects", setProjects],
    ] as const) {
      void readJson<{ id: string; displayName?: string; name?: string }[]>(
        `/api/internal/${workspaceId}/${kind}`,
        (data): data is { id: string; displayName?: string; name?: string }[] => Array.isArray(data)
      )
        .then((data) => {
          if (!live) return;
          setter(
            data.map((item) => ({ id: item.id, name: item.displayName ?? item.name ?? item.id }))
          );
        })
        .catch(() => {
          /* the bar still works for the fields that loaded */
        });
    }
    return () => {
      live = false;
    };
  }, [workspaceId]);

  async function apply(patch: BulkTaskPatch) {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await bulkUpdateIssuesAction(workspaceId, selected, patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const failed = result.data.results.filter((row) => !row.ok);
      setSummary(
        failed.length === 0
          ? t("Updated {count} tasks.", { count: result.data.updated })
          : t("Updated {updated} tasks. {failed} failed: {reason}", {
              updated: result.data.updated,
              failed: failed.length,
              reason: failed
                .slice(0, 3)
                .map((row) => row.error)
                .filter(Boolean)
                .join("; "),
            })
      );
      onResults(result.data.results);
      router.refresh();
    } catch {
      setError(t("Could not save. Retry."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-task-bulk className="flex flex-wrap items-center gap-1.5 border-b border-border bg-elevated/30 px-3 py-1 text-small">
      <span className="flex items-center gap-1 font-medium text-text">
        <CheckSquare size={12} />
        {t("{count} selected", { count: selected.length })}
      </span>
      <Menu width={180} triggerClassName={triggerClass} trigger={<>{t("Status")}</>}>
        {(close) => (
          <>
            {STATUS_ORDER.map((status) => (
              <MenuItem
                key={status}
                onSelect={() => {
                  close();
                  void apply({ status: status as Status });
                }}
              >
                {t(STATUS_META[status].label)}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu width={220} triggerClassName={triggerClass} trigger={<><UserRound size={12} />{t("Assignee")}</>}>
        {(close) => (
          <>
            <MenuItem
              onSelect={() => {
                close();
                void apply({ assigneeIds: [] });
              }}
            >
              <span className="text-faint">—</span> {t("Unassigned")}
            </MenuItem>
            {members.map((member) => (
              <MenuItem
                key={member.id}
                onSelect={() => {
                  close();
                  void apply({ assigneeIds: [member.id] });
                }}
              >
                {member.name}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu width={180} triggerClassName={triggerClass} trigger={<>{t("Priority")}</>}>
        {(close) => (
          <>
            {([4, 3, 2, 1, 0] as Priority[]).map((priority) => (
              <MenuItem
                key={priority}
                onSelect={() => {
                  close();
                  void apply({ priority });
                }}
              >
                {t(PRIORITY_NAMES[priority])}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Menu width={200} triggerClassName={triggerClass} trigger={<><Tag size={12} />{t("Add label")}</>}>
        {(close) => (
          <>
            {labels.length === 0 ? (
              <div className="px-2 py-1 text-small text-faint">{t("No labels yet.")}</div>
            ) : (
              labels.map((label) => (
                <MenuItem
                  key={label.id}
                  onSelect={() => {
                    close();
                    void apply({ labelAdd: [label.name] });
                  }}
                >
                  {label.name}
                </MenuItem>
              ))
            )}
          </>
        )}
      </Menu>
      <Menu width={200} triggerClassName={triggerClass} trigger={t("Remove label")}>
        {(close) => (
          <>
            {labels.length === 0 ? (
              <div className="px-2 py-1 text-small text-faint">{t("No labels yet.")}</div>
            ) : (
              labels.map((label) => (
                <MenuItem
                  key={label.id}
                  onSelect={() => {
                    close();
                    void apply({ labelRemove: [label.name] });
                  }}
                >
                  <Trash2 size={12} className="text-faint" />
                  {label.name}
                </MenuItem>
              ))
            )}
          </>
        )}
      </Menu>
      <Menu
        width={220}
        triggerClassName={triggerClass}
        trigger={<><CalendarDays size={12} />{t("Due date")}</>}
      >
        {() => (
          <div className="space-y-1.5 p-1">
            <input
              type="date"
              data-bulk-due
              aria-label={t("Due date")}
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="w-full rounded border border-border bg-bg px-1 py-0.5 text-small text-text"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!due || busy}
                onClick={() => void apply({ dueDate: due })}
                className="rounded border border-border px-2 py-0.5 text-small disabled:opacity-40"
              >
                {t("Apply")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply({ dueDate: null })}
                className="text-small text-muted hover:text-text"
              >
                {t("Clear due date")}
              </button>
            </div>
          </div>
        )}
      </Menu>
      <Menu width={200} triggerClassName={triggerClass} trigger={t("Project")}>
        {(close) => (
          <>
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                onSelect={() => {
                  close();
                  void apply({ projectId: project.id });
                }}
              >
                {project.name}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <button type="button" onClick={clear} disabled={busy} className="ml-auto flex items-center gap-1 text-faint hover:text-text disabled:opacity-40">
        <X size={12} /> {t("Clear")}
      </button>
      {summary ? (
        <span role="status" className="text-small text-muted">
          {summary}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-small text-danger">
          {t(error)}
        </span>
      ) : null}
    </div>
  );
}
