/**
 * U-03 lazy cycle lifecycle under restarts and concurrent ticks: one completion per
 * cycle, one rollover per unfinished task, no duplicate events, the end-date boundary,
 * auto-created next cycles even when auto-create is off, and the auto-add opt-in.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-rollover-"));
process.env.TACOS_SEED_DEMO = "0";

const owner = { kind: "user" as const, userId: "owner", displayName: "Owner" };

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const planning = await import("../src/lib/planning/cycles");
  const { and, eq } = await import("drizzle-orm");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values({ id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "member", createdAt: now })
    .run();
  for (const [id, key, projectKey] of [
    ["ws", "WS", "CORE"],
    ["ws2", "ADD", "ADD"],
  ]) {
    db.insert(schema.workspaces)
      .values({ id, name: id, key, createdBy: "owner", createdAt: now })
      .run();
    db.insert(schema.workspaceMembers)
      .values({ workspaceId: id, userId: "owner", role: "admin", createdAt: now })
      .run();
    db.insert(schema.projects)
      .values({ id: `p_${id}`, workspaceId: id, name: "Core", key: projectKey, createdBy: "owner", createdAt: now })
      .run();
    db.insert(schema.cycleSettings)
      .values({
        workspaceId: id,
        enabled: 1,
        durationWeeks: 2,
        startDay: 1,
        cooldownWeeks: 0,
        upcomingCount: 2,
        autoAdd: 0,
        updatedAt: now,
      })
      .run();
  }

  const make = async (workspaceId: string, project: string, title: string, status: "todo" | "in_progress" | "done" | "canceled" = "todo") =>
    (
      await issues.createIssue(
        workspaceId,
        { title, project, status, assigneeIds: ["owner"] },
        owner
      )
    ).issue;

  // --- 1. two concurrent ticks complete and roll a cycle once ---------------------
  const a = await planning.createCycle(
    "ws",
    { startsAt: "2026-03-02", endsAt: "2026-03-15", status: "active" },
    "owner"
  );
  const b = await planning.createCycle(
    "ws",
    { startsAt: "2026-03-16", endsAt: "2026-03-29", status: "upcoming" },
    "owner"
  );
  const todo = await make("ws", "CORE", "Todo", "todo");
  const started = await make("ws", "CORE", "Started", "in_progress");
  const done = await make("ws", "CORE", "Done", "done");
  const canceled = await make("ws", "CORE", "Canceled", "canceled");
  await planning.assignIssuesToCycle("ws", a.id, [todo.id, started.id, done.id, canceled.id], owner);
  const eventsBefore = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, todo.id), eq(schema.events.type, "cycle_changed")))
    .all().length;

  const [tick1, tick2] = await Promise.all([
    planning.syncCycleLifecycle("ws", { today: "2026-03-16", actorId: "owner" }),
    planning.syncCycleLifecycle("ws", { today: "2026-03-16", actorId: "owner" }),
  ]);
  assert.equal(tick1.completed + tick2.completed, 1, "only one concurrent tick completes the cycle");
  const cycleA = (await planning.getCycle("ws", a.id))!;
  assert.equal(cycleA.status, "completed");
  assert(cycleA.rolledOverAt, "the completion is marked as rolled over");
  const after = await issues.listIssues("ws", { ids: [todo.id, started.id, done.id, canceled.id] });
  const at = (id: string) => after.find((issue) => issue.id === id)!.cycleId;
  assert.equal(at(todo.id), b.id);
  assert.equal(at(started.id), b.id);
  assert.equal(at(done.id), a.id, "done stays in the old cycle");
  assert.equal(at(canceled.id), a.id, "canceled stays in the old cycle");
  const eventsAfter = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, todo.id), eq(schema.events.type, "cycle_changed")))
    .all().length;
  assert.equal(eventsAfter, eventsBefore + 1, "concurrent ticks write exactly one rollover event");

  // --- 2. repeat ticks change nothing --------------------------------------------
  const repeat = await planning.syncCycleLifecycle("ws", { today: "2026-03-16", actorId: "owner" });
  assert.equal(repeat.completed, 0);
  assert.equal(repeat.rolledOver, 0);
  const repeatEvents = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, todo.id), eq(schema.events.type, "cycle_changed")))
    .all().length;
  assert.equal(repeatEvents, eventsBefore + 1, "a later tick does not move the task again");

  // --- 3. the end date is inclusive; completion starts the next day ---------------
  const boundary = await planning.createCycle(
    "ws",
    { startsAt: "2027-01-04", endsAt: "2027-01-17", status: "active" },
    "owner"
  );
  const boundaryTask = await make("ws", "CORE", "Boundary task");
  await planning.assignIssuesToCycle("ws", boundary.id, [boundaryTask.id], owner);
  await planning.syncCycleLifecycle("ws", { today: "2027-01-17", actorId: "owner" });
  assert.equal((await planning.getCycle("ws", boundary.id))!.status, "active", "a cycle ending today is still active");
  await planning.syncCycleLifecycle("ws", { today: "2027-01-18", actorId: "owner" });
  assert.equal((await planning.getCycle("ws", boundary.id))!.status, "completed");
  const boundaryAfter = (await issues.listIssues("ws", { ids: [boundaryTask.id] }))[0];
  assert(boundaryAfter.cycleId && boundaryAfter.cycleId !== boundary.id, "its unfinished task moved forward");

  // --- 4. a next cycle is created even when automatic creation is off ------------
  db.update(schema.cycleSettings)
    .set({ enabled: 0 })
    .where(eq(schema.cycleSettings.workspaceId, "ws"))
    .run();
  const last = await planning.createCycle(
    "ws",
    { startsAt: "2027-03-01", endsAt: "2027-03-14", status: "active" },
    "owner"
  );
  const late = await make("ws", "CORE", "Late task");
  await planning.assignIssuesToCycle("ws", last.id, [late.id], owner);
  const sweep = await planning.syncCycleLifecycle("ws", { today: "2027-03-15", actorId: "owner" });
  assert(sweep.completed >= 1, "the sweep completes every cycle whose end passed");
  assert.equal((await planning.getCycle("ws", last.id))!.status, "completed");
  const successors = (await planning.listCycles("ws")).filter((cycle) => cycle.startsAt > last.startsAt);
  assert(successors.length >= 1, "completing a cycle creates its successor on demand");
  const lateAfter = (await issues.listIssues("ws", { ids: [late.id] }))[0];
  assert.equal(lateAfter.cycleId, successors[0].id, "the unfinished task rolls into the successor");
  const disabledAgain = await planning.syncCycleLifecycle("ws", { today: "2027-03-15", actorId: "owner" });
  assert.equal(disabledAgain.created, 0, "with cycles disabled no upcoming schedule is added");

  // --- 5. auto-add is opt-in and only takes existing active tasks ----------------
  const addCycle = await planning.createCycle(
    "ws2",
    { startsAt: "2026-03-02", endsAt: "2026-03-15", status: "active" },
    "owner"
  );
  const off = await planning.syncCycleLifecycle("ws2", { today: "2026-03-10", actorId: "owner" });
  assert.equal(off.autoAdded, 0);
  const unplanned = await make("ws2", "ADD", "Unplanned active");
  db.update(schema.issues)
    .set({ createdAt: "2026-03-05T10:00:00.000Z" })
    .where(eq(schema.issues.id, unplanned.id))
    .run();
  const future = await make("ws2", "ADD", "Created tomorrow");
  db.update(schema.issues)
    .set({ createdAt: "2026-03-11T10:00:00.000Z" })
    .where(eq(schema.issues.id, future.id))
    .run();
  const planned = await make("ws2", "ADD", "Already done", "done");
  db.update(schema.cycleSettings)
    .set({ autoAdd: 1 })
    .where(eq(schema.cycleSettings.workspaceId, "ws2"))
    .run();
  const on = await planning.syncCycleLifecycle("ws2", { today: "2026-03-10", actorId: "owner" });
  assert.equal(on.autoAdded, 1, "only the existing active task is added");
  const added = (await issues.listIssues("ws2", { ids: [unplanned.id, future.id, planned.id] }));
  assert.equal(added.find((issue) => issue.id === unplanned.id)!.cycleId, addCycle.id);
  assert.equal(added.find((issue) => issue.id === future.id)!.cycleId, null, "a task created after today is not planned");
  assert.equal(added.find((issue) => issue.id === planned.id)!.cycleId, null, "done is never auto-added");
  const onAgain = await planning.syncCycleLifecycle("ws2", { today: "2026-03-10", actorId: "owner" });
  assert.equal(onAgain.autoAdded, 0);

  // --- 6. a workspace with no cycles and cycles off is a no-op -------------------
  db.insert(schema.workspaces)
    .values({ id: "ws3", name: "Empty", key: "EMPTY", createdBy: "owner", createdAt: now })
    .run();
  const noop = await planning.syncCycleLifecycle("ws3", { today: "2026-03-10", actorId: "owner" });
  assert.deepEqual(noop, { created: 0, completed: 0, rolledOver: 0, autoAdded: 0 });

  console.log("check-planning-rollover: 25 assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
