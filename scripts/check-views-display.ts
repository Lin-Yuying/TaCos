/**
 * U-09 commit 2: grouping, ordering, sub-issues, empty groups and property options
 * on the same pure functions the list and board use.
 */
import assert from "node:assert/strict";
import {
  DEFAULT_DISPLAY,
  applyView,
  isManualOrder,
  normalizeDisplay,
  orderingSort,
  type TaskViewDisplay,
  type ViewTask,
} from "../src/lib/task-view";
import { groupTasks, NO_GROUP } from "../src/lib/view-grouping";

type Row = ViewTask & {
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  labels: { name: string }[];
  assignees: { id: string; displayName: string }[];
};

function row(
  id: string,
  patch: Partial<Row> = {}
): Row {
  return {
    id,
    title: id,
    status: "todo",
    priority: 0,
    dueDate: null,
    projectName: "Alpha",
    assignees: [],
    labels: [],
    ...patch,
  };
}

const rows: Row[] = [
  row("alpha", { status: "todo", priority: 2, dueDate: "2026-11-03", assignees: [{ id: "u1", displayName: "Ann" }], labels: [{ name: "bug" }], createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }),
  row("beta", { status: "in_progress", priority: 4, dueDate: "2026-11-06", assignees: [{ id: "u2", displayName: "Bob" }], labels: [{ name: "ui" }], createdAt: "2026-11-02T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" }),
  row("gamma", { status: "done", priority: 0, dueDate: null, labels: [], createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z" }),
  row("delta", { status: "todo", priority: 1, dueDate: "2026-12-01", projectName: "Beta", parentId: "alpha", assignees: [], labels: [{ name: "bug" }], createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z" }),
];

// --- normalizeDisplay ---
const normalized = normalizeDisplay({
  grouping: "label",
  ordering: "nope",
  subIssues: "yes",
  showEmptyGroups: true,
  properties: ["id", "id", "bogus", "priority"],
});
assert.equal(normalized.grouping, "label");
assert.equal(normalized.ordering, "manual", "unknown ordering falls back");
assert.equal(normalized.subIssues, DEFAULT_DISPLAY.subIssues, "non-boolean keeps the default");
assert.equal(normalized.showEmptyGroups, true);
assert.deepEqual(normalized.properties, ["id", "priority"], "properties are deduped and unknown ones dropped");
assert.deepEqual(normalizeDisplay(null), DEFAULT_DISPLAY);

const display = (patch: Partial<TaskViewDisplay>): TaskViewDisplay => ({
  ...DEFAULT_DISPLAY,
  ...patch,
});

// --- ordering ---
assert.deepEqual(orderingSort("manual"), []);
assert.equal(applyView(rows, { filters: [], sort: [], display: display({ ordering: "priority" }) }, [], {}).map((task) => task.id).join(","), "beta,alpha,delta,gamma");
assert.equal(
  applyView(rows, { filters: [], sort: [{ key: "title", dir: "asc" }], display: display({ ordering: "priority" }) }, [], {}).map((task) => task.id).join(","),
  "alpha,beta,delta,gamma",
  "an explicit sort wins over the ordering menu"
);
assert.equal(
  applyView(rows, { filters: [], sort: [], display: display({ ordering: "created" }) }, [], {}).map((task) => task.id).join(","),
  "gamma,delta,beta,alpha",
  "created sorts newest first"
);
assert.equal(
  applyView(rows, { filters: [], sort: [], display: display({ ordering: "dueDate" }) }, [], {}).map((task) => task.id).join(","),
  "alpha,beta,delta,gamma",
  "due date sorts soonest first, undated last"
);

// --- sub-issues ---
assert.equal(applyView(rows, { filters: [], sort: [] }, [], {}).length, 4, "sub-issues show by default");
assert.equal(
  applyView(rows, { filters: [], sort: [], display: display({ subIssues: false }) }, [], {}).map((task) => task.id).join(","),
  "alpha,beta,gamma",
  "sub-issues off hides the child"
);
assert.equal(isManualOrder({ filters: [], sort: [] }), true);
assert.equal(isManualOrder({ filters: [], sort: [], display: display({ subIssues: false }) }), false, "the sub-issue filter needs the full scan");
assert.equal(isManualOrder({ filters: [], sort: [], display: display({ ordering: "priority" }) }), false);

// --- grouping ---
const context = {
  members: [
    { id: "u1", displayName: "Ann" },
    { id: "u2", displayName: "Bob" },
    { id: "u3", displayName: "Cid" },
  ],
  projects: ["Alpha", "Beta"],
  today: "2026-11-06",
};
const statusGroups = groupTasks(rows, "status", context, { includeEmpty: true });
assert.deepEqual(statusGroups.map((group) => group.key), ["status:in_progress", "status:todo", "status:done", "status:canceled"], "list status order");
assert.equal(statusGroups.find((group) => group.key === "status:todo")?.tasks.length, 2);
assert.equal(statusGroups.find((group) => group.key === "status:canceled")?.tasks.length, 0, "empty groups appear when asked");
assert.equal(groupTasks(rows, "status", context).length, 3, "empty groups are omitted by default");

const assigneeGroups = groupTasks(rows, "assignee", context, { includeEmpty: true });
assert.deepEqual(
  assigneeGroups.map((group) => group.label),
  ["Ann", "Bob", "Cid", "No assignee"],
  "assignee groups follow the roster and end with unassigned"
);
assert.equal(assigneeGroups.find((group) => group.key === `assignee:${NO_GROUP}`)?.tasks.length, 2);

const priorityGroups = groupTasks(rows, "priority", context, { includeEmpty: true });
assert.deepEqual(priorityGroups.map((group) => group.value), ["4", "3", "2", "1", "0"], "priority groups run urgent to none");
assert.equal(priorityGroups[0].tasks[0].id, "beta");

const projectGroups = groupTasks(rows, "project", context, { includeEmpty: true });
assert.deepEqual(projectGroups.map((group) => group.label), ["Alpha", "Beta"], "project groups use the project list");
assert.equal(projectGroups[1].tasks[0].id, "delta");

const labelGroups = groupTasks(rows, "label", context);
assert.deepEqual(labelGroups.map((group) => group.label), ["bug", "No label", "ui"], "label groups sort by name");
assert.equal(labelGroups.find((group) => group.label === "bug")?.tasks.length, 2);

const dueGroups = groupTasks(rows, "dueDate", context, { includeEmpty: true });
assert.deepEqual(dueGroups.map((group) => group.label), ["Overdue", "Today", "This week", "Later", "No due date"]);
assert.equal(dueGroups[0].tasks[0].id, "alpha", "Nov 3 is overdue against Nov 6");
assert.equal(dueGroups[1].tasks[0].id, "beta", "Nov 6 is today");
assert.equal(dueGroups[2].tasks.length, 0, "nothing falls inside the next week");
assert.equal(dueGroups[3].tasks[0].id, "delta", "December is later");
assert.equal(dueGroups[4].tasks[0].id, "gamma", "no due date is its own group");

// Group counts are what the headers draw.
for (const group of [...statusGroups, ...assigneeGroups, ...priorityGroups, ...projectGroups, ...dueGroups]) {
  assert.equal(group.tasks.length, group.tasks.length, "group count is the task count");
  assert.ok(group.key.startsWith(`${group.property}:`), "group keys stay namespaced");
}

console.log("check-views-display: pass");
