// #80: persistence and permissions for automation rules, runs and configuration history.
// The evaluator/actions live elsewhere; this module knows the database and the workspace.
import crypto from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automationAudit,
  automationRuns,
  automationRules,
  projects,
  users,
  workspaceAgents,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  normalizeAutomationRuleInput,
  parseAutomationTrigger,
  type AutomationAction,
  type AutomationActionResult,
  type AutomationCondition,
  type AutomationEvent,
  type AutomationRunStatus,
  type AutomationTriggerSpec,
  type AutomationTriggerType,
} from "./shared";
import { TacosError } from "@/lib/tacos-error";

type RuleRow = typeof automationRules.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;

export type AutomationRuleView = {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTriggerSpec;
  triggerText: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  lastRunAt: string | null;
  version: number;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunView = {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTriggerSpec;
  triggerText: string;
  status: AutomationRunStatus;
  actionResults: AutomationActionResult[];
  error: string | null;
  durationMs: number;
  triggeredBy: string | null;
  triggeredByName: string;
  eventType: AutomationTriggerType | string;
  issueId: string | null;
  issueIdentifier: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type AutomationAuditView = {
  id: string;
  ruleId: string;
  ruleName: string;
  action: string;
  actorId: string;
  actorName: string;
  createdAt: string;
};

export type AutomationSettingsView = {
  canManage: boolean;
  rules: AutomationRuleView[];
  runs: AutomationRunView[];
  audit: AutomationAuditView[];
};

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const value = JSON.parse(raw) as T;
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function triggerOf(value: string): AutomationTriggerSpec {
  return parseAutomationTrigger(value) ?? { type: "task.created", days: null };
}

async function memberNames(workspaceId: string): Promise<Map<string, string>> {
  const rows = await getDb()
    .select({ id: users.id, displayName: users.displayName })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

export async function isAutomationManager(workspaceId: string, userId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ role: workspaceMembers.role, createdBy: workspaces.createdBy })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        sql`${workspaces.deletedAt} IS NULL`
      )
    )
    .limit(1);
  if (!row) return false;
  return row.role === "admin" || row.createdBy === userId;
}

export async function assertAutomationManager(workspaceId: string, userId: string): Promise<void> {
  if (!(await isAutomationManager(workspaceId, userId))) {
    throw new TacosError("Only the workspace owner or an admin can manage automations", 403);
  }
}

function toRuleView(row: RuleRow, names: Map<string, string>): AutomationRuleView {
  const trigger = triggerOf(row.trigger);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    enabled: row.enabled === 1,
    trigger,
    triggerText: row.trigger,
    conditions: parseJson<AutomationCondition[]>(row.conditions, []),
    actions: parseJson<AutomationAction[]>(row.actions, []),
    lastRunAt: row.lastRunAt ?? null,
    version: row.version,
    createdBy: row.createdBy,
    createdByName: names.get(row.createdBy) ?? "Removed member",
    updatedBy: row.updatedBy,
    updatedByName: names.get(row.updatedBy) ?? "Removed member",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRunView(row: RunRow, names: Map<string, string>): AutomationRunView {
  const event = parseJson<Partial<AutomationEvent>>(row.event, {});
  const trigger = triggerOf(row.trigger);
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName || "Deleted rule",
    trigger,
    triggerText: row.trigger,
    status: (row.status as AutomationRunStatus) ?? "failed",
    actionResults: parseJson<AutomationActionResult[]>(row.actionResults, []),
    error: row.error ?? null,
    durationMs: row.durationMs,
    triggeredBy: row.triggeredBy ?? null,
    triggeredByName:
      (row.triggeredBy ? names.get(row.triggeredBy) : null) ??
      (typeof event.actorName === "string" && event.actorName ? event.actorName : "Automation"),
    eventType: typeof event.type === "string" ? event.type : trigger.type,
    issueId: typeof event.issueId === "string" ? event.issueId : null,
    issueIdentifier: typeof event.issueIdentifier === "string" ? event.issueIdentifier : null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt ?? null,
  };
}

/** Everything Settings › Automations renders. Members see enabled rules and their own runs. */
export async function getAutomationSettingsView(
  workspaceId: string,
  viewerId: string
): Promise<AutomationSettingsView> {
  const canManage = await isAutomationManager(workspaceId, viewerId);
  const db = getDb();
  const names = await memberNames(workspaceId);
  const ruleRows = await db
    .select()
    .from(automationRules)
    .where(
      canManage
        ? eq(automationRules.workspaceId, workspaceId)
        : and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.enabled, 1))
    )
    .orderBy(desc(automationRules.createdAt));
  const runRows = await db
    .select()
    .from(automationRuns)
    .where(
      canManage
        ? eq(automationRuns.workspaceId, workspaceId)
        : and(eq(automationRuns.workspaceId, workspaceId), eq(automationRuns.triggeredBy, viewerId))
    )
    .orderBy(desc(automationRuns.createdAt))
    .limit(40);
  const auditRows = canManage
    ? await db
        .select()
        .from(automationAudit)
        .where(eq(automationAudit.workspaceId, workspaceId))
        .orderBy(desc(automationAudit.createdAt))
        .limit(12)
    : [];
  return {
    canManage,
    rules: ruleRows.map((row) => toRuleView(row, names)),
    runs: runRows.map((row) => toRunView(row, names)),
    audit: auditRows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      action: row.action,
      actorId: row.actorId,
      actorName: names.get(row.actorId) ?? "Removed member",
      createdAt: row.createdAt,
    })),
  };
}

/** One rule for the editor/dry-run, only if this workspace owns it. */
export async function getAutomationRule(workspaceId: string, ruleId: string): Promise<AutomationRuleView | null> {
  const [row] = await getDb()
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.id, ruleId)))
    .limit(1);
  if (!row) return null;
  return toRuleView(row, await memberNames(workspaceId));
}

async function assertReferences(
  workspaceId: string,
  conditions: AutomationCondition[],
  actions: AutomationAction[]
): Promise<void> {
  const db = getDb();
  const projectIds = new Set<string>();
  const userIds = new Set<string>();
  const agentIds = new Set<string>();
  for (const condition of conditions) {
    if (condition.kind === "project") projectIds.add(condition.projectId);
  }
  for (const action of actions) {
    if (action.kind === "set_assignees") for (const id of action.assigneeIds) userIds.add(id);
    if (action.kind === "notify_users") for (const id of action.userIds) userIds.add(id);
    if (action.kind === "delegate_agent") agentIds.add(action.agentId);
  }
  if (projectIds.size > 0) {
    const found = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(projects.id, [...projectIds]),
          sql`${projects.deletedAt} IS NULL`
        )
      );
    if (found.length !== projectIds.size) throw new TacosError("A chosen project is no longer available", 400);
  }
  if (userIds.size > 0) {
    const found = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, [...userIds])));
    if (found.length !== userIds.size) throw new TacosError("A chosen person is not a member of this workspace", 400);
  }
  if (agentIds.size > 0) {
    const found = await db
      .select({ id: workspaceAgents.id })
      .from(workspaceAgents)
      .where(
        and(
          eq(workspaceAgents.workspaceId, workspaceId),
          eq(workspaceAgents.personal, 0),
          inArray(workspaceAgents.id, [...agentIds])
        )
      );
    if (found.length !== agentIds.size) {
      throw new TacosError("Choose a shared workspace agent for the delegation action", 400);
    }
  }
}

function auditSnapshot(view: AutomationRuleView) {
  return JSON.stringify({
    name: view.name,
    enabled: view.enabled,
    trigger: view.triggerText,
    conditions: view.conditions,
    actions: view.actions,
    version: view.version,
  });
}

async function writeAudit(input: {
  workspaceId: string;
  ruleId: string;
  ruleName: string;
  action: string;
  actorId: string;
  before?: string | null;
  after?: string | null;
}) {
  await getDb().insert(automationAudit).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    action: input.action,
    actorId: input.actorId,
    before: input.before ?? null,
    after: input.after ?? null,
    createdAt: nowIso(),
  });
}

export type AutomationActor = { id: string; displayName: string };

export async function createAutomationRule(
  workspaceId: string,
  input: { name?: unknown; trigger?: unknown; conditions?: unknown; actions?: unknown },
  actor: AutomationActor
): Promise<AutomationRuleView> {
  await assertAutomationManager(workspaceId, actor.id);
  const normalized = normalizeAutomationRuleInput(input);
  await assertReferences(workspaceId, normalized.conditions, normalized.actions);
  const now = nowIso();
  const id = crypto.randomUUID();
  await getDb().insert(automationRules).values({
    id,
    workspaceId,
    name: normalized.name,
    enabled: 1,
    createdBy: actor.id,
    updatedBy: actor.id,
    trigger: normalized.trigger,
    conditions: JSON.stringify(normalized.conditions),
    actions: JSON.stringify(normalized.actions),
    lastRunAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const view = await getAutomationRule(workspaceId, id);
  if (!view) throw new TacosError("Could not save the rule", 500);
  await writeAudit({
    workspaceId,
    ruleId: id,
    ruleName: view.name,
    action: "created",
    actorId: actor.id,
    after: auditSnapshot(view),
  });
  return view;
}

export async function updateAutomationRule(
  workspaceId: string,
  ruleId: string,
  input: { name?: unknown; trigger?: unknown; conditions?: unknown; actions?: unknown },
  actor: AutomationActor
): Promise<AutomationRuleView> {
  await assertAutomationManager(workspaceId, actor.id);
  const before = await getAutomationRule(workspaceId, ruleId);
  if (!before) throw new TacosError("Rule not found", 404);
  const normalized = normalizeAutomationRuleInput(input);
  await assertReferences(workspaceId, normalized.conditions, normalized.actions);
  await getDb()
    .update(automationRules)
    .set({
      name: normalized.name,
      trigger: normalized.trigger,
      conditions: JSON.stringify(normalized.conditions),
      actions: JSON.stringify(normalized.actions),
      updatedBy: actor.id,
      updatedAt: nowIso(),
      version: before.version + 1,
    })
    .where(and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.id, ruleId)));
  const after = await getAutomationRule(workspaceId, ruleId);
  if (!after) throw new TacosError("Rule not found", 404);
  await writeAudit({
    workspaceId,
    ruleId,
    ruleName: after.name,
    action: "updated",
    actorId: actor.id,
    before: auditSnapshot(before),
    after: auditSnapshot(after),
  });
  return after;
}

export async function setAutomationRuleEnabled(
  workspaceId: string,
  ruleId: string,
  enabled: boolean,
  actor: AutomationActor
): Promise<AutomationRuleView> {
  await assertAutomationManager(workspaceId, actor.id);
  const before = await getAutomationRule(workspaceId, ruleId);
  if (!before) throw new TacosError("Rule not found", 404);
  await getDb()
    .update(automationRules)
    .set({ enabled: enabled ? 1 : 0, updatedBy: actor.id, updatedAt: nowIso(), version: before.version + 1 })
    .where(and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.id, ruleId)));
  const after = await getAutomationRule(workspaceId, ruleId);
  if (!after) throw new TacosError("Rule not found", 404);
  await writeAudit({
    workspaceId,
    ruleId,
    ruleName: after.name,
    action: enabled ? "enabled" : "disabled",
    actorId: actor.id,
    before: auditSnapshot(before),
    after: auditSnapshot(after),
  });
  return after;
}

export async function deleteAutomationRule(
  workspaceId: string,
  ruleId: string,
  actor: AutomationActor
): Promise<void> {
  await assertAutomationManager(workspaceId, actor.id);
  const before = await getAutomationRule(workspaceId, ruleId);
  if (!before) throw new TacosError("Rule not found", 404);
  await getDb()
    .delete(automationRules)
    .where(and(eq(automationRules.workspaceId, workspaceId), eq(automationRules.id, ruleId)));
  // Runs stay: the log is history, and rule_name is stored on each row.
  await writeAudit({
    workspaceId,
    ruleId,
    ruleName: before.name,
    action: "deleted",
    actorId: actor.id,
    before: auditSnapshot(before),
  });
}

// --- evaluator helpers -----------------------------------------------------

function triggerCondition(trigger: string) {
  return or(
    eq(automationRules.trigger, trigger),
    sql`${automationRules.trigger} LIKE ${`${trigger}:%`}`
  );
}

/** A cheap pre-check so an event with no rule does not load task detail. */
export async function hasEnabledAutomationRules(
  workspaceId: string,
  trigger: AutomationTriggerType
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.enabled, 1),
        triggerCondition(trigger)
      )
    )
    .limit(1);
  return Boolean(row);
}

export async function listEnabledAutomationRules(
  workspaceId: string,
  trigger: AutomationTriggerType
): Promise<AutomationRuleView[]> {
  const rows = await getDb()
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.workspaceId, workspaceId),
        eq(automationRules.enabled, 1),
        triggerCondition(trigger)
      )
    )
    .orderBy(automationRules.createdAt);
  const names = await memberNames(workspaceId);
  return rows.map((row) => toRuleView(row, names));
}

/** Every due-trigger rule, grouped by workspace, for the scheduler. */
export async function listDueAutomationRules(): Promise<AutomationRuleView[]> {
  const rows = await getDb()
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, 1), sql`${automationRules.trigger} LIKE 'task.due_soon:%'`));
  const byWorkspace = new Map<string, RuleRow[]>();
  for (const row of rows) {
    const list = byWorkspace.get(row.workspaceId) ?? [];
    list.push(row);
    byWorkspace.set(row.workspaceId, list);
  }
  const out: AutomationRuleView[] = [];
  for (const [workspaceId, list] of byWorkspace) {
    const names = await memberNames(workspaceId);
    for (const row of list) out.push(toRuleView(row, names));
  }
  return out;
}

/**
 * Reserves one run row for (rule, key). A duplicate key returns null, which is how a
 * scheduler restart or a retried event avoids a second execution.
 */
export async function claimAutomationRun(input: {
  workspaceId: string;
  rule: AutomationRuleView;
  event: AutomationEvent;
  idempotencyKey: string;
}): Promise<string | null> {
  const id = crypto.randomUUID();
  const result = await getDb()
    .insert(automationRuns)
    .values({
      id,
      workspaceId: input.workspaceId,
      ruleId: input.rule.id,
      ruleName: input.rule.name,
      trigger: input.rule.triggerText,
      event: JSON.stringify(input.event),
      status: "running",
      actionResults: "[]",
      error: null,
      durationMs: 0,
      idempotencyKey: input.idempotencyKey,
      triggeredBy: input.event.actorUserId ?? null,
      createdAt: nowIso(),
      finishedAt: null,
    })
    .onConflictDoNothing()
    .run();
  return result.changes > 0 ? id : null;
}

export async function finishAutomationRun(
  runId: string,
  result: {
    status: AutomationRunStatus;
    actionResults: AutomationActionResult[];
    error: string | null;
    durationMs: number;
  }
): Promise<void> {
  await getDb()
    .update(automationRuns)
    .set({
      status: result.status,
      actionResults: JSON.stringify(result.actionResults),
      error: result.error,
      durationMs: result.durationMs,
      finishedAt: nowIso(),
    })
    .where(eq(automationRuns.id, runId));
}

export async function touchAutomationRuleLastRun(ruleId: string): Promise<void> {
  await getDb()
    .update(automationRules)
    .set({ lastRunAt: nowIso() })
    .where(eq(automationRules.id, ruleId));
}

/** The newest run of one rule, for the dry-run's "use the last event" path. */
export async function latestAutomationRun(workspaceId: string, ruleId: string): Promise<AutomationRunView | null> {
  const [row] = await getDb()
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.workspaceId, workspaceId), eq(automationRuns.ruleId, ruleId)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);
  if (!row) return null;
  return toRunView(row, await memberNames(workspaceId));
}

/**
 * The event of a rule's newest run, or of one named run. Settings › Automations uses it
 * for "dry-run the last matching event" without re-reading the task history.
 */
export async function automationRunEvent(
  workspaceId: string,
  ruleId: string,
  runId?: string | null
): Promise<AutomationEvent | null> {
  const rows = await getDb()
    .select({ event: automationRuns.event })
    .from(automationRuns)
    .where(
      runId
        ? and(
            eq(automationRuns.workspaceId, workspaceId),
            eq(automationRuns.ruleId, ruleId),
            eq(automationRuns.id, runId)
          )
        : and(eq(automationRuns.workspaceId, workspaceId), eq(automationRuns.ruleId, ruleId))
    )
    .orderBy(desc(automationRuns.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  return parseJson<AutomationEvent | null>(rows[0].event, null);
}

/** Display names for condition/action summaries. */
export async function automationNameMaps(
  workspaceId: string
): Promise<{ projects: Record<string, string>; members: Record<string, string>; agents: Record<string, string> }> {
  const db = getDb();
  const [projectRows, memberRows, agentRows] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.workspaceId, workspaceId)),
    memberNames(workspaceId),
    db
      .select({ id: workspaceAgents.id, name: workspaceAgents.name })
      .from(workspaceAgents)
      .where(and(eq(workspaceAgents.workspaceId, workspaceId), eq(workspaceAgents.personal, 0))),
  ]);
  return {
    projects: Object.fromEntries(projectRows.map((row) => [row.id, row.name])),
    members: Object.fromEntries(memberRows),
    agents: Object.fromEntries(agentRows.map((row) => [row.id, row.name])),
  };
}
