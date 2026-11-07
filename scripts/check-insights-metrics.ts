/**
 * U-02: hand-computed Insights fixture.
 *
 * Times are built around a workspace display timezone (America/Los_Angeles) so the
 * test proves that day boundaries do not shift counts. Every expected number below is
 * calculated by hand in the comments next to it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-insights-"));
process.env.TACOS_SEED_DEMO = "0";
process.env.TACOS_TIMEZONE = "America/Los_Angeles";

const approx = (actual: number | null, expected: number, message: string, epsilon = 0.001) => {
  assert.notEqual(actual, null, `${message}: expected ${expected}, got null`);
  assert.ok(
    Math.abs((actual as number) - expected) <= epsilon,
    `${message}: expected ${expected}, got ${actual}`
  );
};

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const insights = await import("../src/lib/insights");

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
      { id: "p2", workspaceId: "ws", name: "Other", key: "OTHER", createdBy: "owner", createdAt: now },
    ])
    .run();
  db.insert(schema.labels)
    .values({ id: "label-bug", workspaceId: "ws", name: "bug", createdAt: now })
    .run();
  db.insert(schema.workspaceAgents)
    .values({
      id: "ag1",
      workspaceId: "ws",
      name: "Builder",
      source: "api",
      createdBy: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.cycles)
    .values({
      id: "c1",
      workspaceId: "ws",
      number: 1,
      name: "Cycle 1",
      startsAt: "2026-01-05",
      endsAt: "2026-01-18",
      status: "active",
      createdAt: now,
    })
    .run();
  db.insert(schema.projectMilestones)
    .values({
      id: "m1",
      workspaceId: "ws",
      projectId: "p1",
      name: "First release",
      targetDate: "2026-01-10",
      position: 0,
      createdBy: "owner",
      createdAt: now,
    })
    .run();

  const baseIssue = {
    workspaceId: "ws",
    number: 0,
    identifier: "",
    title: "",
    status: "todo",
    priority: 0,
    createdVia: "web",
    position: 0,
    reviewStatus: "approved",
  };
  const issue = (partial: Record<string, unknown>) => ({
    ...baseIssue,
    id: String(partial.id),
    identifier: String(partial.identifier),
    title: String(partial.title ?? partial.identifier),
    projectId: String(partial.projectId ?? "p1"),
    number: Number(partial.number ?? 0),
    status: String(partial.status ?? "todo"),
    createdAt: String(partial.createdAt),
    updatedAt: String(partial.updatedAt ?? partial.createdAt),
    ...partial,
  });
  db.insert(schema.issues)
    .values([
      // CORE-1: created Jan 5 00:00 PST, started Jan 6, done Jan 8.
      issue({
        id: "t1",
        identifier: "CORE-1",
        number: 1,
        projectId: "p1",
        status: "done",
        createdAt: "2026-01-05T08:00:00.000Z",
        updatedAt: "2026-01-08T08:00:00.000Z",
        estimate: 2,
        cycleId: "c1",
        milestoneId: "m1",
        createdBy: "owner",
      }),
      // CORE-2: created Jan 6, started Jan 7, done Jan 10; delegated, reviewed.
      issue({
        id: "t2",
        identifier: "CORE-2",
        number: 2,
        projectId: "p1",
        status: "done",
        createdAt: "2026-01-06T17:00:00.000Z",
        updatedAt: "2026-01-10T17:00:00.000Z",
        estimate: 1,
        delegatedAgentId: "ag1",
        delegatedBy: "owner",
        cycleId: "c1",
        createdBy: "owner",
      }),
      // CORE-3: canceled Jan 12. Counted separately, never in a time sample.
      issue({
        id: "t3",
        identifier: "CORE-3",
        number: 3,
        projectId: "p1",
        status: "canceled",
        createdAt: "2026-01-09T17:00:00.000Z",
        updatedAt: "2026-01-12T17:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-4: created before the range, done inside it (lead 13d, cycle 12d).
      issue({
        id: "t4",
        identifier: "CORE-4",
        number: 4,
        projectId: "p1",
        status: "done",
        createdAt: "2026-01-02T17:00:00.000Z",
        updatedAt: "2026-01-15T17:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-5: a subtask still in progress; it has the only open blocker.
      issue({
        id: "t5",
        identifier: "CORE-5",
        number: 5,
        projectId: "p1",
        status: "in_progress",
        parentId: "t1",
        createdAt: "2026-01-10T17:00:00.000Z",
        updatedAt: "2026-01-12T09:00:00.000Z",
        estimate: 3,
        delegatedAgentId: "ag1",
        delegatedBy: "owner",
        cycleId: "c1",
        milestoneId: "m1",
        createdBy: "owner",
      }),
      // OTHER-1: created Jan 16, done Jan 17 without an in_progress step (lead only).
      issue({
        id: "t6",
        identifier: "OTHER-1",
        number: 1,
        projectId: "p2",
        status: "done",
        createdAt: "2026-01-16T17:00:00.000Z",
        updatedAt: "2026-01-17T17:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-6 is deleted: it must not appear anywhere.
      issue({
        id: "t7",
        identifier: "CORE-6",
        number: 6,
        projectId: "p1",
        status: "done",
        createdAt: "2026-01-07T17:00:00.000Z",
        updatedAt: "2026-01-08T17:00:00.000Z",
        deletedAt: "2026-01-09T00:00:00.000Z",
        createdBy: "owner",
      }),
      // OTHER-2: Jan 5 07:30Z is Jan 4 23:30 in Los Angeles — the timezone probe.
      issue({
        id: "t8",
        identifier: "OTHER-2",
        number: 2,
        projectId: "p2",
        status: "done",
        createdAt: "2026-01-05T07:30:00.000Z",
        updatedAt: "2026-01-06T08:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-7 is created exactly at the next day's boundary: outside the range.
      issue({
        id: "t9",
        identifier: "CORE-7",
        number: 7,
        projectId: "p1",
        status: "todo",
        createdAt: "2026-01-19T08:00:00.000Z",
        updatedAt: "2026-01-19T08:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-8 has no events at all; completion falls back to updated_at.
      issue({
        id: "t10",
        identifier: "CORE-8",
        number: 8,
        projectId: "p1",
        status: "done",
        createdAt: "2026-01-13T08:00:00.000Z",
        updatedAt: "2026-01-14T08:00:00.000Z",
        createdBy: "owner",
      }),
      // CORE-9 existed before the range and is still open, so it counts as WIP.
      issue({
        id: "t11",
        identifier: "CORE-9",
        number: 9,
        projectId: "p1",
        status: "in_progress",
        createdAt: "2026-01-04T08:00:00.000Z",
        updatedAt: "2026-01-04T08:00:00.000Z",
        estimate: 5,
        createdBy: "owner",
      }),
    ])
    .run();

  db.insert(schema.issueAssignees)
    .values([
      { issueId: "t1", userId: "owner", createdAt: now },
      { issueId: "t2", userId: "member", createdAt: now },
      { issueId: "t3", userId: "member", createdAt: now },
      { issueId: "t4", userId: "owner", createdAt: now },
      { issueId: "t5", userId: "member", createdAt: now },
      { issueId: "t6", userId: "owner", createdAt: now },
      { issueId: "t7", userId: "owner", createdAt: now },
      { issueId: "t8", userId: "member", createdAt: now },
      { issueId: "t9", userId: "owner", createdAt: now },
      { issueId: "t10", userId: "owner", createdAt: now },
      { issueId: "t11", userId: "owner", createdAt: now },
    ])
    .run();
  db.insert(schema.issueLabels)
    .values([
      { issueId: "t1", labelId: "label-bug" },
      { issueId: "t5", labelId: "label-bug" },
    ])
    .run();

  const statusEvent = (id: string, issueId: string, at: string, to: string, from = "todo") => ({
    id,
    issueId,
    type: "status_changed",
    data: JSON.stringify({ from, to }),
    createdAt: at,
    workspaceId: "ws",
    objectType: "task",
    objectId: issueId,
    projectId: "p1",
    visibility: "project",
  });
  const reviewEvent = (id: string, issueId: string, type: string, at: string) => ({
    id,
    issueId,
    type,
    data: "{}",
    createdAt: at,
    workspaceId: "ws",
    objectType: "task",
    objectId: issueId,
    projectId: "p1",
    visibility: "project",
  });
  db.insert(schema.events)
    .values([
      statusEvent("e1", "t1", "2026-01-06T08:00:00.000Z", "in_progress"),
      statusEvent("e2", "t1", "2026-01-08T08:00:00.000Z", "done", "in_progress"),
      statusEvent("e3", "t2", "2026-01-07T17:00:00.000Z", "in_progress"),
      statusEvent("e4", "t2", "2026-01-10T17:00:00.000Z", "done", "in_progress"),
      statusEvent("e5", "t3", "2026-01-12T17:00:00.000Z", "canceled"),
      statusEvent("e6", "t4", "2026-01-03T17:00:00.000Z", "in_progress"),
      statusEvent("e7", "t4", "2026-01-15T17:00:00.000Z", "done", "in_progress"),
      statusEvent("e8", "t5", "2026-01-11T17:00:00.000Z", "in_progress"),
      statusEvent("e9", "t6", "2026-01-17T17:00:00.000Z", "done"),
      statusEvent("e10", "t8", "2026-01-06T08:00:00.000Z", "done"),
      reviewEvent("e11", "t2", "agent_review_requested", "2026-01-10T17:00:00.000Z"),
      reviewEvent("e12", "t2", "agent_approved", "2026-01-11T05:00:00.000Z"),
      reviewEvent("e13", "t6", "agent_review_requested", "2026-01-16T18:00:00.000Z"),
      reviewEvent("e14", "t6", "agent_approved", "2026-01-17T18:00:00.000Z"),
    ])
    .run();

  db.insert(schema.comments)
    .values([
      {
        id: "cm1",
        issueId: "t2",
        authorId: "owner",
        body: "Approved",
        reviewState: "approve",
        via: "you",
        createdAt: "2026-01-10T20:00:00.000Z",
      },
      {
        id: "cm2",
        issueId: "t5",
        authorId: "owner",
        body: "Please change the copy",
        reviewState: "changes_requested",
        via: "you",
        createdAt: "2026-01-12T09:00:00.000Z",
      },
    ])
    .run();
  db.insert(schema.blockers)
    .values({
      id: "b1",
      issueId: "t5",
      authorId: "member",
      body: "Waiting for design",
      createdAt: "2026-01-12T09:00:00.000Z",
    })
    .run();

  db.insert(schema.agentRuns)
    .values([
      {
        id: "run1",
        userId: "owner",
        workspaceId: "ws",
        issueId: "t2",
        payload: "{}",
        status: "done",
        agentId: "ag1",
        source: "api",
        reviewStatus: "approved",
        model: "model-a",
        createdAt: "2026-01-10T16:00:00.000Z",
        finishedAt: "2026-01-10T17:00:00.000Z",
      },
      {
        id: "run2",
        userId: "owner",
        workspaceId: "ws",
        issueId: "t5",
        payload: "{}",
        status: "failed",
        agentId: "ag1",
        source: "runner",
        reviewStatus: null,
        model: "model-b",
        createdAt: "2026-01-12T08:00:00.000Z",
        finishedAt: "2026-01-12T08:10:00.000Z",
      },
    ])
    .run();
  db.insert(schema.agentUsage)
    .values([
      {
        id: "u1",
        workspaceId: "ws",
        runId: "run1",
        issueId: "t2",
        agentId: "ag1",
        userId: "owner",
        engine: "api",
        model: "model-a",
        source: "api",
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 10,
        reasoningTokens: 5,
        durationMs: 1000,
        createdAt: "2026-01-10T16:30:00.000Z",
      },
      {
        id: "u2",
        workspaceId: "ws",
        runId: "run2",
        issueId: "t5",
        agentId: null,
        userId: "owner",
        engine: "codex",
        model: "",
        source: "runner",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        reasoningTokens: 0,
        durationMs: 500,
        createdAt: "2026-01-12T08:05:00.000Z",
      },
    ])
    .run();

  db.insert(schema.automationRuns)
    .values([
      {
        id: "ar1",
        workspaceId: "ws",
        ruleId: "rule1",
        ruleName: "Notify owner",
        trigger: "task.created",
        event: JSON.stringify({ id: "x", type: "task.created", workspaceId: "ws", issueId: "t1", actorName: "Owner", occurredAt: "2026-01-05T08:01:00.000Z", data: {} }),
        status: "success",
        actionResults: "[]",
        durationMs: 100,
        idempotencyKey: "k1",
        triggeredBy: "owner",
        createdAt: "2026-01-05T08:01:00.000Z",
        finishedAt: "2026-01-05T08:01:00.100Z",
      },
      {
        id: "ar2",
        workspaceId: "ws",
        ruleId: "rule1",
        ruleName: "Notify owner",
        trigger: "task.status_changed",
        event: JSON.stringify({ id: "y", type: "task.status_changed", workspaceId: "ws", issueId: "t2", actorName: "Owner", occurredAt: "2026-01-10T17:00:00.000Z", data: {} }),
        status: "failed",
        actionResults: "[]",
        durationMs: 300,
        idempotencyKey: "k2",
        triggeredBy: "owner",
        createdAt: "2026-01-10T17:00:01.000Z",
        finishedAt: "2026-01-10T17:00:01.300Z",
      },
    ])
    .run();

  // --- timezone plumbing ---------------------------------------------------------
  assert.equal(
    insights.zoneDayStart("2026-01-05", "America/Los_Angeles"),
    "2026-01-05T08:00:00.000Z",
    "PST midnight is 08:00Z"
  );
  assert.equal(
    insights.zoneDayStart("2026-03-09", "America/Los_Angeles"),
    "2026-03-09T07:00:00.000Z",
    "after DST, PDT midnight is 07:00Z"
  );
  assert.equal(insights.zoneDayOf("2026-01-05T07:30:00.000Z", "America/Los_Angeles"), "2026-01-04");

  // --- main hand-computed range --------------------------------------------------
  const data = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-18" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );

  // Created: t1, t2, t3, t5, t6, t10 = 6 (t4/t8/t11 are older; t9 is on the next day;
  // t7 is deleted). Completed: t1, t2, t4, t6, t8, t10 = 6. Canceled: t3 = 1.
  assert.equal(data.metrics.created, 6, "created counts flow events inside the range");
  assert.equal(data.metrics.completed, 6, "completed counts done transitions inside the range");
  assert.equal(data.metrics.canceled, 1, "canceled is separate");
  assert.equal(data.metrics.wip, 2, "WIP at the end: CORE-5 and the older open CORE-9");
  assert.equal(data.metrics.leadSample, 6, "canceled and deleted tasks are excluded from lead time");
  assert.equal(data.metrics.cycleSample, 3, "only tasks with a first in_progress have a cycle time");
  approx(data.metrics.leadTimeDays, (1.020833 + 3) / 2, "median lead time (1d, 1d, 1.02d, 3d, 4d, 13d)");
  approx(data.metrics.cycleTimeDays, 3, "median cycle time (2d, 3d, 12d)");
  approx(data.metrics.reviewLatencyHours, 18, "median review latency (12h, 24h)");
  approx(data.metrics.throughputPerWeek, 3, "6 completions in a two-week range");
  approx(data.metrics.delegationCoverage, 1 / 6, "one of six completed tasks was delegated");
  assert.equal(data.metrics.subtaskCreated, 1, "subtasks are counted as their own tasks");
  assert.equal(data.metrics.blockedActive, 1, "one active task is blocked");
  assert.equal(data.metrics.blockersReported, 1);
  assert.equal(data.metrics.reviewApprovals, 1);
  assert.equal(data.metrics.reviewChanges, 1);
  assert.equal(data.partial, true, "a completion without an event marks historical coverage partial");
  assert.ok(
    data.notices.some((notice) => notice.kind === "legacy-completion" && notice.count === 1),
    "the partial-history notice names the fallback completion"
  );

  // Rows are the same tasks the table and CSV show.
  const identifiers = data.rows.map((row) => row.identifier);
  assert.equal(data.rowTotal, 9);
  for (const expected of ["CORE-1", "CORE-2", "CORE-3", "CORE-4", "CORE-5", "CORE-8", "CORE-9", "OTHER-1", "OTHER-2"]) {
    assert.ok(identifiers.includes(expected), `rows include ${expected}`);
  }
  assert.ok(!identifiers.includes("CORE-6"), "deleted tasks never appear");
  assert.ok(!identifiers.includes("CORE-7"), "a task created on the next day is outside the range");

  // Projects: CORE created 5 / completed 4 / canceled 1 / active 2; OTHER completed 2.
  const core = data.projects.find((project) => project.projectId === "p1")!;
  assert.equal(core.created, 5);
  assert.equal(core.completed, 4);
  assert.equal(core.canceled, 1);
  assert.equal(core.active, 2);
  const other = data.projects.find((project) => project.projectId === "p2")!;
  assert.equal(other.created, 1);
  assert.equal(other.completed, 2);

  // Workload by assignee: the active work sits with Member and Owner.
  const member = data.workload.find((row) => row.assigneeId === "member")!;
  assert.equal(member.active, 1);
  assert.equal(member.completed, 2);
  assert.equal(member.estimateActive, 3);
  const owner = data.workload.find((row) => row.assigneeId === "owner")!;
  assert.equal(owner.active, 1, "the pre-range open task is still Owner's workload");
  assert.equal(owner.completed, 4);

  // Cycles and milestones come from the same dataset as the workspace page.
  const cycle = data.cycles.find((row) => row.id === "c1")!;
  assert.equal(cycle.tasks, 3);
  assert.equal(cycle.doneNow, 2);
  assert.equal(cycle.completed, 2);
  assert.equal(cycle.active, 1);
  assert.equal(cycle.estimate, 6);
  assert.equal(cycle.unsized, 0);
  const milestone = data.milestones.find((row) => row.id === "m1")!;
  assert.equal(milestone.tasks, 2);
  assert.equal(milestone.doneNow, 1);
  assert.equal(milestone.active, 1);
  assert.equal(milestone.overdue, 1);

  // Agent panel: two runs, one done and one failed; tokens 110 in + 55 out.
  assert.equal(data.agents.runs, 2);
  assert.equal(data.agents.done, 1);
  assert.equal(data.agents.failed, 1);
  approx(data.agents.completionRate, 0.5, "agent completion rate");
  assert.equal(data.agents.delegatedCompleted, 1);
  assert.equal(data.agents.delegatedActive, 1);
  assert.equal(data.agents.totalTokens, 165);
  assert.equal(data.agents.inputTokens, 110);
  assert.equal(data.agents.outputTokens, 55);
  assert.equal(data.agents.cachedTokens, 10);
  assert.equal(data.agents.reasoningTokens, 5);
  const builder = data.agents.byAgent.find((row) => row.agentId === "ag1")!;
  assert.equal(builder.agentName, "Builder");
  assert.equal(builder.runs, 2);
  assert.equal(builder.totalTokens, 150);
  const direct = data.agents.byAgent.find((row) => row.agentId === null)!;
  assert.equal(direct.agentName, "Direct chat");
  assert.equal(direct.totalTokens, 15);
  assert.equal(data.agents.byModel.length, 2);

  // Automation panel: one success, one failure.
  assert.equal(data.automations.runs, 2);
  assert.equal(data.automations.success, 1);
  assert.equal(data.automations.failed, 1);
  approx(data.automations.failureRate, 0.5, "automation failure rate");
  assert.equal(data.automations.medianDurationMs, 200);
  assert.equal(data.automations.byRule[0].ruleName, "Notify owner");

  // Throughput by week starts on Monday and counts only this range.
  assert.equal(data.weeks[0].weekStart, "2026-01-05");
  assert.equal(data.weeks.reduce((sum, week) => sum + week.completed, 0), 6);
  // Burn-up: 6 creations and 6 completions inside the range, plus the one before it.
  const lastBurnup = data.burnup[data.burnup.length - 1];
  assert.equal(lastBurnup.scope, 9, "scope includes every non-deleted task created to date");
  assert.equal(lastBurnup.completed, 6);
  assert.equal(lastBurnup.canceled, 1);

  // --- filters -------------------------------------------------------------------
  const byProject = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-18", projectId: "p1" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(byProject.metrics.created, 5);
  assert.equal(byProject.metrics.completed, 4);
  assert.equal(byProject.metrics.wip, 2);

  const byAssignee = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-18", assigneeId: "member" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(byAssignee.metrics.created, 3, "CORE-2, CORE-3 and CORE-5");
  assert.equal(byAssignee.metrics.completed, 2, "CORE-2 and OTHER-2");
  assert.equal(byAssignee.metrics.wip, 1);

  const byLabel = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-18", label: "BUG" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(byLabel.metrics.created, 2, "CORE-1 and CORE-5 carry the label");
  assert.equal(byLabel.metrics.completed, 1);

  const activeOnly = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-18", status: "active" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(activeOnly.metrics.created, 1, "only CORE-5 was created in range among active tasks");
  assert.equal(activeOnly.metrics.wip, 2);

  // --- timezone boundaries do not shift counts -----------------------------------
  const losAngelesDay = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-05" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(losAngelesDay.metrics.created, 1, "only CORE-1 was created on Jan 5 in Los Angeles");
  const utcDay = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-05", to: "2026-01-05" },
    { timeZone: "UTC", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(utcDay.metrics.created, 2, "in UTC, OTHER-2 also falls on Jan 5");

  const endDay = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-18", to: "2026-01-18" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(endDay.metrics.created, 0, "CORE-7 at 00:00 on Jan 19 is the next day");
  assert.equal(endDay.metrics.wip, 2, "the existing open tasks are WIP at the end of Jan 18");

  // A backwards range is swapped and a range longer than a year is clamped, not fatal.
  const swapped = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2026-01-18", to: "2026-01-05" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.equal(swapped.filters.from, "2026-01-05");
  assert.ok(swapped.notices.some((notice) => notice.kind === "range-swapped"));
  const clamped = await insights.aggregateInsights(
    "ws",
    "owner",
    { from: "2024-01-01", to: "2026-01-18" },
    { timeZone: "America/Los_Angeles", now: "2026-01-18T12:00:00.000Z" }
  );
  assert.ok(clamped.notices.some((notice) => notice.kind === "range-clamped"));

  console.log("check-insights-metrics: pass (hand-computed fixture, filters, timezone boundaries, CSV source rows)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
