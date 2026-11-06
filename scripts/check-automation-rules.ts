/**
 * #80: internal automation rules. Matching, ordered actions, failures that do not roll
 * back, loop protection, idempotency, dry-run, permissions, notifications and the
 * delegation path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-automation-rules-"));
process.env.TACOS_SEED_DEMO = "0";

const actor = { kind: "user" as const, userId: "owner", displayName: "Owner" };
const memberActor = { kind: "user" as const, userId: "member", displayName: "Member" };

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const issues = await import("../src/lib/issues");
  const pages = await import("../src/lib/pages");
  const store = await import("../src/lib/automations/store");
  const { evaluateAutomationEvent, dryRunAutomationRule } = await import(
    "../src/lib/automations/evaluator"
  );
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
    .values({ id: "p1", workspaceId: "ws", name: "One", key: "ONE", createdBy: "owner", createdAt: now })
    .run();

  const runsFor = (ruleId: string) =>
    db.select().from(schema.automationRuns).where(eq(schema.automationRuns.ruleId, ruleId)).all();
  const commentsOf = (issueId: string) =>
    db.select().from(schema.comments).where(eq(schema.comments.issueId, issueId)).all();
  const notificationsFor = (type: string) =>
    db.select().from(schema.notifications).where(eq(schema.notifications.type, type)).all();

  // --- 1. a rule matches trigger + conditions and runs actions in order -------------
  const matchRule = await store.createAutomationRule(
    "ws",
    {
      name: "Match new urgent bugs",
      trigger: "task.created",
      conditions: [
        { kind: "project", projectId: "p1" },
        { kind: "priority", priority: 2 },
        { kind: "label", label: "Bug" },
        { kind: "text", contains: "urgent" },
        { kind: "status", status: "todo" },
        { kind: "assignee", present: true },
      ],
      actions: [
        { kind: "add_comment", body: "Automation matched this task." },
        { kind: "set_labels", labels: ["Bug", "Triaged"] },
        { kind: "notify_users", userIds: ["owner"], message: "Urgent bug opened." },
      ],
    },
    { id: "owner", displayName: "Owner" }
  );
  assert.equal(matchRule.trigger.type, "task.created");
  assert.equal(matchRule.enabled, true);
  assert.equal(matchRule.version, 1);
  assert.deepEqual(matchRule.actions.map((action) => action.kind), [
    "add_comment",
    "set_labels",
    "notify_users",
  ]);

  const matched = await issues.createIssue(
    "ws",
    {
      title: "Urgent login bug",
      project: "ONE",
      priority: 2,
      labelNames: ["Bug"],
      assigneeIds: ["member"],
    },
    actor
  );
  const runs = runsFor(matchRule.id);
  assert.equal(runs.length, 1, "a matching task runs the rule exactly once");
  assert.equal(runs[0].status, "success");
  assert.equal(runs[0].trigger, "task.created");
  assert.equal(runs[0].triggeredBy, "owner");
  assert.ok(runs[0].durationMs >= 0);
  assert.ok(runs[0].finishedAt);
  const actions = JSON.parse(runs[0].actionResults) as Array<{ kind: string; status: string; attempts: number }>;
  assert.deepEqual(actions.map((action) => action.kind), ["add_comment", "set_labels", "notify_users"]);
  assert.ok(actions.every((action) => action.status === "ok" && action.attempts === 1));
  assert.equal(commentsOf(matched.issue.id).length, 1);
  assert.equal(commentsOf(matched.issue.id)[0].body, "Automation matched this task.");
  const labels = db
    .select({ name: schema.labels.name })
    .from(schema.issueLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.issueLabels.labelId))
    .where(eq(schema.issueLabels.issueId, matched.issue.id))
    .all()
    .map((row) => row.name);
  assert.ok(labels.includes("Triaged"), "the set_labels action landed");
  assert.equal(notificationsFor("automation").length, 1);
  assert.equal(JSON.parse(notificationsFor("automation")[0].data ?? "{}").ruleName, "Match new urgent bugs");

  // --- 2. a non-matching event does nothing ----------------------------------------
  const before = runsFor(matchRule.id).length;
  await issues.createIssue(
    "ws",
    { title: "Ordinary note", project: "ONE", priority: 1 },
    actor
  );
  assert.equal(runsFor(matchRule.id).length, before, "a non-matching task adds no run");

  // --- 3. idempotency: the same (rule, event) cannot run twice ----------------------
  const commentsBefore = commentsOf(matched.issue.id).length;
  const event = {
    id: "evt-idempotent",
    type: "task.created" as const,
    workspaceId: "ws",
    issueId: matched.issue.id,
    issueIdentifier: matched.issue.identifier,
    actorName: "Owner",
    actorUserId: "owner",
    occurredAt: new Date().toISOString(),
    data: {},
    depth: 0,
  };
  await evaluateAutomationEvent(event);
  await evaluateAutomationEvent(event);
  assert.equal(
    runsFor(matchRule.id).length,
    before + 1,
    "the second dispatch of the same event is ignored"
  );
  assert.equal(commentsOf(matched.issue.id).length, commentsBefore + 1);

  // --- 4. dry-run writes nothing ---------------------------------------------------
  const runsBeforeDry = runsFor(matchRule.id).length;
  const commentsBeforeDry = commentsOf(matched.issue.id).length;
  const dry = await dryRunAutomationRule("ws", matchRule.id, { issueId: matched.issue.id });
  assert.equal(dry.matched, true);
  assert.equal(dry.conditions.length, 6);
  assert.ok(dry.conditions.every((condition) => condition.passed));
  assert.equal(dry.actions.length, 3);
  assert.equal(runsFor(matchRule.id).length, runsBeforeDry, "a dry run writes no run row");
  assert.equal(commentsOf(matched.issue.id).length, commentsBeforeDry, "a dry run writes no comment");
  const latest = await store.latestAutomationRun("ws", matchRule.id);
  assert.ok(latest);
  const dryLast = await dryRunAutomationRule("ws", matchRule.id, { runId: latest.id });
  assert.equal(dryLast.matched, true, "the last matching event can be used for a dry run");

  // --- 5. loop protection: a rule never re-enters itself ---------------------------
  const loopRule = await store.createAutomationRule(
    "ws",
    {
      name: "Reply to comments",
      trigger: "task.comment_added",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Automated reply." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await issues.addComment("ws", matched.issue.id, "A human question", memberActor);
  assert.equal(runsFor(loopRule.id).length, 1, "the comment rule runs once");
  const bodies = commentsOf(matched.issue.id).map((comment) => comment.body);
  assert.equal(
    bodies.filter((body) => body === "Automated reply.").length,
    1,
    "its own reply does not trigger it again"
  );

  // --- 6. a failed action is recorded and later actions still run ------------------
  db.insert(schema.workspaceAgents)
    .values([
      {
        id: "agent-disabled",
        workspaceId: "ws",
        name: "Disabled agent",
        description: "",
        source: "api",
        engine: "",
        model: "",
        approval: "ask",
        projectIds: "[]",
        enabled: 0,
        personal: 0,
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "agent-api",
        workspaceId: "ws",
        name: "API agent",
        description: "",
        source: "api",
        engine: "",
        model: "",
        approval: "ask",
        projectIds: "[]",
        enabled: 1,
        personal: 0,
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  const partialRule = await store.createAutomationRule(
    "ws",
    {
      name: "Partial failure",
      trigger: "task.created",
      conditions: [{ kind: "text", contains: "partial-fail" }],
      actions: [
        { kind: "delegate_agent", agentId: "agent-disabled", note: "" },
        { kind: "add_comment", body: "Reached the action after the failure." },
      ],
    },
    { id: "owner", displayName: "Owner" }
  );
  const partialTask = await issues.createIssue(
    "ws",
    { title: "partial-fail task", project: "ONE" },
    actor
  );
  const partialRuns = runsFor(partialRule.id);
  assert.equal(partialRuns.length, 1);
  assert.equal(partialRuns[0].status, "partial");
  const partialActions = JSON.parse(partialRuns[0].actionResults) as Array<{
    status: string;
    error?: string;
  }>;
  assert.equal(partialActions[0].status, "failed");
  assert.match(partialActions[0].error ?? "", /turned off|not available/);
  assert.equal(partialActions[1].status, "ok");
  assert.match(partialRuns[0].error ?? "", /Action 1/);
  assert.ok(
    commentsOf(partialTask.issue.id).some(
      (comment) => comment.body === "Reached the action after the failure."
    ),
    "a failure does not roll back later actions"
  );

  // --- 7. delegation uses the real #79 path ---------------------------------------
  const delegatedHook = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on delegation",
      trigger: "task.delegated",
      conditions: [],
      actions: [{ kind: "add_comment", body: "An agent is on it." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const delegateRule = await store.createAutomationRule(
    "ws",
    {
      name: "Delegate new work",
      trigger: "task.created",
      conditions: [{ kind: "text", contains: "delegate-me" }],
      actions: [{ kind: "delegate_agent", agentId: "agent-api", note: "Start with the tests." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const delegated = await issues.createIssue(
    "ws",
    { title: "delegate-me task", project: "ONE" },
    actor
  );
  const delegatedRuns = runsFor(delegateRule.id);
  assert.equal(delegatedRuns.length, 1);
  assert.equal(delegatedRuns[0].status, "success");
  const [delegatedRow] = await db
    .select()
    .from(schema.issues)
    .where(eq(schema.issues.id, delegated.issue.id));
  assert.equal(delegatedRow.delegatedAgentId, "agent-api", "the task is delegated to the agent");
  assert.ok(delegatedRow.delegationRunId, "a real agent run was created");
  const agentRun = db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.issueId, delegated.issue.id))
    .all();
  assert.ok(agentRun.length >= 1, "the delegation path created a run row");
  const delegatedEvent = db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.issueId, delegated.issue.id), eq(schema.events.type, "agent_delegated")))
    .all();
  assert.equal(delegatedEvent.length, 1, "delegation recorded its attribution event");
  assert.equal(runsFor(delegatedHook.id).length, 1, "the task.delegated trigger ran");

  // --- 7b. the other business-layer hooks ------------------------------------------
  const statusRule = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on done",
      trigger: "task.status_changed",
      conditions: [{ kind: "status", status: "done" }],
      actions: [{ kind: "add_comment", body: "Marked done by a rule." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const hookTask = await issues.createIssue(
    "ws",
    { title: "Hook task", project: "ONE", assigneeIds: ["owner"] },
    actor
  );
  await issues.updateIssue("ws", hookTask.issue.id, { status: "done" }, actor);
  assert.equal(runsFor(statusRule.id).length, 1, "task.status_changed ran after updateIssue");
  const movedTask = await issues.createIssue(
    "ws",
    { title: "Move hook", project: "ONE", assigneeIds: ["owner"] },
    actor
  );
  await issues.moveIssue("ws", movedTask.issue.id, { status: "in_progress" }, actor);
  assert.equal(runsFor(statusRule.id).length, 1, "a non-done move does not match the status condition");

  const assignedRule = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on assignment",
      trigger: "task.assigned",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Assigned." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await issues.createIssue(
    "ws",
    { title: "Assign hook", project: "ONE", assigneeIds: ["member"] },
    actor
  );
  assert.ok(runsFor(assignedRule.id).length >= 1, "task.assigned ran after an assignment");

  const claimRule = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on claim",
      trigger: "task.claimed",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Claimed." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const releaseRule = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on release",
      trigger: "task.released",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Released." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const claimTask = await issues.createIssue(
    "ws",
    { title: "Claim hook", project: "ONE" },
    actor
  );
  await issues.claimIssue("ws", claimTask.issue.id, "owner");
  await issues.releaseIssue("ws", claimTask.issue.id, "owner");
  assert.equal(runsFor(claimRule.id).length, 1, "task.claimed ran after claimIssue");
  assert.equal(runsFor(releaseRule.id).length, 1, "task.released ran after releaseIssue");

  const mentionRule = await store.createAutomationRule(
    "ws",
    {
      name: "Comment on mention",
      trigger: "task.mention",
      conditions: [],
      actions: [{ kind: "add_comment", body: "Mention handled." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await issues.addComment("ws", hookTask.issue.id, "@member please check", actor);
  assert.equal(runsFor(mentionRule.id).length, 1, "task.mention ran after a mention");

  // --- 8. notify_users respects the Inbox preference -------------------------------
  const notifyRule = await store.createAutomationRule(
    "ws",
    {
      name: "Notify member",
      trigger: "task.created",
      conditions: [{ kind: "text", contains: "notify-member" }],
      actions: [{ kind: "notify_users", userIds: ["member"], message: "A task needs you." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await issues.saveNotificationPrefs("ws", "member", { automations: false });
  const countMemberAutomation = () =>
    db
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.type, "automation"), eq(schema.notifications.userId, "member"))
      )
      .all().length;
  await issues.createIssue("ws", { title: "notify-member off", project: "ONE" }, actor);
  assert.equal(countMemberAutomation(), 0, "a disabled automation preference sends nothing");
  await issues.saveNotificationPrefs("ws", "member", { automations: true });
  await issues.createIssue("ws", { title: "notify-member on", project: "ONE" }, actor);
  assert.equal(countMemberAutomation(), 1, "the automation preference controls delivery");
  assert.equal(runsFor(notifyRule.id).length, 2);

  // --- 9. document.updated trigger -------------------------------------------------
  const docRule = await store.createAutomationRule(
    "ws",
    {
      name: "Notify on report edits",
      trigger: "document.updated",
      conditions: [{ kind: "text", contains: "quarterly report" }],
      actions: [{ kind: "notify_users", userIds: ["owner"], message: "The report changed." }],
    },
    { id: "owner", displayName: "Owner" }
  );
  const page = await pages.createPage("ws", "owner", {
    title: "Quarterly report",
    doc: "Draft",
  });
  await pages.updatePage("ws", page.id, "owner", { doc: "Draft v2" });
  assert.equal(runsFor(docRule.id).length, 1, "a document save runs the document rule");
  assert.equal(runsFor(docRule.id)[0].status, "success");

  // --- 10. members cannot create rules; they see enabled rules and their own runs --
  await assert.rejects(
    () =>
      store.createAutomationRule(
        "ws",
        {
          name: "Member rule",
          trigger: "task.created",
          conditions: [],
          actions: [{ kind: "add_comment", body: "no" }],
        },
        { id: "member", displayName: "Member" }
      ),
    /owner or an admin/,
    "a member cannot create a rule"
  );
  const hidden = await store.createAutomationRule(
    "ws",
    {
      name: "Hidden rule",
      trigger: "task.created",
      conditions: [],
      actions: [{ kind: "add_comment", body: "hidden" }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await store.setAutomationRuleEnabled("ws", hidden.id, false, { id: "owner", displayName: "Owner" });
  await issues.createIssue(
    "ws",
    {
      title: "Urgent member bug",
      project: "ONE",
      priority: 2,
      labelNames: ["Bug"],
      assigneeIds: ["member"],
    },
    memberActor
  );
  assert.ok(runsFor(matchRule.id).some((run) => run.triggeredBy === "member"));
  const memberView = await store.getAutomationSettingsView("ws", "member");
  assert.equal(memberView.canManage, false);
  assert.ok(memberView.rules.length > 0);
  assert.ok(memberView.rules.every((rule) => rule.enabled), "members only see enabled rules");
  assert.ok(!memberView.rules.some((rule) => rule.id === hidden.id));
  assert.ok(memberView.runs.every((run) => run.triggeredBy === "member"));
  assert.ok(memberView.runs.some((run) => run.ruleId === matchRule.id));
  const ownerView = await store.getAutomationSettingsView("ws", "owner");
  assert.equal(ownerView.canManage, true);
  assert.ok(ownerView.runs.some((run) => run.triggeredBy === "owner"));
  assert.ok(ownerView.audit.length > 0, "configuration changes are audited");
  await assert.rejects(
    () => store.assertAutomationManager("ws", "member"),
    /owner or an admin/,
    "a member cannot manage rules"
  );
  await store.assertAutomationManager("ws", "owner");

  // --- 11. configuration audit ------------------------------------------------------
  const auditRule = await store.createAutomationRule(
    "ws",
    {
      name: "Audit rule",
      trigger: "task.created",
      conditions: [],
      actions: [{ kind: "add_comment", body: "audit" }],
    },
    { id: "owner", displayName: "Owner" }
  );
  await store.updateAutomationRule(
    "ws",
    auditRule.id,
    { ...auditRule, name: "Audit rule renamed", trigger: "task.created" },
    { id: "owner", displayName: "Owner" }
  );
  await store.setAutomationRuleEnabled("ws", auditRule.id, false, {
    id: "owner",
    displayName: "Owner",
  });
  await store.deleteAutomationRule("ws", auditRule.id, { id: "owner", displayName: "Owner" });
  const auditRows = db
    .select()
    .from(schema.automationAudit)
    .where(eq(schema.automationAudit.ruleId, auditRule.id))
    .all()
    .map((row) => row.action);
  assert.deepEqual(auditRows, ["created", "updated", "disabled", "deleted"]);

  // --- 12. no agent/API/MCP rule-creation surface ----------------------------------
  for (const dir of [path.join(process.cwd(), "src/app/api/v1"), path.join(process.cwd(), "src/app/api/mcp")]) {
    if (!fs.existsSync(dir)) continue;
    const hits = walk(dir).filter((file) => /automation/i.test(fs.readFileSync(file, "utf8")));
    assert.equal(hits.length, 0, `the agent API must not expose automations: ${hits.join(", ")}`);
  }
  const mcp = fs.readFileSync(path.join(process.cwd(), "mcp/create-server.ts"), "utf8");
  assert.ok(!/automation/i.test(mcp), "the MCP server must not expose automations");

  console.log("check-automation-rules: pass");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

main().catch((err) => {
  console.error("check-automation-rules: fail -", err instanceof Error ? err.stack : err);
  process.exit(1);
});
