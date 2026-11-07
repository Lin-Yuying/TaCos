/**
 * U-03 initiatives: workspace objectives with status/priority/owner/target date/labels/
 * resources, project membership, progress roll-up, filters, roadmap grouping (including
 * projects without an initiative) and validation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-initiatives-"));
process.env.TACOS_SEED_DEMO = "0";

const owner = { kind: "user" as const, userId: "owner", displayName: "Owner" };

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const planning = await import("../src/lib/planning/initiatives");
  const milestones = await import("../src/lib/planning/milestones");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now },
      { id: "member", username: "member", displayName: "Member", passwordHash: "x", role: "member", createdAt: now },
    ])
    .run();
  db.insert(schema.workspaces)
    .values({ id: "ws", name: "Workspace", key: "WS", createdBy: "owner", createdAt: now })
    .run();
  db.insert(schema.workspaceMembers)
    .values([
      { workspaceId: "ws", userId: "owner", role: "admin", createdAt: now },
      { workspaceId: "ws", userId: "member", role: "member", createdAt: now },
    ])
    .run();
  db.insert(schema.projects)
    .values([
      { id: "p1", workspaceId: "ws", name: "Core", key: "CORE", createdBy: "owner", createdAt: now },
      { id: "p2", workspaceId: "ws", name: "Agents", key: "AGT", createdBy: "owner", createdAt: now },
      { id: "p3", workspaceId: "ws", name: "Loose", key: "LOOSE", createdBy: "owner", createdAt: now },
    ])
    .run();
  const label = (
    await issues.createLabel("ws", { name: "Feature", color: "#5e6ad2" })
  );
  const otherLabel = await issues.createLabel("ws", { name: "Agent", color: "#a78bfa" });

  const make = async (project: string, title: string, status: "todo" | "done" | "canceled" = "todo") =>
    (
      await issues.createIssue(
        "ws",
        { title, project, status, assigneeIds: ["owner"] },
        owner
      )
    ).issue;
  await make("CORE", "Core done A", "done");
  await make("CORE", "Core done B", "done");
  const coreTodo = await make("CORE", "Core todo");
  const coreCanceled = await make("CORE", "Core canceled", "canceled");
  await make("AGT", "Agent done", "done");
  await make("LOOSE", "Loose todo");

  // --- 1. create + validation ------------------------------------------------------
  await assert.rejects(
    planning.createInitiative("ws", { name: "Bad", ownerId: "nobody" }, "owner"),
    /Owner must be a member/
  );
  await assert.rejects(
    planning.createInitiative("ws", { name: "Bad", labelIds: ["missing"] }, "owner"),
    /label was not found/
  );
  await assert.rejects(
    planning.createInitiative(
      "ws",
      { name: "Bad", resources: [{ title: "x", url: "javascript:alert(1)" }] },
      "owner"
    ),
    /http/
  );
  await assert.rejects(
    planning.createInitiative("ws", { name: "", ownerId: null }, "owner"),
    /name is required/
  );
  const ship = await planning.createInitiative(
    "ws",
    {
      name: "Ship v2.4",
      description: "The next release.",
      status: "active",
      priority: 3,
      ownerId: "member",
      targetDate: "2027-01-15",
      labelIds: [label.id],
      resources: [{ title: "Release plan", url: "https://example.com/plan" }],
    },
    "owner"
  );
  assert.equal(ship.status, "active");
  assert.equal(ship.priority, 3);
  assert.equal(ship.ownerName, "Member");
  assert.equal(ship.targetDate, "2027-01-15");
  assert.deepEqual(ship.labels.map((row) => row.name), ["Feature"]);
  assert.equal(ship.resources[0].url, "https://example.com/plan");

  // --- 2. project membership + progress roll-up -----------------------------------
  await planning.setInitiativeProjects("ws", ship.id, ["p1", "p2"]);
  let loaded = (await planning.getInitiative("ws", ship.id))!;
  assert.deepEqual(loaded.projects.map((project) => project.id).sort(), ["p1", "p2"]);
  assert.equal(loaded.progress.total, 4, "canceled tasks are not part of the roll-up");
  assert.equal(loaded.progress.done, 3);
  assert.equal(loaded.progress.canceled, 1);
  assert.equal(loaded.progress.percent, 75);
  const core = loaded.projects.find((project) => project.id === "p1")!;
  assert.equal(core.progress.total, 3);
  assert.equal(core.progress.done, 2);

  await issues.updateIssue("ws", coreTodo.id, { status: "done" }, owner);
  loaded = (await planning.getInitiative("ws", ship.id))!;
  assert.equal(loaded.progress.done, 4);
  assert.equal(loaded.progress.percent, 100);
  assert.equal(
    (await planning.getInitiative("ws", "no-such-id")),
    null,
    "an unknown initiative is null"
  );

  // --- 3. filters -----------------------------------------------------------------
  const active = await planning.listInitiatives("ws", { status: "active" });
  assert.deepEqual(active.map((initiative) => initiative.id), [ship.id]);
  assert.equal((await planning.listInitiatives("ws", { status: "planned" })).length, 0);
  assert.equal((await planning.listInitiatives("ws", { ownerId: "member" })).length, 1);
  assert.equal((await planning.listInitiatives("ws", { ownerId: "owner" })).length, 0);
  assert.equal((await planning.listInitiatives("ws", { q: "release" })).length, 1);
  assert.equal((await planning.listInitiatives("ws", { q: "nothing" })).length, 0);

  // --- 4. update fields, labels, resources ---------------------------------------
  const planned = await planning.createInitiative(
    "ws",
    { name: "Agent platform", status: "planned", priority: 2, ownerId: "owner" },
    "member"
  );
  const updated = await planning.updateInitiative("ws", planned.id, {
    status: "active",
    name: "Agent platform 2",
    labelIds: [otherLabel.id],
    resources: [{ title: "Docs", url: "https://example.com/docs" }],
  });
  assert.equal(updated.status, "active");
  assert.equal(updated.name, "Agent platform 2");
  assert.deepEqual(updated.labels.map((row) => row.name), ["Agent"]);
  assert.equal(updated.resources.length, 1);
  const ordered = await planning.listInitiatives("ws", {});
  assert.deepEqual(
    ordered.map((initiative) => initiative.name),
    ["Ship v2.4", "Agent platform 2"],
    "active initiatives come first, then the soonest target date"
  );

  // --- 5. roadmap grouping --------------------------------------------------------
  const projectViews = await planning.projectViewsForRoadmap("ws", "owner");
  const milestone = await milestones.createMilestone(
    "ws",
    "p1",
    { name: "Beta", targetDate: "2026-12-01" },
    "owner"
  );
  await issues.updateIssue("ws", coreCanceled.id, { milestoneId: milestone.id }, owner);
  const markers = await planning.listWorkspaceMilestones("ws", projectViews.map((p) => p.id));
  const roadmap = planning.buildRoadmap(
    await planning.listInitiatives("ws", {}),
    projectViews,
    markers
  );
  const shipGroup = roadmap.find((group) => group.initiative?.id === ship.id)!;
  assert.equal(shipGroup.initiative?.name, "Ship v2.4");
  assert.deepEqual(shipGroup.projects.map((project) => project.id).sort(), ["p1", "p2"]);
  const coreProject = shipGroup.projects.find((project) => project.id === "p1")!;
  assert.equal(coreProject.milestones.length, 1);
  assert.equal(coreProject.milestones[0].name, "Beta");
  assert.equal(coreProject.milestones[0].targetDate, "2026-12-01");
  const unlinked = roadmap.find((group) => group.initiative === null);
  assert(unlinked, "projects without an initiative still appear");
  assert.deepEqual(unlinked!.projects.map((project) => project.id), ["p3"]);

  // --- 6. delete keeps projects and tasks ----------------------------------------
  await planning.deleteInitiative("ws", planned.id);
  assert.equal((await planning.getInitiative("ws", planned.id)), null);
  assert.equal((await issues.listProjects("ws")).length, 3, "deleting an initiative keeps projects");
  const links = db
    .select()
    .from(schema.initiativeProjects)
    .where(eq(schema.initiativeProjects.initiativeId, planned.id))
    .all();
  assert.equal(links.length, 0, "its project links are removed");
  assert.equal((await planning.listInitiatives("ws", {})).length, 1);

  console.log("check-initiatives: 32 assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
