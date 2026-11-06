/**
 * Quick-filter views as saved filters: "Active" (todo + in_progress) and
 * "Source = agent" (created through the API or MCP) must work in applyView, so the
 * three removed sidebar rows can be re-saved as personal views.
 */
import { applyView, type TaskView, type ViewTask } from "../src/lib/task-view";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function task(id: string, status: string, createdVia?: string): ViewTask {
  return { id, title: id, status, priority: 0, dueDate: null, projectName: "P", assignees: [], createdVia };
}

const tasks = [
  task("a", "todo", "web"),
  task("b", "in_progress", "api"),
  task("c", "done", "mcp"),
  task("d", "canceled", "web"),
];

function view(key: string, op: "is" | "is_not" | "empty", value = ""): TaskView {
  return { filters: [{ key, op, value }], sort: [] };
}

function ids(filterView: TaskView): string[] {
  return applyView(tasks, filterView, [], {}).map((item) => item.id);
}

assert(JSON.stringify(ids(view("status", "is", "active"))) === JSON.stringify(["a", "b"]), "Active matches todo + in_progress");
assert(JSON.stringify(ids(view("status", "is_not", "active"))) === JSON.stringify(["c", "d"]), "is not Active matches the rest");
assert(JSON.stringify(ids(view("source", "is", "agent"))) === JSON.stringify(["b", "c"]), "Source agent matches api + mcp");
assert(JSON.stringify(ids(view("source", "is", "person"))) === JSON.stringify(["a", "d"]), "Source person matches web");
assert(JSON.stringify(ids(view("assignee", "empty"))) === JSON.stringify(["a", "b", "c", "d"]), "assignee empty still means Unassigned");

console.log("check-task-view-filters: pass");
