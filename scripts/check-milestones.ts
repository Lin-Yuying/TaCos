/**
 * U-03 milestones: project scope, optional target dates, plan order, progress computed
 * from attached tasks, the current milestone, filtering by milestone, detach-on-delete
 * and the project boundary (a milestone never accepts another project's task).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-milestones-"));
process.env.TACOS_SEED_DEMO = "0";

const owner = { kind: "user" as const, userId: "owner", displayName: "Owner" };

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const milestones = await import("../src/lib/planning/milestones");
  const { and, eq } = await import("drizzle-orm");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values({ id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now })
    .run();
  db.insert(schema.workspaces)
    .values({ id: "ws", name: "Workspace", key: "WS", createdBy: "owner", createdAt: now })
    .run();
  db.insert(schema.workspaceMembers)
    .values({ workspaceId: "ws", userId: "owner", role: "admin", createdAt: now })
    .run();
  db.insert(schema.projects)
    .values([
      { id: "p1", workspaceId: "ws", name: "Core", key: "CORE", createdBy: "owner", createdAt: now },
      { id: "p2", workspaceId: "ws", name: "Other", key: "OTHER", createdBy: "owner", createdAt: now },
    ])
    .run();

  const make = async (project: string, title: string, status: "todo" | "in_progress" | "done" | "canceled" = "todo", estimate: number | null = null) =>
    (
      await issues.createIssue(
        "ws",
        { title, project, status, estimate, assigneeIds: ["owner"] },
        owner
      )
    ).issue;

  // --- 1. create with and without a target date, plan order -----------------------
  const alpha = await milestones.createMilestone(
    "ws",
    "p1",
    { name: "Alpha", description: "First stage" },
    "owner"
  );
  assert.equal(alpha.targetDate, null, "a milestone can be created without a date");
  assert.equal(alpha.position, 1);
  const beta = await milestones.createMilestone(
    "ws",
    "p1",
    { name: "Beta", targetDate: "2026-12-01" },
    "owner"
  );
  const gamma = await milestones.createMilestone(
    "ws",
    "p1",
    { name: "Gamma", targetDate: "2027-01-15" },
    "owner"
  );
  assert.deepEqual(
    (await milestones.listProjectMilestones("ws", "p1")).map((row) => row.name),
    ["Alpha", "Beta", "Gamma"],
    "milestones keep their plan order"
  );
  await assert.rejects(
    milestones.createMilestone("ws", "p1", { name: "  " }, "owner"),
    /name is required/
  );
  await assert.rejects(
    milestones.createMilestone("ws", "p1", { name: "Bad date", targetDate: "12/01/2026" }, "owner"),
    /Target date/
  );

  // --- 2. edit, reorder ----------------------------------------------------------
  const edited = await milestones.updateMilestone("ws", "p1", alpha.id, {
    name: "Alpha (updated)",
    description: "Reworked",
    targetDate: "2026-11-20",
  });
  assert.equal(edited.name, "Alpha (updated)");
  assert.equal(edited.targetDate, "2026-11-20");
  let ordered = await milestones.moveMilestone("ws", "p1", gamma.id, "up");
  assert.deepEqual(ordered.map((row) => row.name), ["Alpha (updated)", "Gamma", "Beta"]);
  ordered = await milestones.moveMilestone("ws", "p1", gamma.id, "down");
  assert.deepEqual(ordered.map((row) => row.name), ["Alpha (updated)", "Beta", "Gamma"]);

  // --- 3. attach tasks and compute progress --------------------------------------
  const one = await make("CORE", "Ship alpha", "in_progress", 3);
  const two = await make("CORE", "Ship beta", "done", 5);
  const three = await make("CORE", "Canceled work", "canceled");
  const loose = await make("CORE", "Unplanned task");
  await issues.updateIssue("ws", one.id, { milestoneId: alpha.id }, owner);
  await issues.updateIssue("ws", two.id, { milestoneId: alpha.id }, owner);
  await issues.updateIssue("ws", three.id, { milestoneId: alpha.id }, owner);

  let alphaRow = (await milestones.listProjectMilestones("ws", "p1")).find((row) => row.id === alpha.id)!;
  assert.equal(alphaRow.progress.total, 2, "canceled tasks do not count toward progress");
  assert.equal(alphaRow.progress.done, 1);
  assert.equal(alphaRow.progress.open, 1);
  assert.equal(alphaRow.progress.canceled, 1);
  assert.equal(alphaRow.progress.percent, 50);
  assert.equal(alphaRow.progress.estimate, 8);
  assert.equal(alphaRow.current, true, "the first unfinished milestone is current");

  const attached = await issues.listIssues("ws", { projectId: "p1", milestoneId: alpha.id, status: "all" });
  assert.equal(attached.length, 3, "filter by milestone returns its tasks");
  const unassigned = await issues.listIssues("ws", { projectId: "p1", milestoneId: null, status: "all" });
  assert.deepEqual(unassigned.map((task) => task.id), [loose.id], "no-milestone filter returns only loose tasks");
  assert.equal(
    (await issues.listIssues("ws", { projectId: "p1", milestoneId: beta.id, status: "all" })).length,
    0
  );

  // A task can only take a milestone from its own project.
  const other = await make("OTHER", "Other task");
  await assert.rejects(
    issues.updateIssue("ws", other.id, { milestoneId: beta.id }, owner),
    /belongs to one project/
  );

  // A done task moves the milestone to complete, and the next one becomes current.
  await issues.updateIssue("ws", one.id, { status: "done" }, owner);
  alphaRow = (await milestones.listProjectMilestones("ws", "p1")).find((row) => row.id === alpha.id)!;
  assert.equal(alphaRow.progress.percent, 100, "all counted tasks are done");
  const all = await milestones.listProjectMilestones("ws", "p1");
  assert.equal(all.find((row) => row.id === beta.id)?.current, true, "the next unfinished stage is current");

  // --- 4. choices + delete detaches without deleting tasks ------------------------
  const choices = await milestones.milestoneChoices("ws", "p1");
  assert.deepEqual(choices.map((row) => row.name), ["Alpha (updated)", "Beta", "Gamma"]);

  const detached = await milestones.deleteMilestone("ws", "p1", alpha.id, owner);
  assert.equal(detached.detached, 3);
  const after = await issues.listIssues("ws", { projectId: "p1", milestoneId: null, status: "all" });
  assert.equal(after.length, 4, "deleted milestone tasks stay in the project without a milestone");
  assert.equal((await milestones.listProjectMilestones("ws", "p1")).length, 2);
  const milestoneEvents = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, one.id), eq(schema.events.type, "milestone_changed")))
    .all();
  assert(milestoneEvents.length >= 2, "attaching and detaching each record a milestone event");

  // --- 5. timeline payload --------------------------------------------------------
  const timeline = await milestones.projectTimeline("ws", "p1", "owner");
  assert.equal(timeline.milestones.length, 2);
  assert.equal(timeline.issues.length, 4);
  assert.equal(new Set(timeline.issues.map((task) => task.id)).size, 4);

  console.log("check-milestones: 26 assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
