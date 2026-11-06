// What a table, board or calendar applies to tasks. No database here: the browser runs it, and
// the same code checks a value before it is stored.
import { STATUS_ORDER } from "./constants";
import { TacosError } from "./tacos-error";

export const FIELD_TYPES = ["text", "number", "select", "date", "checkbox"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type TaskField = {
  id: string;
  name: string;
  type: FieldType;
  options: string[];
  createdBy: string;
  disabledAt?: string | null;
};

export type FieldValues = Record<string, Record<string, string>>;

export const FILTER_OPS = ["is", "is_not", "contains", "gt", "lt", "empty", "not_empty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type ViewFilter = { key: string; op: FilterOp; value?: string };
export type ViewSort = { key: string; dir: "asc" | "desc" };
export type TaskView = { filters: ViewFilter[]; sort: ViewSort[] };

export const EMPTY_VIEW: TaskView = { filters: [], sort: [] };
export const BUILTIN_KEYS = ["title", "status", "priority", "assignee", "project", "dueDate"] as const;

// The part of a task a view reads, so this file needs nothing from the server's types.
export type ViewTask = {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueDate: string | null;
  projectName: string;
  assignees: { id: string }[];
};

const FIELD_PREFIX = "field:";

export const fieldKey = (fieldId: string) => `${FIELD_PREFIX}${fieldId}`;

function rawValues(task: ViewTask, key: string, values: FieldValues): string[] {
  if (key.startsWith(FIELD_PREFIX)) {
    const value = values[task.id]?.[key.slice(FIELD_PREFIX.length)];
    return value ? [value] : [];
  }
  switch (key) {
    case "title":
      return [task.title];
    case "status":
      return [task.status];
    case "priority":
      return task.priority ? [String(task.priority)] : [];
    case "assignee":
      return task.assignees.map((person) => person.id);
    case "project":
      return [task.projectName];
    case "dueDate":
      return task.dueDate ? [task.dueDate] : [];
    default:
      return [];
  }
}

function matches(task: ViewTask, filter: ViewFilter, numericKeys: Set<string>, values: FieldValues): boolean {
  const raw = rawValues(task, filter.key, values);
  const wanted = (filter.value ?? "").trim().toLowerCase();
  switch (filter.op) {
    case "empty":
      return raw.length === 0;
    case "not_empty":
      return raw.length > 0;
    case "is":
      return !wanted || raw.some((value) => value.toLowerCase() === wanted);
    case "is_not":
      return !wanted || !raw.some((value) => value.toLowerCase() === wanted);
    case "contains":
      return !wanted || raw.some((value) => value.toLowerCase().includes(wanted));
    case "gt":
    case "lt": {
      if (!wanted) return true;
      const numeric = numericKeys.has(filter.key);
      return raw.some((value) => {
        const order = numeric ? Number(value) - Number(wanted) : value.localeCompare(wanted);
        return filter.op === "gt" ? order > 0 : order < 0;
      });
    }
  }
}

function compare(a: ViewTask, b: ViewTask, sort: ViewSort, numericKeys: Set<string>, values: FieldValues): number {
  const [left] = rawValues(a, sort.key, values);
  const [right] = rawValues(b, sort.key, values);
  // Tasks with nothing set stay at the bottom in both directions.
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  let order: number;
  if (sort.key === "status") {
    order = STATUS_ORDER.indexOf(left as never) - STATUS_ORDER.indexOf(right as never);
  } else if (numericKeys.has(sort.key)) {
    order = Number(left) - Number(right);
  } else {
    order = left.localeCompare(right);
  }
  return sort.dir === "desc" ? -order : order;
}

export function applyView<T extends ViewTask>(
  tasks: T[],
  view: TaskView,
  fields: TaskField[],
  values: FieldValues
): T[] {
  // A saved filter can outlive its field; it then stops applying instead of emptying the list.
  const keys=new Set(fields.map(field=>fieldKey(field.id)));
  const numericKeys=new Set(["priority",...fields.filter(field=>field.type==="number").map(field=>fieldKey(field.id))]);
  const live = (key: string) =>
    !key.startsWith(FIELD_PREFIX) || keys.has(key);
  const filters = view.filters.filter((filter) => live(filter.key));
  const sorts = view.sort.filter((sort) => live(sort.key));
  const shown = tasks.filter((task) => filters.every((filter) => matches(task, filter, numericKeys, values)));
  if (!sorts.length) return shown;
  return [...shown].sort((a, b) => {
    for (const sort of sorts) {
      const order = compare(a, b, sort, numericKeys, values);
      if (order) return order;
    }
    return 0;
  });
}

/** The stored form of a value, or null to clear it. Throws when it does not fit the field. */
export function normalizeFieldValue(field: TaskField, raw: string | null): string | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  switch (field.type) {
    case "text":
      return value.slice(0, 2000);
    case "number":
      if (!Number.isFinite(Number(value))) throw new TacosError("That is not a number", 400);
      return String(Number(value));
    case "select":
      if (!field.options.includes(value)) throw new TacosError("That is not one of this field's options", 400);
      return value;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new TacosError("That is not a date", 400);
      }
      return value;
    case "checkbox":
      return value === "1" ? "1" : null;
  }
}
