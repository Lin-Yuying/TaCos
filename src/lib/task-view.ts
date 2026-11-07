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

// The per-view display options. They live in the saved definition, so opening a view
// restores its layout and grouping; a personal override keeps one member's changes
// out of everyone else's copy.
export const VIEW_LAYOUTS = ["list", "board", "table", "calendar"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const VIEW_GROUPINGS = ["status", "assignee", "project", "priority", "label", "dueDate"] as const;
export type ViewGrouping = (typeof VIEW_GROUPINGS)[number];

export const VIEW_ORDERINGS = ["manual", "status", "priority", "created", "updated", "dueDate"] as const;
export type ViewOrdering = (typeof VIEW_ORDERINGS)[number];

export const VIEW_PROPERTIES = [
  "id",
  "status",
  "assignee",
  "priority",
  "project",
  "dueDate",
  "labels",
  "dates",
] as const;
export type ViewProperty = (typeof VIEW_PROPERTIES)[number];

export type TaskViewDisplay = {
  grouping: ViewGrouping;
  ordering: ViewOrdering;
  // Show tasks that are subtasks of another task.
  subIssues: boolean;
  // Draw group headers with zero tasks.
  showEmptyGroups: boolean;
  // Which columns the list and board cards draw.
  properties: ViewProperty[];
};

export const DEFAULT_DISPLAY: TaskViewDisplay = {
  grouping: "status",
  ordering: "manual",
  subIssues: true,
  showEmptyGroups: false,
  properties: ["id", "status", "assignee", "priority", "project", "labels", "dates"],
};

/** Stored/URL values are untrusted: keep the known members and fall back per field. */
export function normalizeDisplay(raw: unknown): TaskViewDisplay {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_DISPLAY;
  const input = raw as Record<string, unknown>;
  const properties = Array.isArray(input.properties)
    ? [...new Set(input.properties.filter((value): value is ViewProperty =>
        typeof value === "string" && (VIEW_PROPERTIES as readonly string[]).includes(value)
      ))]
    : DEFAULT_DISPLAY.properties;
  return {
    grouping: (VIEW_GROUPINGS as readonly string[]).includes(String(input.grouping))
      ? (input.grouping as ViewGrouping)
      : DEFAULT_DISPLAY.grouping,
    ordering: (VIEW_ORDERINGS as readonly string[]).includes(String(input.ordering))
      ? (input.ordering as ViewOrdering)
      : DEFAULT_DISPLAY.ordering,
    subIssues: typeof input.subIssues === "boolean" ? input.subIssues : DEFAULT_DISPLAY.subIssues,
    showEmptyGroups:
      typeof input.showEmptyGroups === "boolean"
        ? input.showEmptyGroups
        : DEFAULT_DISPLAY.showEmptyGroups,
    properties,
  };
}

export type TaskView = {
  filters: ViewFilter[];
  sort: ViewSort[];
  // Optional so every pre-display-options saved view keeps working.
  display?: TaskViewDisplay;
};

export const EMPTY_VIEW: TaskView = { filters: [], sort: [] };
export const EMPTY_DEFINITION: TaskView & { layout: ViewLayout } = {
  filters: [],
  sort: [],
  layout: "list",
  display: DEFAULT_DISPLAY,
};
export const BUILTIN_KEYS = ["title", "status", "priority", "assignee", "project", "dueDate", "source"] as const;

// The part of a task a view reads, so this file needs nothing from the server's types.
export type ViewTask = {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueDate: string | null;
  projectName: string;
  assignees: { id: string }[];
  // Tasks an agent created through the API or MCP, not ones a person opened.
  createdVia?: string;
  createdAt?: string;
  updatedAt?: string;
  // Set on a subtask; the sub-issue display option hides these.
  parentId?: string | null;
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
    case "source":
      return [task.createdVia === "api" || task.createdVia === "mcp" ? "agent" : "person"];
    case "dueDate":
      return task.dueDate ? [task.dueDate] : [];
    case "createdAt":
      return task.createdAt ? [task.createdAt] : [];
    case "updatedAt":
      return task.updatedAt ? [task.updatedAt] : [];
    default:
      return [];
  }
}

function matches(task: ViewTask, filter: ViewFilter, numericKeys: Set<string>, values: FieldValues): boolean {
  // "Active" is the two open statuses together, so a saved view can say what the quick
  // filter says without two OR-ed status filters.
  if (filter.key === "status" && filter.value === "active" && (filter.op === "is" || filter.op === "is_not")) {
    const active = task.status === "todo" || task.status === "in_progress";
    return filter.op === "is" ? active : !active;
  }
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

/** The ordering menu's fallback: explicit sorts always win over it. */
export function orderingSort(ordering: ViewOrdering): ViewSort[] {
  switch (ordering) {
    case "status":
      return [{ key: "status", dir: "asc" }];
    case "priority":
      return [{ key: "priority", dir: "desc" }];
    case "created":
      return [{ key: "createdAt", dir: "desc" }];
    case "updated":
      return [{ key: "updatedAt", dir: "desc" }];
    case "dueDate":
      return [{ key: "dueDate", dir: "asc" }];
    default:
      return [];
  }
}

/** True when the stored order is the server's own: no explicit sort and no display reordering. */
export function isManualOrder(view: TaskView): boolean {
  const display = normalizeDisplay(view.display);
  return view.sort.length === 0 && display.ordering === "manual" && display.subIssues;
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
  const display = normalizeDisplay(view.display);
  const source = display.subIssues ? tasks : tasks.filter((task) => !task.parentId);
  const shown = source.filter((task) => filters.every((filter) => matches(task, filter, numericKeys, values)));
  const effectiveSorts = sorts.length > 0 ? sorts : orderingSort(display.ordering);
  if (!effectiveSorts.length) return shown;
  return [...shown].sort((a, b) => {
    for (const sort of effectiveSorts) {
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
