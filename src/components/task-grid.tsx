"use client";

import { useRouter } from "next/navigation";
import { EntityRow } from "@/components/ui/entity-row";
import { useMemo, useRef, useState } from "react";
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { setTaskFieldValueAction } from "@/app/actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { PriorityIcon, StatusIcon, STATUS_META } from "@/components/icons";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import { issueRef } from "@/lib/format";
import type { IssueWithLabels } from "@/lib/issues";
import { fieldKey, type FieldValues, type TaskField, type TaskView } from "@/lib/task-view";

const FEATURES = tableFeatures({ columnSizingFeature });
const ROW_HEIGHT = 34;
const CELL_INPUT = "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-small text-text hover:border-border focus:border-border focus:outline-none";

function FieldCell({
  field,
  value,
  onSave,
}: {
  field: TaskField;
  value: string;
  onSave: (next: string | null) => void;
}) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === "1"}
        onClick={stop}
        onChange={(event) => onSave(event.target.checked ? "1" : null)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select value={value} onClick={stop} onChange={(event) => onSave(event.target.value || null)} className={CELL_INPUT}>
        <option value="" />
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      key={value}
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
      defaultValue={value}
      onClick={stop}
      onBlur={(event) => {
        if (event.target.value !== value) onSave(event.target.value || null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
      }}
      className={CELL_INPUT}
    />
  );
}

const SORT_KEYS: Record<string, string> = {
  ref: "",
  title: "title",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  dueDate: "dueDate",
};

/** The table view: built-in columns plus the workspace's fields, which edit in place. */
export function TaskGrid({
  workspaceId,
  issues,
  fields,
  values,
  view,
  onViewChange,
}: {
  workspaceId: string;
  issues: IssueWithLabels[];
  fields: TaskField[];
  values: FieldValues;
  view: TaskView;
  onViewChange: (next: TaskView) => void;
}) {
  const t = useT();
  const { openIssue } = useUI();
  const router=useRouter();
  const saving=useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => {
    const column = createColumnHelper<typeof FEATURES, IssueWithLabels>();
    const valueOf = (issueId: string, fieldId: string) => {
      return values[issueId]?.[fieldId] ?? "";
    };
    const save = async (issueId: string, fieldId: string, next: string | null) => {
      const key=`${issueId}:${fieldId}`;
      if(saving.current.has(key))return;
      saving.current.add(key);
      try {
      const result = await setTaskFieldValueAction(workspaceId, issueId, fieldId, next);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
      }catch{setError("Could not save. Retry.");}finally{saving.current.delete(key);}
    };
    return column.columns([
      column.display({
        id: "ref",
        header: t("ID"),
        size: 110,
        cell: ({ row }) => <span className="truncate font-mono text-small text-faint">{issueRef(row.original)}</span>,
      }),
      column.accessor("title", {
        id: "title",
        header: t("Title"),
        size: 320,
        cell: ({ row }) => <span className="truncate text-text">{row.original.title}</span>,
      }),
      column.accessor("status", {
        id: "status",
        header: t("Status"),
        size: 120,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 truncate text-muted">
            <StatusIcon status={row.original.status} size={13} />
            {t(STATUS_META[row.original.status].label)}
          </span>
        ),
      }),
      column.accessor("priority", {
        id: "priority",
        header: t("Priority"),
        size: 70,
        cell: ({ row }) => <PriorityIcon priority={row.original.priority} />,
      }),
      column.display({
        id: "assignee",
        header: t("Assignee"),
        size: 100,
        cell: ({ row }) => (
          <span className="flex items-center -space-x-1">
            {row.original.assignees.map((person) => (
              <AssigneeAvatar key={person.id} displayName={person.displayName} avatar={person.avatar} size={18} />
            ))}
          </span>
        ),
      }),
      column.accessor("dueDate", {
        id: "dueDate",
        header: t("Due date"),
        size: 110,
        cell: ({ row }) => <span className="text-muted">{row.original.dueDate}</span>,
      }),
      ...fields.map((field) =>
        column.display({
          id: fieldKey(field.id),
          header: field.name,
          size: field.type === "checkbox" ? 90 : 150,
          cell: ({ row }) => (
            <FieldCell
              field={field}
              value={valueOf(row.original.id, field.id)}
              onSave={(next) => void save(row.original.id, field.id, next)}
            />
          ),
        })
      ),
    ]);
  }, [fields, t, values, workspaceId,router]);

  const table = useTable({ features: FEATURES, data: issues, columns });
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const width = table.getTotalSize();

  function toggleSort(id: string) {
    const key = id.startsWith("field:") ? id : SORT_KEYS[id];
    if (!key) return;
    const current = view.sort[0]?.key === key ? view.sort[0].dir : null;
    onViewChange({
      ...view,
      // Off, ascending, descending, off: one click at a time, like every table.
      sort: current === "desc" ? [] : [{ key, dir: current === "asc" ? "desc" : "asc" }],
    });
  }

  return (
    <div data-task-grid ref={scroller} className="min-h-0 flex-1 overflow-auto text-small">
      {error && <div className="sticky left-0 px-4 py-1 text-small text-danger">{t(error)}</div>}
      <div style={{ width, minWidth: "100%" }}>
        {table.getHeaderGroups().map((group) => (
          <div key={group.id} className="sticky top-0 z-10 flex border-b border-border bg-bg">
            {group.headers.map((header) => {
              const key = header.id.startsWith("field:") ? header.id : SORT_KEYS[header.id];
              const sort = view.sort.find((item) => item.key === key);
              return (
                <button
                  key={header.id}
                  type="button"
                  disabled={!key}
                  onClick={() => toggleSort(header.id)}
                  style={{ width: header.getSize() }}
                  className="flex shrink-0 items-center gap-1 truncate px-2 py-1.5 text-left text-small font-medium text-muted enabled:hover:text-text"
                >
                  <span className="truncate"><table.FlexRender header={header} /></span>
                  {sort && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              );
            })}
          </div>
        ))}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.id}
                data-task-row={row.original.id}
                onClick={() => openIssue(row.original.id)}
                style={{ position: "absolute", top: 0, transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                className="flex w-full cursor-pointer items-center border-b border-border/60 hover:bg-elevated/60"
              >
                {row.getAllCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize() }}
                    className="flex shrink-0 items-center overflow-hidden px-2"
                  >
                    <table.FlexRender cell={cell} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
