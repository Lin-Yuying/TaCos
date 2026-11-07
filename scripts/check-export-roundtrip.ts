/**
 * U-05 round trip: seed a workspace, export the canonical ZIP, import it into a new
 * workspace and compare entities, relationships, documents and attachment bytes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-export-roundtrip-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb, hashPassword } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const pagesLib = await import("../src/lib/pages");
  const pageCommentsLib = await import("../src/lib/page-comments");
  const taskFieldsLib = await import("../src/lib/task-fields");
  const { UPLOAD_DIR } = await import("../src/lib/attachments");
  const { writeWorkspaceExport } = await import("../src/lib/export/workspace");
  const { buildImportPlan } = await import("../src/lib/import/plan");
  const { applyImportPlan } = await import("../src/lib/import/apply");
  const jobs = await import("../src/lib/transfer/jobs");
  const { ZipReader } = await import("../src/lib/transfer/zip");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Olive Owner", passwordHash: hashPassword("password123"), role: "admin", createdAt: now },
      { id: "member", username: "member", displayName: "Mia Member", passwordHash: hashPassword("member-pass"), role: "member", createdAt: now },
    ])
    .run();
  const workspace = await issues.createWorkspace({ name: "Roundtrip", key: "RT", adminUserId: "owner" });
  db.insert(schema.workspaceMembers)
    .values({ workspaceId: workspace.id, userId: "member", role: "member", createdAt: now })
    .run();
  await db
    .update(schema.workspaces)
    .set({ icon: "data:image/png;base64,AAAA" })
    .where(eq(schema.workspaces.id, workspace.id));
  const owner = { kind: "user" as const, userId: "owner", displayName: "Olive Owner" };
  const member = { kind: "user" as const, userId: "member", displayName: "Mia Member" };

  const project = await issues.createProject({
    workspaceId: workspace.id,
    name: "Core",
    description: "Core work",
    createdBy: "owner",
  });
  await db.update(schema.projects).set({ doc: "# Overview\n\nProject notes." }).where(eq(schema.projects.id, project.id));
  const label = await issues.createLabel(workspace.id, { name: "Bug", color: "#eb5757" });
  const field = await taskFieldsLib.createTaskField(workspace.id, "owner", {
    name: "Effort",
    type: "select",
    options: ["Small", "Large"],
  });
  const parent = await issues.createIssue(
    workspace.id,
    {
      title: "First parent",
      description: "Body with **bold** and @member",
      project: project.key,
      status: "in_progress",
      priority: 3,
      assigneeIds: ["member"],
      labelNames: ["Bug"],
      dueDate: "2026-12-01",
      estimate: 3,
      fieldValues: { [field.id]: "Large" },
    },
    owner
  );
  const child = await issues.createIssue(
    workspace.id,
    { title: "Child task", project: project.key, parent: parent.issue.identifier, status: "todo" },
    owner
  );
  await issues.addDependency(workspace.id, parent.issue.identifier, child.issue.identifier, "owner", owner);
  const afterTop = await issues.addComment(workspace.id, parent.issue.identifier, "Top-level comment", member);
  const topComment = afterTop.comments.find((comment) => comment.body === "Top-level comment");
  assert.ok(topComment, "the top-level comment exists");
  const detail = await issues.addComment(workspace.id, parent.issue.identifier, "A reply", owner, {
    parentId: topComment.id,
  });
  const reply = detail.comments.find((comment) => comment.body === "A reply");
  assert.ok(reply, "the reply exists");

  const mainPage = await pagesLib.createPage(workspace.id, "owner", {
    title: "Handbook",
    doc: "## Section\n\nHello **world**\n\n![](https://example.com/x.png)\n",
  });
  await db.update(schema.pages).set({ shared: 1 }).where(eq(schema.pages.id, mainPage.id));
  db.insert(schema.projectMembers).values({ projectId: project.id, userId: "member", createdAt: now }).run();
  db.insert(schema.pageAccess).values({ pageId: mainPage.id, userId: "member", level: "view" }).run();
  const childPage = await pagesLib.createPage(workspace.id, "owner", { parentId: mainPage.id, title: "Onboarding", doc: "Start here." });
  await pageCommentsLib.addPageComment(workspace.id, mainPage.id, "owner", { body: "Page comment" });

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const attachmentId = "roundtrip-attachment";
  const bytes = Buffer.from("roundtrip attachment bytes");
  fs.writeFileSync(path.join(UPLOAD_DIR, attachmentId), bytes);
  db.insert(schema.attachments)
    .values({
      id: attachmentId,
      workspaceId: workspace.id,
      pageId: mainPage.id,
      uploaderId: "owner",
      name: "notes.txt",
      size: bytes.length,
      complete: 1,
      createdAt: now,
    })
    .run();
  await db.update(schema.pages).set({ cover: attachmentId }).where(eq(schema.pages.id, mainPage.id));

  // Narrow visibility only after seeding; a member outside the project could not
  // comment on the task otherwise.
  await db
    .update(schema.workspaces)
    .set({ membersSeeAllTasks: 0 })
    .where(eq(schema.workspaces.id, workspace.id));

  const zipPath = path.join(root, "roundtrip.zip");
  const exported = await writeWorkspaceExport(workspace.id, zipPath, { includeAttachments: true });
  assert.equal(exported.counts.tasks, 2);
  assert.equal(exported.counts.documents, 2);
  assert.equal(exported.counts.comments, 2);
  assert.equal(exported.counts.pageComments, 1);
  assert.equal(exported.counts.attachments, 1);
  assert.equal(exported.counts.apiKeys, 0);

  const reader = await ZipReader.open(zipPath);
  const files = new Set(reader.list().filter((entry) => !entry.directory).map((entry) => entry.name));
  for (const name of ["workspace.json", "manifest.json", "tasks.csv", "docs/Handbook.md", "docs/Handbook/Onboarding.md", "attachments/manifest.json"]) {
    assert.ok(files.has(name), `${name} is in the archive`);
  }
  assert.ok([...files].some((name) => name.startsWith("attachments/roundtrip-attachment/")), "the attachment file is in the archive");
  const manifest = JSON.parse((await reader.read(reader.list().find((entry) => entry.name === "manifest.json")!)).toString("utf8")) as {
    schemaVersion: number;
    counts: { tasks: number; documents: number; attachments: number };
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.counts.tasks, 2);
  assert.equal(manifest.counts.documents, 2);
  const exportedJson = JSON.parse((await reader.read(reader.list().find((entry) => entry.name === "workspace.json")!)).toString("utf8")) as {
    workspace: { membersSeeAllTasks: boolean };
    issues: Array<{ title: string; blockedBy: string[]; parentId: string | null; labels: string[]; fieldValues: Record<string, string> }>;
    projects: Array<{ name: string; members: Array<{ username: string }> }>;
    pages: Array<{ title: string; shared: boolean; access: Array<{ username: string; level: string }> }>;
    comments: Array<{ body: string; parentId: string | null }>;
  };
  assert.equal(exportedJson.workspace.membersSeeAllTasks, false);
  const exportedParent = exportedJson.issues.find((issue) => issue.title === "First parent");
  const exportedChild = exportedJson.issues.find((issue) => issue.title === "Child task");
  assert.deepEqual(exportedParent?.labels, ["Bug"]);
  assert.deepEqual(exportedParent?.fieldValues, { Effort: "Large" });
  assert.deepEqual(exportedChild?.blockedBy, []);
  assert.equal(exportedParent?.blockedBy.length, 1, "the dependency points at the child");
  assert.ok(exportedJson.comments.some((comment) => comment.body === "A reply" && comment.parentId));
  assert.ok(exportedJson.pages.some((page) => page.title === "Handbook" && page.shared));
  assert.deepEqual(exportedJson.projects[0]?.members, [{ username: "member", createdAt: now }], "project membership is exported");
  assert.ok(
    exportedJson.pages.some((page) => page.title === "Handbook" && page.access.some((entry) => entry.username === "member" && entry.level === "view")),
    "page access overrides are exported"
  );
  await reader.close();

  const sourceFingerprint = "roundtrip-source-hash";
  const plan = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "roundtrip.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: sourceFingerprint,
    options: { workspaceName: "Roundtrip copy" },
    actorId: "owner",
  });
  assert.equal(plan.conflicts.length, 0, `no conflicts: ${JSON.stringify(plan.conflicts)}`);
  assert.equal(plan.warnings.length, 0, `no warnings: ${JSON.stringify(plan.warnings)}`);
  assert.equal(plan.counts.projects, 1);
  assert.equal(plan.counts.tasks, 2);
  assert.equal(plan.counts.documents, 2);
  assert.equal(plan.counts.comments, 2);
  assert.equal(plan.counts.pageComments, 1);
  assert.equal(plan.counts.attachments, 1);
  assert.equal(plan.counts.taskFields, 1);
  assert.equal(plan.counts.members, 2);
  assert.equal(plan.counts.matchedMembers, 2);

  const applied = await applyImportPlan({
    plan,
    sourcePath: zipPath,
    actor: { id: "owner", username: "owner", displayName: "Olive Owner" },
  });
  const target = applied.workspaceId;
  assert.equal(applied.counts.tasks, plan.counts.tasks);
  assert.equal(applied.counts.documents, plan.counts.documents);
  assert.equal(applied.counts.comments, plan.counts.comments);
  assert.equal(applied.counts.pageComments, plan.counts.pageComments);
  assert.equal(applied.counts.attachments, plan.counts.attachments);

  const [targetWorkspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, target));
  assert.equal(targetWorkspace.membersSeeAllTasks, 0, "members-see-all-tasks is preserved");
  assert.equal(targetWorkspace.icon, "data:image/png;base64,AAAA");
  assert.equal(targetWorkspace.deletedAt, null, "the workspace is visible after a successful import");

  const targetProjects = await db.select().from(schema.projects).where(eq(schema.projects.workspaceId, target));
  assert.equal(targetProjects.length, 1);
  assert.equal(targetProjects[0].name, "Core");
  assert.equal(targetProjects[0].description, "Core work");
  assert.equal(targetProjects[0].doc, "# Overview\n\nProject notes.");
  const targetLabels = await db.select().from(schema.labels).where(eq(schema.labels.workspaceId, target));
  assert.equal(targetLabels.length, 1);
  assert.equal(targetLabels[0].name, label.name);
  assert.notEqual(targetLabels[0].color, "");

  const targetIssues = await db.select().from(schema.issues).where(eq(schema.issues.workspaceId, target));
  assert.equal(targetIssues.length, 2);
  const byTitle = new Map(targetIssues.map((issue) => [issue.title, issue]));
  const importedParent = byTitle.get("First parent");
  const importedChild = byTitle.get("Child task");
  assert.ok(importedParent && importedChild);
  assert.equal(importedParent.status, "in_progress");
  assert.equal(importedParent.priority, 3);
  assert.equal(importedParent.dueDate, "2026-12-01");
  assert.equal(importedParent.estimate, 3);
  assert.equal(importedChild.parentId, importedParent.id, "the subtask keeps its parent");
  assert.equal(importedParent.description, "Body with **bold** and @member");
  const targetAssignees = await db.select().from(schema.issueAssignees).where(eq(schema.issueAssignees.issueId, importedParent.id));
  assert.deepEqual(targetAssignees.map((row) => row.userId), ["member"]);
  const targetIssueLabels = await db
    .select({ name: schema.labels.name })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(eq(schema.issueLabels.issueId, importedParent.id));
  assert.deepEqual(targetIssueLabels.map((row) => row.name), ["Bug"]);
  const targetFieldValues = await db
    .select({ name: schema.taskFields.name, value: schema.taskFieldValues.value })
    .from(schema.taskFieldValues)
    .innerJoin(schema.taskFields, eq(schema.taskFields.id, schema.taskFieldValues.fieldId))
    .where(eq(schema.taskFieldValues.issueId, importedParent.id));
  assert.deepEqual(targetFieldValues, [{ name: "Effort", value: "Large" }]);

  const targetDependencies = (
    await db
      .select({ issueId: schema.issueDependencies.issueId, blockedById: schema.issueDependencies.blockedById })
      .from(schema.issueDependencies)
  ).filter((dependency) => targetIssues.some((issue) => issue.id === dependency.issueId));
  assert.equal(targetDependencies.length, 1);
  assert.equal(targetDependencies[0].issueId, importedParent.id);
  assert.equal(targetDependencies[0].blockedById, importedChild.id);

  const targetComments = await db.select().from(schema.comments);
  const importedComments = targetComments.filter((comment) =>
    targetIssues.some((issue) => issue.id === comment.issueId)
  );
  assert.equal(importedComments.length, 2);
  const top = importedComments.find((comment) => comment.body === "Top-level comment");
  const replyComment = importedComments.find((comment) => comment.body === "A reply");
  assert.ok(top && replyComment);
  assert.equal(top.parentId, null);
  assert.equal(replyComment.parentId, top.id, "the reply keeps its thread");
  assert.equal(top.authorId, "member");

  const targetPages = await db.select().from(schema.pages).where(eq(schema.pages.workspaceId, target));
  assert.equal(targetPages.length, 2);
  const handbook = targetPages.find((page) => page.title === "Handbook");
  const onboarding = targetPages.find((page) => page.title === "Onboarding");
  assert.ok(handbook && onboarding);
  assert.equal(handbook.shared, 1);
  assert.equal(handbook.doc, "## Section\n\nHello **world**\n\n![](https://example.com/x.png)\n");
  const importedProjectMembers = await db
    .select()
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, targetProjects[0].id));
  assert.deepEqual(
    importedProjectMembers.map((row) => row.userId),
    ["member"],
    "project membership survives the round trip"
  );
  const importedPageAccess = await db
    .select()
    .from(schema.pageAccess)
    .where(eq(schema.pageAccess.pageId, handbook.id));
  assert.deepEqual(
    importedPageAccess.map((row) => ({ userId: row.userId, level: row.level })),
    [{ userId: "member", level: "view" }],
    "per-page access overrides survive the round trip"
  );
  assert.equal(onboarding.parentId, handbook.id);
  assert.equal(onboarding.doc, "Start here.");
  const targetPageComments = await db.select().from(schema.pageComments).where(eq(schema.pageComments.workspaceId, target));
  assert.equal(targetPageComments.length, 1);
  assert.equal(targetPageComments[0].body, "Page comment");
  const targetAttachments = await db.select().from(schema.attachments).where(eq(schema.attachments.workspaceId, target));
  assert.equal(targetAttachments.length, 1);
  assert.equal(targetAttachments[0].name, "notes.txt");
  assert.equal(handbook.cover, targetAttachments[0].id);
  assert.deepEqual(
    fs.readFileSync(path.join(UPLOAD_DIR, targetAttachments[0].id)),
    bytes,
    "the attachment bytes survive the round trip"
  );

  // A second identical import is a no-op once the first job is recorded.
  const job = await jobs.createTransferJob({
    kind: "import",
    workspaceId: target,
    createdBy: "owner",
    fingerprint: plan.fingerprint,
  });
  await jobs.updateTransferJob(
    job.id,
    { status: "done", progress: 100, targetWorkspaceId: target, finishedAt: new Date().toISOString() },
    { force: true }
  );
  const second = await buildImportPlan({
    sourcePath: zipPath,
    fileName: "roundtrip.zip",
    bytes: fs.statSync(zipPath).size,
    fingerprint: sourceFingerprint,
    options: { workspaceName: "Roundtrip copy" },
    actorId: "owner",
  });
  assert.equal(second.duplicateWorkspaceId, target, "rerunning the same import points at the first workspace");
  const workspacesAfter = await db.select().from(schema.workspaces);
  assert.equal(workspacesAfter.length, 2, "the rerun did not create another workspace");

  // Attachment opt-out keeps the document but names the skipped files.
  const without = await writeWorkspaceExport(workspace.id, path.join(root, "without.zip"), { includeAttachments: false });
  assert.equal(without.attachments.included, false);
  assert.equal(without.attachments.includedCount, 0);
  assert.equal(without.attachments.omittedCount, 1);
  const noAttachmentPlan = await buildImportPlan({
    sourcePath: path.join(root, "without.zip"),
    fileName: "without.zip",
    bytes: fs.statSync(path.join(root, "without.zip")).size,
    fingerprint: "without",
    options: { workspaceName: "No attachments", includeAttachments: false },
    actorId: "owner",
  });
  assert.equal(noAttachmentPlan.counts.attachments, 0);
  assert.ok(noAttachmentPlan.warnings.some((warning) => warning.toLowerCase().includes("attachments are off")));

  console.log(
    "check-export-roundtrip: pass (canonical zip, entity/relationship round trip, attachment bytes/cover, idempotent rerun, attachment opt-out)"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
