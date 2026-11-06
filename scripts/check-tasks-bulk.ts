/**
 * U-09 commit 4: bulk edits (status ownership, per-task errors, labels, due dates,
 * project moves), workspace task templates, and the numeric estimate field.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-tasks-bulk-"));
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const templates = await import("../src/lib/task-templates");
  const { and, eq } = await import("drizzle-orm");
  const db = getDb();
  const now = new Date().toISOString();
  const owner = { kind: "user" as const, userId: "user-owner", displayName: "Owner" };
  const agent = { kind: "agent" as const, label: "mcp", via: "mcp" as const };
  const member = "user-member";
  db.insert(schema.users).values([
    { id: owner.userId, username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now },
    { id: member, username: "member", displayName: "Member", passwordHash: "x", role: "member", createdAt: now },
  ]).run();
  db.insert(schema.workspaces).values({ id: "ws", name: "W", key: "W", createdBy: owner.userId, createdAt: now }).run();
  db.insert(schema.workspaceMembers).values([
    { workspaceId: "ws", userId: owner.userId, role: "admin", createdAt: now },
    { workspaceId: "ws", userId: member, role: "member", createdAt: now },
  ]).run();
  db.insert(schema.projects).values([
    { id: "p1", workspaceId: "ws", name: "One", key: "ONE", createdBy: owner.userId, createdAt: now },
    { id: "p2", workspaceId: "ws", name: "Two", key: "TWO", createdBy: owner.userId, createdAt: now },
  ]).run();

  async function make(title: string, project = "ONE", patch: Partial<Parameters<typeof issues.createIssue>[1]> = {}) {
    const detail = await issues.createIssue("ws", { title, project, ...patch }, owner);
    return detail.issue;
  }
  const eventsFor = (issueId: string, type?: string) =>
    db
      .select()
      .from(schema.events)
      .where(
        type
          ? and(eq(schema.events.issueId, issueId), eq(schema.events.type, type))
          : eq(schema.events.issueId, issueId)
      )
      .all();

  // --- priority, due date and labels in one batch ---
  const a = await make("Alpha", "ONE", { labelNames: ["old"] });
  const b = await make("Beta", "ONE");
  const c = await make("Gamma", "ONE");
  const batch = [a.id, b.id, c.id];
  const priority = await issues.bulkUpdateIssues("ws", batch, { priority: 3 }, owner);
  assert.equal(priority.updated, 3);
  for (const id of batch) {
    const detail = await issues.getIssueDetail("ws", id);
    assert.equal(detail?.issue.priority, 3);
    assert.equal(eventsFor(id, "priority_changed").length, 1, "each task records its own event");
  }
  await issues.bulkUpdateIssues("ws", batch, { dueDate: "2026-12-01" }, owner);
  assert.equal((await issues.getIssueDetail("ws", a.id))?.issue.dueDate, "2026-12-01");
  await issues.bulkUpdateIssues("ws", batch, { labelAdd: ["bulk"], labelRemove: ["old"] }, owner);
  assert.deepEqual((await issues.getIssueDetail("ws", a.id))?.issue.labels.map((label) => label.name), ["bulk"]);
  assert.deepEqual((await issues.getIssueDetail("ws", b.id))?.issue.labels.map((label) => label.name), ["bulk"]);
  assert.equal(eventsFor(a.id, "labels_changed").length, 1, "one event covers the whole label change");
  await issues.bulkUpdateIssues("ws", batch, { assigneeIds: [member] }, owner);
  assert.deepEqual((await issues.getIssueDetail("ws", a.id))?.issue.assignees.map((person) => person.id), [member]);

  // --- status ownership per task ---
  const denied = await issues.bulkUpdateIssues("ws", batch, { status: "done" }, owner);
  assert.equal(denied.updated, 0, "a non-assignee cannot bulk-change status");
  assert.equal(denied.results.filter((row) => !row.ok).length, 3);
  assert.match(denied.results[0].error ?? "", /Only assignees can change/);
  for (const id of batch) assert.equal((await issues.getIssueDetail("ws", id))?.issue.status, "todo");
  const allowedAgent = await issues.bulkUpdateIssues("ws", batch, { status: "done" }, agent);
  assert.equal(allowedAgent.updated, 3, "an agent caller is unrestricted, like the API");
  for (const id of batch) assert.equal((await issues.getIssueDetail("ws", id))?.issue.status, "done");
  // The assignee can move it back.
  const allowedMember = await issues.bulkUpdateIssues("ws", [a.id], { status: "in_progress" }, {
    kind: "user",
    userId: member,
    displayName: "Member",
  });
  assert.equal(allowedMember.updated, 1);
  assert.equal((await issues.getIssueDetail("ws", a.id))?.issue.status, "in_progress");

  // --- per-task errors are reported, the rest still applies ---
  const mixed = await issues.bulkUpdateIssues("ws", [b.id, "missing-id"], { priority: 1 }, owner);
  assert.equal(mixed.updated, 1);
  assert.equal(mixed.results.find((row) => row.id === "missing-id")?.ok, false);
  assert.equal((await issues.getIssueDetail("ws", b.id))?.issue.priority, 1);

  // --- project move ---
  const existingTarget = await make("Already there", "TWO");
  const moved = await issues.moveIssueToProject("ws", c.id, "TWO", owner);
  assert.equal(moved.issue.projectId, "p2");
  assert.match(moved.issue.identifier, /^TWO-\d+$/, "the identifier is reallocated in the target project");
  assert.notEqual(moved.issue.identifier, existingTarget.identifier, "numbers stay unique per project");
  assert.equal(eventsFor(c.id, "project_changed").length, 1);
  const movedBulk = await issues.bulkUpdateIssues("ws", [b.id], { projectId: "p2" }, owner);
  assert.equal(movedBulk.updated, 1);
  assert.equal((await issues.getIssueDetail("ws", b.id))?.issue.projectId, "p2");

  // A task with subtasks must not leave its children behind.
  const parent = await make("Parent", "ONE");
  await make("Child", "ONE", { parent: parent.identifier });
  const refused = await issues.bulkUpdateIssues("ws", [parent.id], { projectId: "p2" }, owner);
  assert.equal(refused.updated, 0);
  assert.match(refused.results[0].error ?? "", /subtasks/);
  // A subtask cannot leave its parent's project either.
  const child = (await issues.getIssueDetail("ws", parent.id))!.children[0];
  const childMoved = await issues.bulkUpdateIssues("ws", [child.id], { projectId: "p2" }, owner);
  assert.equal(childMoved.updated, 0);
  assert.match(childMoved.results[0].error ?? "", /subtask stays/);

  // --- input guards ---
  await assert.rejects(() => issues.bulkUpdateIssues("ws", [], { priority: 1 }, owner), /at least one/);
  await assert.rejects(
    () => issues.bulkUpdateIssues("ws", Array.from({ length: 101 }, (_, index) => `id-${index}`), { priority: 1 }, owner),
    /at most 100/
  );
  await assert.rejects(() => issues.bulkUpdateIssues("ws", [a.id, a.id], { priority: 1 }, owner), /repeats/);
  await assert.rejects(() => issues.bulkUpdateIssues("ws", [a.id], {}, owner), /Choose a change/);
  await assert.rejects(
    () => issues.bulkUpdateIssues("ws", [a.id], { assigneeIds: ["nobody"] }, owner),
    /not a member/
  );

  // --- estimate ---
  const sized = await make("Sized", "ONE", { estimate: 5 });
  assert.equal(sized.estimate, 5);
  const resized = await issues.updateIssue("ws", sized.id, { estimate: 8.5 }, owner);
  assert.equal(resized.issue.estimate, 8.5);
  assert.equal(eventsFor(sized.id, "estimate_changed").length, 1);
  await issues.updateIssue("ws", sized.id, { estimate: null }, owner);
  assert.equal((await issues.getIssueDetail("ws", sized.id))?.issue.estimate, null);
  await assert.rejects(
    () => issues.updateIssue("ws", sized.id, { estimate: -1 }, owner),
    /Estimate must be/
  );
  await assert.rejects(
    () => issues.createIssue("ws", { title: "Bad estimate", project: "ONE", estimate: 20_000 }, owner),
    /Estimate must be/
  );

  // --- templates ---
  const template = templates.createTaskTemplate("ws", owner.userId, {
    name: "Bug report",
    title: "Report a bug",
    description: "What happened?",
    priority: 3,
    labelNames: ["bug", "triage"],
    fieldValues: { "field-1": "a" },
  });
  assert.equal(template.name, "Bug report");
  assert.deepEqual(template.labelNames, ["bug", "triage"]);
  assert.equal(template.priority, 3);
  assert.deepEqual(templates.listTaskTemplates("ws").map((row) => row.id), [template.id]);
  assert.throws(
    () => templates.createTaskTemplate("ws", member, { name: "Nope", title: "Nope" }),
    /Only the workspace owner or an admin/
  );
  const updated = templates.updateTaskTemplate("ws", owner.userId, template.id, {
    name: "Bug report v2",
    title: "Report a bug",
    priority: 4,
  });
  assert.equal(updated.name, "Bug report v2");
  assert.equal(updated.priority, 4);
  assert.throws(
    () => templates.updateTaskTemplate("ws", member, template.id, { name: "x", title: "x" }),
    /Only the workspace owner or an admin/
  );
  templates.deleteTaskTemplate("ws", owner.userId, template.id);
  assert.equal(templates.listTaskTemplates("ws").length, 0);
  assert.throws(
    () => templates.createTaskTemplate("ws", owner.userId, { name: "", title: "" }),
    /template name/
  );

  console.log("check-tasks-bulk: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
