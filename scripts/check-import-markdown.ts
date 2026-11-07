/**
 * U-05 Markdown import: a Notion-style folder (Markdown pages, nested pages, a database
 * CSV, a relative image and an unlinked file) previews with counts/conflicts/unmapped
 * fields, imports into a new hidden-then-visible workspace, rewrites relative links,
 * is idempotent, honours the attachment opt-out/cap, and rolls back on failure.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-import-markdown-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb, hashPassword } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const { ZipWriter } = await import("../src/lib/transfer/zip");
  const { buildImportPlan } = await import("../src/lib/import/plan");
  const { applyImportPlan, rollbackImportedWorkspace } = await import("../src/lib/import/apply");
  const jobs = await import("../src/lib/transfer/jobs");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Olive Owner", passwordHash: hashPassword("x"), role: "admin", createdAt: now },
      { id: "alex", username: "alex", displayName: "Alex Chen", passwordHash: hashPassword("x"), role: "member", createdAt: now },
    ])
    .run();
  const target = await issues.createWorkspace({ name: "Current team", key: "CUR", adminUserId: "owner" });
  const before = {
    issues: (await db.select().from(schema.issues)).length,
    pages: (await db.select().from(schema.pages)).length,
  };

  const zipPath = path.join(root, "notion.zip");
  const writer = new ZipWriter(zipPath);
  const image = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  await writer.addBuffer(
    "Export-1234abcd/Project Plan 1234abcd.md",
    "# Project Plan\n\nIntro\n\n![diagram](Project%20Plan%201234abcd/assets/diagram.png)\n"
  );
  await writer.addBuffer("Export-1234abcd/Project Plan 1234abcd/Child Page 5678.md", "# Child Page\n\nChild body\n");
  await writer.addBuffer("Export-1234abcd/Project Plan 1234abcd/assets/diagram.png", image, { store: true });
  await writer.addBuffer(
    "Export-1234abcd/Tasks 1234abcd.csv",
    [
      "Name,Status,Priority,Assignee,Due date,Labels,Custom field",
      '"First task",In progress,High,Alex Chen,2026-12-01,"Bug; Feature",foo',
      '"Second task",Done,Urgent,Unknown Person,,,"a, b"',
      '"First task",Todo,Low,,,,',
      ",Todo,,,,,",
      "",
    ].join("\n")
  );
  await writer.addBuffer("Export-1234abcd/Other file.txt", "unlinked");
  await writer.finish();

  const options = { workspaceName: "Imported Notion" };
  const plan = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "notion.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "markdown-source",
    options,
    actorId: "owner",
  });
  assert.equal(plan.kind, "markdown");
  assert.equal(plan.counts.projects, 1);
  assert.equal(plan.counts.tasks, 2);
  assert.equal(plan.counts.documents, 2, "the page with a child is one document");
  assert.equal(plan.counts.attachments, 1);
  assert.equal(plan.counts.labels, 2);
  assert.equal(plan.counts.members, 1, "the matched CSV assignee is a member");
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("Duplicate CSV rows")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("without a title")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("not on this server")));
  assert.ok(plan.conflicts.some((conflict) => conflict.message.includes("neither Markdown")));
  assert.ok(plan.unmapped.some((field) => field.field === "Custom field" && field.count === 4));
  assert.deepEqual(plan.warnings, []);
  const first = plan.issues.find((issue) => issue.title === "First task");
  assert.equal(first?.status, "in_progress");
  assert.equal(first?.priority, 3);
  assert.equal(first?.dueDate, "2026-12-01");
  assert.deepEqual(first?.assignees, ["alex"]);
  assert.deepEqual(first?.labels.sort(), ["Bug", "Feature"]);

  let hiddenAtCreation = false;
  const applied = await applyImportPlan({
    plan,
    sourcePath: zipPath,
    actor: { id: "owner", username: "owner", displayName: "Olive Owner" },
    onWorkspaceCreated: async (workspaceId) => {
      hiddenAtCreation = true;
      const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      assert.ok(row.deletedAt, "the workspace is hidden while the import runs");
    },
  });
  assert.ok(hiddenAtCreation);
  assert.equal(applied.counts.tasks, plan.counts.tasks);
  assert.equal(applied.counts.documents, plan.counts.documents);
  assert.equal(applied.counts.attachments, plan.counts.attachments);
  assert.equal(applied.counts.projects, plan.counts.projects);
  assert.equal(applied.counts.labels, plan.counts.labels);
  assert.deepEqual(applied.warnings, []);

  const [importedWorkspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, applied.workspaceId));
  assert.equal(importedWorkspace.deletedAt, null, "the workspace is visible after success");
  assert.equal(importedWorkspace.name, "Imported Notion");

  const importedPages = await db.select().from(schema.pages).where(eq(schema.pages.workspaceId, applied.workspaceId));
  assert.equal(importedPages.length, 2);
  const planPage = importedPages.find((page) => page.title === "Project Plan");
  const childPage = importedPages.find((page) => page.title === "Child Page");
  assert.ok(planPage && childPage);
  assert.equal(childPage.parentId, planPage.id);
  assert.ok(planPage.doc.includes("Intro"));
  assert.ok(planPage.doc.includes("![diagram](/api/files/"), "the relative image link now points at the copied file");
  assert.equal(planPage.shared, 1, "imported Markdown documents are shared");
  const importedTasks = await db.select().from(schema.issues).where(eq(schema.issues.workspaceId, applied.workspaceId));
  assert.equal(importedTasks.length, 2);
  const importedFirst = importedTasks.find((task) => task.title === "First task");
  const importedSecond = importedTasks.find((task) => task.title === "Second task");
  assert.ok(importedFirst && importedSecond);
  assert.equal(importedFirst.status, "in_progress");
  assert.equal(importedFirst.priority, 3);
  assert.equal(importedFirst.dueDate, "2026-12-01");
  assert.equal(importedSecond.status, "done");
  assert.equal(importedSecond.priority, 4);
  const assignees = await db.select().from(schema.issueAssignees).where(eq(schema.issueAssignees.issueId, importedFirst.id));
  assert.deepEqual(assignees.map((row) => row.userId), ["alex"], "the CSV assignee is assigned to the matched account");
  const importedAttachments = await db.select().from(schema.attachments).where(eq(schema.attachments.workspaceId, applied.workspaceId));
  assert.equal(importedAttachments.length, 1);
  assert.equal(importedAttachments[0].pageId, planPage.id);
  assert.deepEqual(fs.readFileSync(path.join((await import("../src/lib/attachments")).UPLOAD_DIR, importedAttachments[0].id)), image);
  const members = await db.select().from(schema.workspaceMembers).where(eq(schema.workspaceMembers.workspaceId, applied.workspaceId));
  assert.deepEqual(members.map((row) => row.userId).sort(), ["alex", "owner"]);

  // The current workspace was untouched: import only creates a new one.
  assert.equal((await db.select().from(schema.issues)).length, before.issues + 2);
  assert.equal((await db.select().from(schema.pages)).length, before.pages + 2);
  const current = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, target.id));
  assert.equal(current[0].deletedAt, null);

  // Idempotent rerun of the same source and options.
  const job = await jobs.createTransferJob({
    kind: "import",
    workspaceId: applied.workspaceId,
    createdBy: "owner",
    fingerprint: plan.fingerprint,
  });
  await jobs.updateTransferJob(
    job.id,
    { status: "done", progress: 100, targetWorkspaceId: applied.workspaceId, finishedAt: new Date().toISOString() },
    { force: true }
  );
  const rerun = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "notion.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "markdown-source",
    options,
    actorId: "owner",
  });
  assert.equal(rerun.duplicateWorkspaceId, applied.workspaceId);
  assert.equal((await db.select().from(schema.workspaces)).length, 2, "the rerun creates no workspace");

  // Opt-out and cap both keep working.
  const without = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "notion.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "markdown-source",
    options: { ...options, includeAttachments: false },
    actorId: "owner",
  });
  assert.equal(without.counts.attachments, 0);
  assert.ok(without.warnings.some((warning) => warning.toLowerCase().includes("attachments are off")));
  const tinyCap = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "notion.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "markdown-source",
    options: { ...options, attachmentCapBytes: 8 },
    actorId: "owner",
  });
  assert.equal(tinyCap.counts.attachments, 0);
  assert.ok(tinyCap.warnings.some((warning) => warning.includes("size cap")));

  // A failure after the workspace exists removes it and everything the import wrote.
  const doomed = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "notion.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: "markdown-doomed",
    options: { workspaceName: "Doomed import" },
    actorId: "owner",
  });
  db.$client.exec("CREATE TRIGGER fail_import_issues BEFORE INSERT ON issues BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
  try {
    await assert.rejects(
      () =>
        applyImportPlan({
          plan: doomed,
          sourcePath: zipPath,
          actor: { id: "owner", username: "owner", displayName: "Olive Owner" },
        }),
      /could not be imported/
    );
  } finally {
    db.$client.exec("DROP TRIGGER IF EXISTS fail_import_issues");
  }
  const doomedWorkspace = await db.select().from(schema.workspaces).where(eq(schema.workspaces.name, "Doomed import"));
  assert.equal(doomedWorkspace.length, 0, "the failed import leaves no workspace row");
  assert.equal(
    (await db.select().from(schema.issues)).length,
    before.issues + 2,
    "the failed import leaves no task rows"
  );
  assert.equal(
    (await db.select().from(schema.pages)).length,
    before.pages + 2,
    "the failed import leaves no document rows"
  );

  // rollbackImportedWorkspace is idempotent after the purge.
  await rollbackImportedWorkspace(applied.workspaceId);
  assert.equal((await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, applied.workspaceId))).length, 0);

  console.log(
    "check-import-markdown: pass (Notion folder preview counts/conflicts/unmapped, nested pages, CSV tasks, relative image, hidden-then-visible workspace, idempotent rerun, attachment opt-out/cap, rollback)"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
