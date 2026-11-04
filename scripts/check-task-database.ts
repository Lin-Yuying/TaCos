/**
 * Task database (docs/plans/team-2.2.md item 10): custom fields, value checks, filter and sort.
 *   npx tsx scripts/check-task-database.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-task-db-"));

async function status(call: () => Promise<unknown>): Promise<number> {
  try {
    await call();
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

async function main() {
  const { applyView, fieldKey, normalizeFieldValue, EMPTY_VIEW } = await import("../src/lib/task-view");
  type Task = Parameters<typeof applyView>[0][number];
  const task = (id: string, over: Partial<Task> = {}): Task => ({
    id,
    title: id,
    status: "todo",
    priority: 0,
    dueDate: null,
    projectName: "P",
    assignees: [],
    ...over,
  });
  const sel = { id: "sel", name: "Stage", type: "select" as const, options: ["alpha", "beta"], createdBy: "u" };
  const num = { id: "num", name: "Points", type: "number" as const, options: [], createdBy: "u" };
  const date = { id: "date", name: "Launch", type: "date" as const, options: [], createdBy: "u" };
  const check = { id: "chk", name: "Ready", type: "checkbox" as const, options: [], createdBy: "u" };
  const fields = [sel, num, date, check];
  const tasks = [
    task("a", { status: "done", priority: 4, dueDate: "2026-11-10", assignees: [{ id: "u1" }] }),
    task("b", { status: "todo", priority: 1, dueDate: "2026-11-01", assignees: [{ id: "u1" }, { id: "u2" }] }),
    task("c", { status: "in_progress", priority: 0, title: "Design 周报" }),
  ];
  const values = {
    a: { sel: "alpha", num: "10", date: "2026-12-01", chk: "1" },
    b: { sel: "beta", num: "9" },
  };
  const ids = (view: Parameters<typeof applyView>[1]) => applyView(tasks, view, fields, values).map((t) => t.id).join("");
  const filter = (key: string, op: never | string, value?: string) => ids({ filters: [{ key, op: op as never, value }], sort: [] });
  const sort = (key: string, dir: "asc" | "desc") => ids({ filters: [], sort: [{ key, dir }] });

  assert(ids(EMPTY_VIEW) === "abc", "an empty view changes nothing");
  // Built-in columns.
  assert(filter("status", "is", "done") === "a", "status is");
  assert(filter("status", "is_not", "done") === "bc", "status is not");
  assert(filter("title", "contains", "周报") === "c", "title contains Chinese");
  assert(filter("title", "contains", "DESIGN") === "c", "contains ignores case");
  assert(filter("assignee", "is", "u2") === "b", "one of several assignees");
  assert(filter("assignee", "is_not", "u1") === "c", "is not, with several assignees");
  assert(filter("assignee", "empty") === "c", "no assignee");
  assert(filter("dueDate", "not_empty") === "ab", "has a due date");
  assert(filter("dueDate", "lt", "2026-11-05") === "b", "earlier than");
  assert(filter("priority", "gt", "1") === "a", "priority above");
  // Custom fields.
  assert(filter(fieldKey("sel"), "is", "beta") === "b", "select is");
  assert(filter(fieldKey("num"), "gt", "9.5") === "a", "numbers compare as numbers");
  assert(filter(fieldKey("date"), "gt", "2026-11-30") === "a", "dates compare");
  assert(filter(fieldKey("chk"), "is", "1") === "a", "checked");
  assert(filter(fieldKey("chk"), "empty") === "bc", "unchecked");
  // An unfinished filter and one on a deleted field do nothing.
  assert(filter("status", "is", "") === "abc", "a filter with no value yet applies nothing");
  assert(filter(fieldKey("gone"), "is", "x") === "abc", "a deleted field's filter applies nothing");
  // All filters must hold.
  assert(ids({ filters: [{ key: "status", op: "is_not", value: "done" }, { key: "dueDate", op: "not_empty" }], sort: [] }) === "b", "filters combine");
  // Sort.
  assert(sort("priority", "desc") === "abc", "priority high first, with none last");
  assert(sort("priority", "asc") === "bac", "priority low first, with none still last");
  assert(sort("dueDate", "asc") === "bac", "due date, with none last");
  assert(sort("dueDate", "desc") === "abc", "due date descending, with none still last");
  assert(sort(fieldKey("num"), "asc") === "bac", "numbers sort as numbers: 9 before 10");
  assert(sort("status", "asc").length === 3, "status sorts");
  assert(ids({ filters: [], sort: [{ key: fieldKey("chk"), dir: "asc" }, { key: "priority", dir: "asc" }] }) === "abc", "second sort breaks ties");
  // The input is left alone.
  assert(tasks.map((t) => t.id).join("") === "abc", "sorting does not reorder the source");

  // Values.
  assert(normalizeFieldValue(num, " 1.50 ") === "1.5", "number is normalized");
  assert(normalizeFieldValue(num, "") === null, "blank clears");
  assert(normalizeFieldValue(check, "0") === null, "unchecked clears");
  const refused = (field: never | object, raw: string) => {
    try {
      normalizeFieldValue(field as never, raw);
      return false;
    } catch {
      return true;
    }
  };
  assert(refused(num, "abc"), "not a number");
  assert(refused(sel, "gamma"), "not an option");
  assert(refused(date, "next week"), "not a date");

  // Stored fields and values.
  const { getDb } = await import("../src/db/client");
  const { workspaces, workspaceMembers, users, projects, issues, events } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const lib = await import("../src/lib/task-fields");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w1";
  await db.insert(workspaces).values({ id: ws, name: "W", key: "TW", createdBy: "owner", membersSeeAllTasks: 0, createdAt: at } as never);
  for (const [id, role] of [["owner", "admin"], ["member", "member"]]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: at } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: id, role, createdAt: at } as never);
  }
  await db.insert(projects).values({ id: "p1", workspaceId: ws, key: "P1", name: "p1", createdBy: "owner", createdAt: at, updatedAt: at } as never);
  await db.insert(issues).values({ id: "i1", workspaceId: ws, projectId: "p1", number: 1, identifier: "P1-1", title: "T", createdAt: at, updatedAt: at } as never);

  const stage = await lib.createTaskField(ws, "member", { name: "Stage", type: "select", options: ["a", " a", "b", ""] });
  assert(stage.options.join() === "a,b", "options are cleaned");
  assert((await status(() => lib.createTaskField(ws, "member", { name: "stage", type: "text" }))) === 409, "name is unique");
  assert((await status(() => lib.createTaskField(ws, "member", { name: "x", type: "select" }))) === 400, "select needs options");
  assert((await status(() => lib.createTaskField(ws, "member", { name: "x", type: "formula" }))) === 400, "unknown type");
  const actor = { kind: "human", userId: "owner" } as never;
  assert((await status(() => lib.setTaskFieldValue(ws, "i1", stage.id, "a", "member", actor))) === 404, "a task out of sight cannot be set");
  assert((await lib.setTaskFieldValue(ws, "i1", stage.id, "a", "owner", actor)) === "a", "set");
  assert((await lib.listFieldValues(["i1"])).i1[stage.id] === "a", "read back");
  assert((await status(() => lib.setTaskFieldValue(ws, "i1", stage.id, "zzz", "owner", actor))) === 400, "stored values are checked");
  await lib.setTaskFieldValue(ws, "i1", stage.id, "b", "owner", actor);
  await lib.setTaskFieldValue(ws, "i1", stage.id, "b", "owner", actor);
  const logged = (await db.select().from(events).where(eq(events.issueId, "i1"))).filter((e) => e.type === "field_changed");
  assert(logged.length === 2, `a real change is logged once: ${logged.length}`);
  await lib.setTaskFieldValue(ws, "i1", stage.id, null, "owner", actor);
  assert(!(await lib.listFieldValues(["i1"])).i1, "clear removes the value");
  const other = await lib.createTaskField(ws, "owner", { name: "Other", type: "text" });
  assert((await status(() => lib.deleteTaskField(ws, "member", other.id))) === 403, "a member cannot delete another's field");
  await lib.setTaskFieldValue(ws, "i1", other.id, "x", "owner", actor);
  await lib.deleteTaskField(ws, "owner", other.id);
  assert(!(await lib.listFieldValues(["i1"])).i1, "deleting a field removes its values");
  await lib.deleteTaskField(ws, "owner", stage.id);
  assert((await lib.listTaskFields(ws)).length === 0, "an admin can delete a member's field");

  // Purging a task removes its values too.
  const { purgeIssue } = await import("../src/lib/issues");
  const kept = await lib.createTaskField(ws, "owner", { name: "Kept", type: "text" });
  await lib.setTaskFieldValue(ws, "i1", kept.id, "x", "owner", actor);
  await purgeIssue(ws, "i1");
  assert(!(await lib.listFieldValues(["i1"])).i1, "purging a task removes its values");

  console.log("check-task-database: ok");
}

void main();
