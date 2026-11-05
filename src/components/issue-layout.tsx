"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Columns3, List, Plus, Table2 } from "lucide-react";
import { IssueBoard } from "@/components/issue-board";
import { IssueTable } from "@/components/issue-table";
import { useUI, type IssueLayout as Layout } from "@/components/ui-context";
import { TaskGrid } from "@/components/task-grid";
import { TaskViewBar } from "@/components/task-view-bar";
import type { IssueWithLabels } from "@/lib/issues";
import { EMPTY_VIEW, applyView, type FieldValues, type TaskField, type TaskView } from "@/lib/task-view";
import { useStoredJson } from "@/lib/use-stored-json";
import { interpolate, useT } from "@/components/i18n-context";

const TaskCalendar = dynamic(() => import("@/components/task-calendar"), { ssr: false });

const NO_FIELDS: TaskField[] = [];
const NO_VALUES: FieldValues = {};

const LAYOUTS: { key: Layout; label: string; icon: typeof List }[] = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: Columns3 },
  { key: "table", label: "Table", icon: Table2 },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
];

export function LayoutToggle() {
  const t = useT();
  const { layout, setLayout } = useUI();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-elevated/50 p-0.5">
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setLayout(key)}
          aria-pressed={layout === key}
          aria-label={t(label)}
          title={t(label)}
          className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
            layout === key
              ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-muted hover:text-text"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function Empty() {
  const t = useT();
  const { setComposerOpen } = useUI();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="text-lead font-medium text-muted">{t("No issues found")}</div>
      <div className="text-body text-faint">
        {interpolate(t("Adjust your filters, or press {key} to create one."), {
          key: <kbd className="rounded border border-border px-1 font-mono text-caption">C</kbd>,
        })}
      </div>
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover"
      >
        <Plus size={13} /> {t("New issue")}
      </button>
    </div>
  );
}

export function IssueLayout({
  issues,
  workspaceId,
  currentUserId,
  fields = NO_FIELDS,
  values = NO_VALUES,
  manageFields = false,
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
  fields?: TaskField[];
  values?: FieldValues;
  manageFields?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { layout } = useUI();
  const [view, setView] = useStoredJson<TaskView>(`tacos.tasks.view.${workspaceId}`, EMPTY_VIEW);
  const shown = useMemo(() => applyView(issues, view, fields, values), [issues, view, fields, values]);
  if (issues.length === 0) return <Empty />;
  return (
    <>
      <TaskViewBar
        workspaceId={workspaceId}
        view={view}
        onChange={setView}
        fields={fields}
        issues={issues}
        manageFields={manageFields}
        onFieldsChanged={() => router.refresh()}
      />
      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-body text-faint">
          {t("No tasks match this filter")}
        </div>
      ) : layout === "board" ? (
        <IssueBoard issues={shown} workspaceId={workspaceId} currentUserId={currentUserId} />
      ) : layout === "table" ? (
        <TaskGrid
          workspaceId={workspaceId}
          issues={shown}
          fields={fields}
          values={values}
          view={view}
          onViewChange={setView}
        />
      ) : layout === "calendar" ? (
        <TaskCalendar workspaceId={workspaceId} issues={shown} />
      ) : (
        <IssueTable issues={shown} />
      )}
    </>
  );
}
