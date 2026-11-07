/**
 * U-05 task CSV import: quoted commas/newlines, alternate delimiters, header mapping,
 * unmapped columns, duplicate rows, parent references, unknown values and applying the
 * exact preview counts into a new workspace.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-import-csv-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb, hashPassword } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const { buildImportPlan } = await import("../src/lib/import/plan");
  const { applyImportPlan } = await import("../src/lib/import/apply");
  const { buildImportZip } = await import("../src/lib/import/source");
  const { parseCsv, mapCsvHeaders } = await import("../src/lib/import/csv");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Olive Owner", passwordHash: hashPassword("x"), role: "admin", createdAt: now },
      { id: "alex", username: "alex", displayName: "Alex Chen", passwordHash: hashPassword("x"), role: "member", createdAt: now },
    ])
    .run();
  await issues.createWorkspace({ name: "Current", key: "CUR", adminUserId: "owner" });

  // Parser-level: quoted newline, escaped quotes and a semicolon delimiter.
  const quoted = parseCsv('Title,Description\n"One","line 1\nline 2"\n"Two","a ""quote"""\n');
  assert.deepEqual(quoted.headers, ["Title", "Description"]);
  assert.equal(quoted.rows[0][1], "line 1\nline 2");
  assert.equal(quoted.rows[1][1], 'a "quote"');
  const semicolon = parseCsv("Name;Status\nOne;Todo\n");
  assert.equal(semicolon.delimiter, ";");
  assert.equal(semicolon.rows[0][1], "Todo");
  const mapping = mapCsvHeaders(["Name", "Team", "Mystery", "Name"]);
  assert.equal(mapping.columns.title, 0);
  assert.equal(mapping.columns.project, 1);
  assert.deepEqual(mapping.unmapped, ["Mystery"]);
  assert.deepEqual(mapping.duplicated, ["Name"]);

  const csv = [
    "Identifier,Title,Description,Status,Priority,Project,Assignees,Labels,Due date,Estimate,Parent,Recurrence,Custom field",
    'T-1,"Parent, with comma","Line one\nLine two",In progress,High,Launch,Alex Chen,"Bug; Feature",2026-12-01,5,,monthly,keep me',
    'T-2,Child task,Child body,Done,Urgent,Launch,Alex Chen,Bug,not-a-date,2,T-1,fortnightly,ignore me',
    'T-3,No project task,Body,Waiting,Someday,,Unknown Person,,2026-13-01,x,,,',
    'T-2,Child task,Duplicate row,Done,,Launch,,,,,,,',
    "T-4,,Body,Todo,,Launch,,,,,,,"
  ].join("\n");
  const zipPath = path.join(root, "tasks.zip");
  await buildImportZip(zipPath, [{ name: "tasks.csv", data: Buffer.from(csv, "utf8") }]);

  const plan = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "tasks.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "csv-source",
    options: { workspaceName: "Imported tasks" },
    actorId: "owner",
  });
  assert.equal(plan.kind, "csv");
  assert.equal(plan.counts.tasks, 3, "duplicate and missing-title rows are skipped");
  assert.equal(plan.counts.projects, 2, "the project column plus the default project");
  assert.deepEqual(plan.projects.map((project) => project.name).sort(), ["Imported tasks", "Launch"]);
  assert.ok(plan.unmapped.some((field) => field.field === "Custom field" && field.count === 5));
  assert.ok(plan.unmapped.some((field) => field.field === "status"));
  assert.ok(plan.unmapped.some((field) => field.field === "priority"));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("Duplicate CSV rows")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("without a title")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("not on this server")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("not YYYY-MM-DD")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("Unknown recurrence")));
  const parent = plan.issues.find((issue) => issue.title === "Parent, with comma");
  const child = plan.issues.find((issue) => issue.title === "Child task");
  const orphan = plan.issues.find((issue) => issue.title === "No project task");
  assert.ok(parent && child && orphan);
  assert.equal(parent.description, "Line one\nLine two");
  assert.equal(parent.status, "in_progress");
  assert.equal(parent.priority, 3);
  assert.equal(parent.estimate, 5);
  assert.equal(parent.recurrence, "monthly");
  assert.equal(parent.dueDate, "2026-12-01");
  assert.equal(child.parentExternalId, parent.externalId, "the parent identifier resolves");
  assert.equal(child.status, "done");
  assert.equal(child.priority, 4);
  assert.equal(child.dueDate, null, "an invalid date is ignored");
  assert.equal(child.recurrence, null, "an unknown recurrence is ignored");
  assert.equal(orphan.status, "todo", "unknown status falls back to Todo");
  assert.equal(orphan.priority, 0);
  assert.equal(orphan.projectExternalId, "csv-project:imported tasks");
  assert.deepEqual(parent.assignees, ["alex"]);
  assert.deepEqual(parent.labels.sort(), ["Bug", "Feature"]);

  const applied = await applyImportPlan({
    plan,
    sourcePath: zipPath,
    actor: { id: "owner", username: "owner", displayName: "Olive Owner" },
  });
  assert.equal(applied.counts.tasks, plan.counts.tasks);
  assert.equal(applied.counts.projects, plan.counts.projects);

  const importedProjects = await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, applied.workspaceId));
  assert.deepEqual(importedProjects.map((project) => project.name).sort(), ["Imported tasks", "Launch"]);
  const importedTasks = await db.select().from(schema.issues).where(eq(schema.issues.workspaceId, applied.workspaceId));
  assert.equal(importedTasks.length, 3);
  const importedParent = importedTasks.find((task) => task.title === "Parent, with comma");
  const importedChild = importedTasks.find((task) => task.title === "Child task");
  const importedOrphan = importedTasks.find((task) => task.title === "No project task");
  assert.ok(importedParent && importedChild && importedOrphan);
  assert.equal(importedParent.description, "Line one\nLine two");
  assert.equal(importedChild.parentId, importedParent.id);
  const assignees = await db.select().from(schema.issueAssignees).where(eq(schema.issueAssignees.issueId, importedParent.id));
  assert.deepEqual(assignees.map((row) => row.userId), ["alex"]);
  const labels = await db
    .select({ name: schema.labels.name })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(eq(schema.issueLabels.issueId, importedParent.id));
  assert.deepEqual(labels.map((row) => row.name).sort(), ["Bug", "Feature"]);
  const targetWorkspace = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, applied.workspaceId));
  assert.equal(targetWorkspace[0].deletedAt, null);

  // A second CSV with a semicolon separator and a different header vocabulary maps too.
  const secondZip = path.join(root, "second.zip");
  await buildImportZip(secondZip, [
    {
      name: "sheet.csv",
      data: Buffer.from("Summary;State;Owner\nSemicolon task;Started;Alex Chen\n", "utf8"),
    },
  ]);
  const secondPlan = await buildImportPlan({
    sourcePath: secondZip,
    fileName: "second.zip",
    bytes: fs.statSync(secondZip).size,
    fingerprint: "csv-source-2",
    options: { workspaceName: "Semicolon import" },
    actorId: "owner",
  });
  assert.equal(secondPlan.counts.tasks, 1);
  assert.equal(secondPlan.issues[0].title, "Semicolon task");
  assert.equal(secondPlan.issues[0].status, "in_progress");
  assert.deepEqual(secondPlan.issues[0].assignees, ["alex"]);

  console.log(
    "check-import-csv: pass (quoted/newline cells, semicolon delimiter, header aliases, unmapped columns, duplicates, parent identifiers, unknown status/priority/date/recurrence, preview=applied)"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
