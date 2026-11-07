/**
 * U-03 cycles: settings validation, lazy schedule creation and idempotency, cycle
 * progress, rollover of todo/in_progress only, auto-add opt-in, capacity from the last
 * three completed cycles, burndown and the .ics payload.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-cycles-"));
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
    .values({ id: "p1", workspaceId: "ws", name: "Core", key: "CORE", createdBy: "owner", createdAt: now })
    .run();

  // --- 1. settings validation ------------------------------------------------------
  for (const bad of [
    { durationWeeks: 0 },
    { durationWeeks: 9 },
    { startDay: 0 },
    { startDay: 8 },
    { cooldownWeeks: 9 },
    { upcomingCount: 16 },
  ]) {
    assert.throws(() => planning.normalizeCycleSettingsInput(bad), /between/, `rejects ${JSON.stringify(bad)}`);
  }
  await assert.rejects(
    planning.saveCycleSettings("ws", { enabled: true }, "member"),
    /Only workspace admins/,
    "a member cannot change cycle settings"
  );
  const settings = await planning.saveCycleSettings(
    "ws",
    { enabled: true, durationWeeks: 2, startDay: 1, cooldownWeeks: 0, upcomingCount: 2, autoAdd: false },
    "owner"
  );
  assert.equal(settings.enabled, true);
  assert.equal(settings.durationWeeks, 2);
  db.delete(schema.cycles).run();

  // A current two-week cycle from Monday 2026-03-02, then the lazy sweep fills 2 upcoming.
  const current = await planning.createCycle(
    "ws",
    { startsAt: "2026-03-02", endsAt: "2026-03-15", status: "active" },
    "owner"
  );
  const first = await planning.syncCycleLifecycle("ws", { today: "2026-03-04", actorId: "owner" });
  assert.equal(first.created, 2, "the first sweep creates the two configured upcoming cycles");
  const all = await planning.listCycles("ws");
  assert.equal(all.length, 3);
  const active = all.find((cycle) => cycle.id === current.id);
  assert.equal(active?.status, "active", "a cycle covering today is active");
  for (const cycle of all) {
    assert.equal(
      planning.isoWeekday(cycle.startsAt),
      1,
      `${cycle.name} starts on the configured Monday`
    );
    assert.equal(cycle.endsAt.slice(0, 10) >= cycle.startsAt, true);
  }
  assert.deepEqual(
    all.filter((cycle) => cycle.status === "upcoming").length,
    2,
    "the configured number of upcoming cycles is kept"
  );

  // Idempotent across a restart / second tick.
  const second = await planning.syncCycleLifecycle("ws", { today: "2026-03-04", actorId: "owner" });
  assert.equal(second.created, 0, "a second sweep creates nothing");
  assert.equal((await planning.listCycles("ws")).length, 3, "no duplicate cycles");

  // --- 2. rollover moves unfinished work only --------------------------------------
  const next = all.find((cycle) => cycle.startsAt === "2026-03-16");
  assert(next, "the next cycle exists");
  const make = async (title: string, status: "todo" | "in_progress" | "done" | "canceled") =>
    (
      await issues.createIssue(
        "ws",
        { title, project: "CORE", status, estimate: 3 },
        owner
      )
    ).issue;
  const kept = await make("Kept todo", "todo");
  const started = await make("Started task", "in_progress");
  const finished = await make("Finished task", "done");
  const dropped = await make("Dropped task", "canceled");
  await planning.assignIssuesToCycle(
    "ws",
    current.id,
    [kept.id, started.id, finished.id, dropped.id],
    owner
  );
  const rolled = await planning.syncCycleLifecycle("ws", { today: "2026-03-16", actorId: "owner" });
  assert.equal(rolled.completed, 1, "the cycle whose end passed is completed once");
  const afterRoll = await issues.listIssues("ws", { ids: [kept.id, started.id, finished.id, dropped.id] });
  const cycleOf = (id: string) => afterRoll.find((issue) => issue.id === id)?.cycleId;
  assert.equal(cycleOf(kept.id), next.id, "todo rolls to the next cycle");
  assert.equal(cycleOf(started.id), next.id, "in_progress rolls to the next cycle");
  assert.equal(cycleOf(finished.id), current.id, "done never rolls");
  assert.equal(cycleOf(dropped.id), current.id, "canceled never rolls");
  const cycleEvents = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, kept.id), eq(schema.events.type, "cycle_changed")))
    .all();
  assert.equal(cycleEvents.length, 2, "the assignment and the rollover each record a cycle event");

  const again = await planning.syncCycleLifecycle("ws", { today: "2026-03-16", actorId: "owner" });
  assert.equal(again.rolledOver, 0, "a repeated tick does not roll the same cycle again");
  const unchanged = await issues.listIssues("ws", { ids: [kept.id, started.id] });
  for (const issue of unchanged) assert.equal(issue.cycleId, next.id, "rollover is stable");

  // --- 3. capacity uses estimates of the last three completed cycles, then count ---
  db.insert(schema.workspaces)
    .values({ id: "ws2", name: "Capacity", key: "CAP", createdBy: "owner", createdAt: now })
    .run();
  db.insert(schema.workspaceMembers)
    .values({ workspaceId: "ws2", userId: "owner", role: "admin", createdAt: now })
    .run();
  db.insert(schema.projects)
    .values({ id: "p2", workspaceId: "ws2", name: "Cap", key: "CAP", createdBy: "owner", createdAt: now })
    .run();
  const capacityIssue = async (title: string, estimate: number | null) =>
    (
      await issues.createIssue(
        "ws2",
        { title, project: "CAP", estimate, assigneeIds: ["owner"] },
        owner
      )
    ).issue;
  const doneIssue = async (title: string, estimate: number | null) => {
    const issue = await capacityIssue(title, estimate);
    await issues.updateIssue("ws2", issue.id, { status: "done" }, owner);
    return issue;
  };
  const c1 = await planning.createCycle("ws2", { startsAt: "2026-01-05", endsAt: "2026-01-18", status: "completed" }, "owner");
  const c2 = await planning.createCycle("ws2", { startsAt: "2026-01-19", endsAt: "2026-02-01", status: "completed" }, "owner");
  const a = await doneIssue("A", 2);
  const b = await doneIssue("B", 4);
  const c = await doneIssue("C", 3);
  await planning.assignIssuesToCycle("ws2", c1.id, [a.id, b.id], owner);
  await planning.assignIssuesToCycle("ws2", c2.id, [c.id], owner);
  const capacity = await planning.cycleCapacity("ws2");
  assert.equal(capacity.unit, "points", "all sized cycles report points");
  assert.equal(capacity.samples, 2);
  assert.equal(capacity.average, 4.5, "(6 + 3) / 2");
  const unsized = await capacityIssue("Unsized", null);
  await planning.assignIssuesToCycle("ws2", c2.id, [unsized.id], owner);
  const fallback = await planning.cycleCapacity("ws2");
  assert.equal(fallback.unit, "tasks", "one unsized task falls back to task count");
  assert.equal(fallback.average, 2, "(2 tasks + 2 tasks) / 2 completed cycles");

  // --- 4. auto-add is opt-in and idempotent ----------------------------------------
  const unplanned = await issues.createIssue("ws", { title: "Unplanned", project: "CORE" }, owner);
  // The lazy sweep only adds tasks that existed before the simulated day.
  db.update(schema.issues)
    .set({ createdAt: "2026-03-01T10:00:00.000Z" })
    .where(eq(schema.issues.id, unplanned.issue.id))
    .run();
  const offResult = await planning.syncCycleLifecycle("ws", { today: "2026-03-20", actorId: "owner" });
  assert.equal(offResult.autoAdded, 0, "auto-add is off by default");
  assert.equal(
    (await issues.listIssues("ws", { ids: [unplanned.issue.id] }))[0].cycleId,
    null,
    "an active task is not silently planned while auto-add is off"
  );
  // Flip only the opt-in; saving the form again would run the lifecycle at the real
  // clock and close the simulated March cycles.
  db.update(schema.cycleSettings)
    .set({ autoAdd: 1 })
    .where(eq(schema.cycleSettings.workspaceId, "ws"))
    .run();
  const onResult = await planning.syncCycleLifecycle("ws", { today: "2026-03-20", actorId: "owner" });
  assert.equal(onResult.autoAdded, 1, "auto-add moves the active unplanned task once");
  const autoCycle = (await issues.listIssues("ws", { ids: [unplanned.issue.id] }))[0].cycleId;
  assert(autoCycle, "the task landed in a cycle");
  const onAgain = await planning.syncCycleLifecycle("ws", { today: "2026-03-20", actorId: "owner" });
  assert.equal(onAgain.autoAdded, 0, "a second tick adds nothing");

  // --- 5. burndown + detail -------------------------------------------------------
  const burnCycle = await planning.createCycle(
    "ws2",
    { startsAt: "2026-03-02", endsAt: "2026-03-15" },
    "owner"
  );
  const burnIssue = await capacityIssue("Burn", 1);
  db.update(schema.issues)
    .set({ createdAt: "2026-03-02T10:00:00.000Z" })
    .where(eq(schema.issues.id, burnIssue.id))
    .run();
  await planning.assignIssuesToCycle("ws2", burnCycle.id, [burnIssue.id], owner);
  const detail = await planning.getCycleDetail("ws2", burnCycle.id, "owner", "2026-03-04");
  assert(detail, "cycle detail loads");
  assert.equal(detail!.tasks.length, 1);
  assert.equal(detail!.burndown.length, 3, "the burndown covers 3 days to today");
  assert.deepEqual(
    detail!.burndown.map((point) => point.remaining),
    [1, 1, 1],
    "the open task is still remaining each day"
  );
  assert.equal(detail!.burndown[2].ideal, 0, "the ideal line reaches zero");

  // --- 6. calendar payload --------------------------------------------------------
  const ics = planning.cycleCalendar({
    id: "c1",
    name: "Cycle 1",
    startsAt: "2026-03-02",
    endsAt: "2026-03-15",
  });
  assert(ics.includes("BEGIN:VCALENDAR"));
  assert(ics.includes("DTSTART;VALUE=DATE:20260302"));
  assert(ics.includes("DTEND;VALUE=DATE:20260316"), "DTEND is exclusive");
  assert(ics.includes("SUMMARY:Cycle 1"));

  console.log("check-cycles: 41 assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
