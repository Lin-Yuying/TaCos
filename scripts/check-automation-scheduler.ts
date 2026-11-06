/**
 * #80: the due-soon scheduler. Exact day boundary, one run per (rule, task, due date)
 * across repeated ticks and restarts, finished/canceled/deleted tasks skipped, and two
 * concurrent ticks cannot both run the same rule.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-automation-scheduler-"));
process.env.TACOS_SEED_DEMO = "0";

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12, 0, 0);

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const store = await import("../src/lib/automations/store");
  const { runDueAutomationRules } = await import("../src/lib/automations/scheduler");
  const { eq } = await import("drizzle-orm");

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
    .values({ id: "p1", workspaceId: "ws", name: "One", key: "ONE", createdBy: "owner", createdAt: now })
    .run();

  const actor = { kind: "user" as const, userId: "owner", displayName: "Owner" };
  const rule = await store.createAutomationRule(
    "ws",
    {
      name: "Nudge due tasks",
      trigger: "task.due_soon:2",
      conditions: [],
      actions: [{ kind: "add_comment", body: "This task is due in 2 days." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  assert.equal(rule.trigger.type, "task.due_soon");
  assert.equal(rule.trigger.days, 2);

  const runsFor = (ruleId: string) =>
    db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, ruleId)).all();
  const commentsFor = (issueId: string) =>
    db.select().from(schema.comments).where(eq(schema.comments.issueId, issueId)).all();

  // --- exact boundary ---------------------------------------------------------------
  const task = await issues.createIssue(
    "ws",
    { title: "Due in two days", project: "ONE", dueDate: "2030-01-10" },
    actor
  );
  assert.equal(await runDueAutomationRules(day(2030, 1, 7)), 0, "three days out is not the window");
  assert.equal(await runDueAutomationRules(day(2030, 1, 9)), 0, "one day out is not the window");
  assert.equal(runsFor(rule.id).length, 0);
  assert.equal(await runDueAutomationRules(day(2030, 1, 8)), 1, "two days out is the window");
  assert.equal(runsFor(rule.id).length, 1);
  assert.equal(runsFor(rule.id)[0].status, "success");
  assert.ok(runsFor(rule.id)[0].idempotencyKey.startsWith("due:"));
  assert.equal(commentsFor(task.issue.id).length, 1);
  assert.equal(commentsFor(task.issue.id)[0].body, "This task is due in 2 days.");
  assert.equal(await runDueAutomationRules(day(2030, 1, 8)), 1, "the task is still considered");

  // --- restart safety: a second tick and a new process both dedupe -------------------
  await runDueAutomationRules(day(2030, 1, 8));
  await runDueAutomationRules(day(2030, 1, 8));
  assert.equal(runsFor(rule.id).length, 1, "a repeated tick must not run the rule twice");
  assert.equal(commentsFor(task.issue.id).length, 1);

  // On the due date itself the two-day window has passed.
  assert.equal(await runDueAutomationRules(day(2030, 1, 10)), 0);
  assert.equal(runsFor(rule.id).length, 1);

  // --- finished and deleted tasks are skipped --------------------------------------
  await issues.createIssue(
    "ws",
    { title: "Already done", project: "ONE", dueDate: "2030-02-10", status: "done" },
    actor
  );
  assert.equal(await runDueAutomationRules(day(2030, 2, 8)), 0);
  assert.equal(runsFor(rule.id).length, 1);

  const trashed = await issues.createIssue(
    "ws",
    { title: "In the trash", project: "ONE", dueDate: "2030-03-10" },
    actor
  );
  await db
    .update(schema.issues)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(schema.issues.id, trashed.issue.id));
  assert.equal(await runDueAutomationRules(day(2030, 3, 8)), 0);
  assert.equal(runsFor(rule.id).length, 1);

  // --- a disabled rule never runs ---------------------------------------------------
  await store.setAutomationRuleEnabled("ws", rule.id, false, { id: "owner", displayName: "Owner" });
  await issues.createIssue("ws", { title: "While off", project: "ONE", dueDate: "2030-04-10" }, actor);
  assert.equal(await runDueAutomationRules(day(2030, 4, 8)), 0);
  assert.equal(runsFor(rule.id).length, 1);
  await store.setAutomationRuleEnabled("ws", rule.id, true, { id: "owner", displayName: "Owner" });

  // --- two concurrent ticks cannot double-run one (rule, task, due date) ------------
  const first = await issues.createIssue(
    "ws",
    { title: "Concurrent one", project: "ONE", dueDate: "2030-05-10" },
    actor
  );
  const second = await issues.createIssue(
    "ws",
    { title: "Concurrent two", project: "ONE", dueDate: "2030-05-10" },
    actor
  );
  const before = runsFor(rule.id).length;
  await Promise.all([
    runDueAutomationRules(day(2030, 5, 8)),
    runDueAutomationRules(day(2030, 5, 8)),
  ]);
  assert.equal(runsFor(rule.id).length, before + 2, "one run per task, even with two ticks");
  assert.equal(commentsFor(first.issue.id).length, 1);
  assert.equal(commentsFor(second.issue.id).length, 1);
  await runDueAutomationRules(day(2030, 5, 8));
  assert.equal(runsFor(rule.id).length, before + 2, "a later tick after the race is ignored");

  // --- a different lead time uses its own boundary ---------------------------------
  const fiveDayRule = await store.createAutomationRule(
    "ws",
    {
      name: "Nudge five days out",
      trigger: "task.due_soon:5",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Five days left." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await issues.createIssue("ws", { title: "Five days", project: "ONE", dueDate: "2030-06-10" }, actor);
  assert.equal(await runDueAutomationRules(day(2030, 6, 6)), 0, "four days out is outside a five-day rule");
  assert.equal(await runDueAutomationRules(day(2030, 6, 5)), 1);
  assert.equal(runsFor(fiveDayRule.id).length, 1);
  assert.equal(await runDueAutomationRules(day(2030, 6, 5)), 1);
  assert.equal(runsFor(fiveDayRule.id).length, 1);

  console.log("check-automation-scheduler: pass");
}

main().catch((err) => {
  console.error("check-automation-scheduler: fail -", err instanceof Error ? err.stack : err);
  process.exit(1);
});
