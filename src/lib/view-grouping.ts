// Pure grouping for the list and board. No database here: the browser groups what it
// already has, and the check harness exercises the same function.
import { PRIORITY_NAMES, STATUS_META, STATUS_ORDER } from "./constants";
import type { ViewGrouping } from "./task-view";

export type GroupableTask = {
  id: string;
  status: string;
  priority: number;
  dueDate: string | null;
  projectName: string;
  assignees: { id: string; displayName?: string }[];
  labels: { name: string }[];
};

export type TaskGroup<T> = {
  // Stable React key and drop target, e.g. "status:todo" or "assignee:<id>".
  key: string;
  // English label; the UI translates the fixed ones.
  label: string;
  property: ViewGrouping;
  // The property value this group stands for, for a board drop.
  value: string | null;
  tasks: T[];
};

export type GroupContext = {
  members: { id: string; displayName: string }[];
  projects: string[];
  // YYYY-MM-DD; the checks pass a fixed day.
  today?: string;
  statusOrder?: readonly string[];
};

export const NO_GROUP = "__none";

function unassignedGroup<T>(tasks: T[]): TaskGroup<T> {
  return { key: "assignee:" + NO_GROUP, label: "No assignee", property: "assignee", value: null, tasks };
}

/**
 * One group per task for a single-valued property. A task with several assignees or
 * labels lands under the first one (the list already sorts them), so it never appears
 * twice in the same list.
 */
export function groupTasks<T extends GroupableTask>(
  tasks: T[],
  grouping: ViewGrouping,
  context: GroupContext,
  options: { includeEmpty?: boolean } = {}
): TaskGroup<T>[] {
  const includeEmpty = options.includeEmpty ?? false;
  const groups = new Map<string, TaskGroup<T>>();
  const add = (key: string, label: string, value: string | null, task: T) => {
    let group = groups.get(key);
    if (!group) {
      group = { key: `${grouping}:${key || NO_GROUP}`, label, property: grouping, value, tasks: [] };
      groups.set(key, group);
    }
    group.tasks.push(task);
  };
  const empty = (key: string, label: string, value: string | null) => {
    if (includeEmpty && !groups.has(key)) {
      groups.set(key, { key: `${grouping}:${key || NO_GROUP}`, label, property: grouping, value, tasks: [] });
    }
  };

  if (grouping === "status") {
    for (const status of context.statusOrder ?? STATUS_ORDER) {
      empty(status, STATUS_META[status as keyof typeof STATUS_META]?.label ?? status, status);
    }
    for (const task of tasks) {
      add(task.status, STATUS_META[task.status as keyof typeof STATUS_META]?.label ?? task.status, task.status, task);
    }
  } else if (grouping === "assignee") {
    for (const member of context.members) {
      empty(member.id, member.displayName, member.id);
    }
    for (const task of tasks) {
      const person = [...task.assignees].sort((a, b) =>
        (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id)
      )[0];
      if (person) add(person.id, person.displayName ?? person.id, person.id, task);
      else add(NO_GROUP, "No assignee", null, task);
    }
    if (!groups.has(NO_GROUP)) {
      // "No assignee" is only useful as a drop target when grouping by person.
      const group = unassignedGroup<T>([]);
      if (includeEmpty || tasks.length > 0) groups.set(NO_GROUP, group);
    }
  } else if (grouping === "priority") {
    for (const priority of [4, 3, 2, 1, 0]) {
      empty(String(priority), PRIORITY_NAMES[priority as 1], String(priority));
    }
    for (const task of tasks) {
      add(String(task.priority), PRIORITY_NAMES[task.priority as 1] ?? "No priority", String(task.priority), task);
    }
  } else if (grouping === "project") {
    for (const project of context.projects) {
      empty(project, project, project);
    }
    for (const task of tasks) {
      add(task.projectName || NO_GROUP, task.projectName || "No project", task.projectName || null, task);
    }
  } else if (grouping === "label") {
    for (const task of tasks) {
      const label = [...task.labels].sort((a, b) => a.name.localeCompare(b.name))[0];
      if (label) add(label.name, label.name, label.name, task);
      else add(NO_GROUP, "No label", null, task);
    }
  } else {
    // Due-date buckets read in the order someone plans a week.
    const today = context.today ?? new Date().toISOString().slice(0, 10);
    const week = new Date(`${today}T00:00:00`);
    week.setDate(week.getDate() + 7);
    const weekEnd = week.toISOString().slice(0, 10);
    const buckets: [string, string][] = [
      ["overdue", "Overdue"],
      ["today", "Today"],
      ["week", "This week"],
      ["later", "Later"],
      ["none", "No due date"],
    ];
    for (const [key, label] of buckets) empty(key, label, key);
    for (const task of tasks) {
      if (!task.dueDate) add("none", "No due date", "none", task);
      else if (task.dueDate < today) add("overdue", "Overdue", "overdue", task);
      else if (task.dueDate === today) add("today", "Today", "today", task);
      else if (task.dueDate <= weekEnd) add("week", "This week", "week", task);
      else add("later", "Later", "later", task);
    }
  }

  const order =
    grouping === "assignee"
      ? [...context.members.map((member) => member.id), NO_GROUP]
      : grouping === "priority"
        ? ["4", "3", "2", "1", "0"]
        : grouping === "dueDate"
          ? ["overdue", "today", "week", "later", "none"]
          : grouping === "project"
            ? [...context.projects, NO_GROUP]
            : [...(context.statusOrder ?? STATUS_ORDER)];
  return [...groups.values()].sort((a, b) => {
    const aKey = a.key.slice(grouping.length + 1);
    const bKey = b.key.slice(grouping.length + 1);
    const aAt = order.indexOf(aKey);
    const bAt = order.indexOf(bKey);
    if (aAt !== -1 || bAt !== -1) return (aAt === -1 ? 9999 : aAt) - (bAt === -1 ? 9999 : bAt);
    return a.label.localeCompare(b.label);
  });
}
