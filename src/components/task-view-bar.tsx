"use client";

import type { ReactNode } from "react";
import { DebouncedInput } from "./ui/debounced-input";
import { TaskFieldManager } from "@/components/task-field-manager";
import { useState } from "react";
import { ArrowDownUp, Filter, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { createTaskFieldAction, deleteTaskFieldAction, taskFieldImpactAction, restoreTaskFieldAction } from "@/app/actions";
import { useUI } from "@/components/ui-context";
import { Menu, MenuItem } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { STATUS_META } from "@/components/icons";
import { PRIORITY_NAMES, STATUS_ORDER } from "@/lib/constants";
import type { IssueWithLabels } from "@/lib/issues";
import {
  BUILTIN_KEYS,
  FIELD_TYPES,
  fieldKey,
  type FieldType,
  type FilterOp,
  type TaskField,
  type TaskView,
  type ViewFilter,
} from "@/lib/task-view";
import { PAGE_INSET } from "@/lib/page-chrome";

const BUILTIN_LABEL: Record<(typeof BUILTIN_KEYS)[number], string> = {
  title: "Title",
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  project: "Project",
  dueDate: "Due date",
  source: "Source",
};

const OP_LABEL: Record<FilterOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  gt: "greater or later than",
  lt: "less or earlier than",
  empty: "is empty",
  not_empty: "is not empty",
};

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  date: "Date",
  checkbox: "Checkbox",
};

const inputClass = "min-w-0 rounded border border-border bg-bg px-1 py-0.5 text-small text-text";
const triggerClass =
  "flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text";

/** A fixed list of choices for keys that have one; everything else is typed. */
function choicesFor(
  key: string,
  fields: TaskField[],
  issues: IssueWithLabels[],
  t: (text: string) => string,
  choices?:{projects:string[];members:{id:string;displayName:string}[]}
): { value: string; label: string }[] | null {
  if (key === "status") {
    return [
      { value: "active", label: t("Active") },
      ...STATUS_ORDER.map((value) => ({ value, label: t(STATUS_META[value].label) })),
    ];
  }
  if (key === "source") {
    return [
      { value: "person", label: t("Person") },
      { value: "agent", label: t("Agent") },
    ];
  }
  if (key === "priority") {
    return [1, 2, 3, 4].map((value) => ({ value: String(value), label: t(PRIORITY_NAMES[value as 1]) }));
  }
  if (key === "project") {
    return [...new Set((choices?.projects??issues.map((issue) => issue.projectName)))].map((value) => ({ value, label: value }));
  }
  if (key === "assignee") {
    const people = new Map((choices?.members??issues.flatMap((issue) => issue.assignees)).map((person) => [person.id, person.displayName]));
    return [...people].map(([value, label]) => ({ value, label }));
  }
  const field = fields.find((candidate) => fieldKey(candidate.id) === key);
  if (field?.type === "select") return field.options.map((value) => ({ value, label: value }));
  if (field?.type === "checkbox") return [{ value: "1", label: t("Checked") }];
  return null;
}

function inputType(key: string, fields: TaskField[]): string {
  if (key === "dueDate") return "date";
  const type = fields.find((field) => fieldKey(field.id) === key)?.type;
  return type === "date" ? "date" : type === "number" ? "number" : "text";
}

/** Reads the active filters as words, for the "nothing matches" state. */
export function filterSummary(
  view: TaskView,
  fields: TaskField[],
  issues: IssueWithLabels[],
  t: (text: string) => string,
  choices?:{projects:string[];members:{id:string;displayName:string}[]}
): string {
  return view.filters
    .map((filter) => {
      const field = fields.find((candidate) => fieldKey(candidate.id) === filter.key);
      const name = field?.name ?? t((BUILTIN_LABEL as Record<string, string>)[filter.key] ?? filter.key);
      if (filter.op === "empty" || filter.op === "not_empty") return `${name} ${t(OP_LABEL[filter.op])}`;
      const value = choicesFor(filter.key, fields, issues, t, choices)?.find((choice) => choice.value === filter.value)?.label ?? filter.value ?? "";
      return `${name} ${t(OP_LABEL[filter.op])} ${value}`;
    })
    .join("; ");
}

export function TaskViewBar({
  workspaceId,
  view,
  onChange,
  fields,
  issues,
  manageFields,
  onFieldsChanged,choices:filterChoices,
  leading,
  trailing,
  onExport,
  exportDisabled,
}: {
  workspaceId: string;
  view: TaskView;
  onChange: (next: TaskView) => void;
  fields: TaskField[];
  issues: IssueWithLabels[];
  manageFields: boolean;
  onFieldsChanged: () => void;
  choices?:{projects:string[];members:{id:string;displayName:string}[]};
  leading?: ReactNode;
  trailing?: ReactNode;
  onExport?: () => void;
  exportDisabled?: boolean;
}) {
  const t = useT();
  const {confirm, toast} = useUI();
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldManagerOpen, setFieldManagerOpen] = useState(false);

  const keys = [
    ...BUILTIN_KEYS.map((key) => ({ key: key as string, label: t(BUILTIN_LABEL[key]) })),
    ...fields.map((field) => ({ key: fieldKey(field.id), label: field.name })),
  ];
  const keySelect = (value: string, onPick: (next: string) => void) => (
    <select value={value} onChange={(event) => onPick(event.target.value)} className={inputClass}>
      {keys.map((key) => (
        <option key={key.key} value={key.key}>
          {key.label}
        </option>
      ))}
    </select>
  );

  const setFilter = (index: number, patch: Partial<ViewFilter>) =>
    onChange({
      ...view,
      filters: view.filters.map((filter, at) => (at === index ? { ...filter, ...patch } : filter)),
    });

  async function addField() {
    const result = await createTaskFieldAction(workspaceId, {
      name,
      type,
      options: options.split(/[,，\n]/),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName("");
    setOptions("");
    onFieldsChanged();
  }

  async function removeField(id: string) {
    const impact = await taskFieldImpactAction(workspaceId,id);
    if(!impact.ok){setError(impact.error);return;}
    if(!await confirm(t("Disable this field on {count} tasks?",{count:impact.data}),{ body: t("Values are kept and can be restored."), action: t("Disable") }))return;
    const result = await deleteTaskFieldAction(workspaceId, id);
    if (result.ok) {onFieldsChanged();toast(t("Field disabled"),{label:t("Undo"),run:async()=>{const restored=await restoreTaskFieldAction(workspaceId,id);if(!restored.ok)setError(restored.error);else onFieldsChanged();}});}
    else setError(result.error);
  }

  return (
    <div data-task-view-bar className={`flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-border py-1 ${PAGE_INSET}`}>
      {leading}
      <Menu
        width={420}
        triggerClassName={triggerClass}
        trigger={
          <>
            <Filter size={12} /> {t("Filter")}
            {view.filters.length > 0 && <span className="text-accent">{view.filters.length}</span>}
          </>
        }
      >
        {() => (
          <div data-task-filters className="space-y-1.5 p-2 text-small">
            {view.filters.map((filter, index) => {
              const choices = choicesFor(filter.key, fields, issues, t,filterChoices);
              const needsValue = filter.op !== "empty" && filter.op !== "not_empty";
              return (
                <div key={index} className="flex flex-wrap items-center gap-1">
                  {keySelect(filter.key, (key) => setFilter(index, { key, value: "" }))}
                  <select
                    value={filter.op}
                    onChange={(event) => setFilter(index, { op: event.target.value as FilterOp })}
                    className={inputClass}
                  >
                    {(Object.keys(OP_LABEL) as FilterOp[]).map((op) => (
                      <option key={op} value={op}>
                        {t(OP_LABEL[op])}
                      </option>
                    ))}
                  </select>
                  {needsValue &&
                    (choices ? (
                      <select
                        value={filter.value ?? ""}
                        onChange={(event) => setFilter(index, { value: event.target.value })}
                        className={`${inputClass} flex-1`}
                      >
                        <option value="" />
                        {choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <DebouncedInput
                        type={inputType(filter.key, fields)}
                        value={filter.value ?? ""}
                        onCommit={(value) => setFilter(index, { value })}
                        className={`${inputClass} flex-1`}
                      />
                    ))}
                  <button
                    type="button"
                    aria-label={t("Remove filter")}
                    onClick={() => onChange({ ...view, filters: view.filters.filter((_, at) => at !== index) })}
                    className="ml-auto shrink-0 text-faint hover:text-text"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                onChange({ ...view, filters: [...view.filters, { key: "status", op: "is", value: "" }] })
              }
              className="flex items-center gap-1 text-muted hover:text-text"
            >
              <Plus size={12} /> {t("Add filter")}
            </button>
          </div>
        )}
      </Menu>
      <Menu
        width={280}
        triggerClassName={triggerClass}
        trigger={
          <>
            <ArrowDownUp size={12} /> {t("Sort")}
            {view.sort.length > 0 && <span className="text-accent">{view.sort.length}</span>}
          </>
        }
      >
        {() => (
          <div data-task-sorts className="space-y-1.5 p-2 text-small">
            {view.sort.map((sort, index) => (
              <div key={index} className="flex items-center gap-1">
                {keySelect(sort.key, (key) =>
                  onChange({
                    ...view,
                    sort: view.sort.map((item, at) => (at === index ? { ...item, key } : item)),
                  })
                )}
                <select
                  value={sort.dir}
                  onChange={(event) =>
                    onChange({
                      ...view,
                      sort: view.sort.map((item, at) =>
                        at === index ? { ...item, dir: event.target.value as "asc" | "desc" } : item
                      ),
                    })
                  }
                  className={inputClass}
                >
                  <option value="asc">{t("Ascending")}</option>
                  <option value="desc">{t("Descending")}</option>
                </select>
                <button
                  type="button"
                  aria-label={t("Remove sort")}
                  onClick={() => onChange({ ...view, sort: view.sort.filter((_, at) => at !== index) })}
                  className="ml-auto shrink-0 text-faint hover:text-text"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange({ ...view, sort: [...view.sort, { key: "dueDate", dir: "asc" }] })}
              className="flex items-center gap-1 text-muted hover:text-text"
            >
              <Plus size={12} /> {t("Add sort")}
            </button>
          </div>
        )}
      </Menu>
      <span className="flex-1" />
      {trailing}
      {manageFields&&<TaskFieldManager workspaceId={workspaceId} open={fieldManagerOpen} onOpenChange={setFieldManagerOpen}/>}
      {(manageFields || onExport) && (
        <Menu
          width={300}
          align="right"
          triggerClassName={triggerClass}
          trigger={<MoreHorizontal size={14} aria-label={t("More actions")} />}
        >
          {(close) => (<>
            {onExport && <MenuItem disabled={exportDisabled} onSelect={() => { close(); onExport(); }}>{t("Export all filtered tasks")}</MenuItem>}
            {manageFields && <MenuItem onSelect={() => { close(); setFieldManagerOpen(true); }}>{t("Manage fields")}</MenuItem>}
            {manageFields && <div data-task-fields className="mt-1 space-y-1.5 border-t border-border p-2 text-small">
              {fields.map((field) => (
                <div key={field.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-text">{field.name}</span>
                  <span className="shrink-0 text-faint">{t(TYPE_LABEL[field.type])}</span>
                  <button
                    type="button"
                    aria-label={t("Delete field")}
                    onClick={() => void removeField(field.id)}
                    className="shrink-0 text-faint hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1 border-t border-border pt-1.5">
                <input
                  data-task-field-name
                  value={name}
                  placeholder={t("Field name")}
                  onChange={(event) => setName(event.target.value)}
                  className={`${inputClass} flex-1`}
                />
                <select
                  data-task-field-type
                  value={type}
                  onChange={(event) => setType(event.target.value as FieldType)}
                  className={inputClass}
                >
                  {FIELD_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(TYPE_LABEL[value])}
                    </option>
                  ))}
                </select>
              </div>
              {type === "select" && (
                <input
                  data-task-field-options
                  value={options}
                  placeholder={t("Options, separated by commas")}
                  onChange={(event) => setOptions(event.target.value)}
                  className={`${inputClass} w-full`}
                />
              )}
              <button
                type="button"
                data-task-field-add
                onClick={() => void addField()}
                className="flex items-center gap-1 text-muted hover:text-text"
              >
                <Plus size={12} /> {t("Add field")}
              </button>
              {error && <div className="text-danger">{t(error)}</div>}
            </div>}
          </>)}
        </Menu>
      )}
    </div>
  );
}
