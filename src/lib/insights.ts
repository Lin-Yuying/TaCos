// U-02: on-demand Insights aggregation over the records TaCos already keeps.
//
// Definitions (accepted in docs/plans/insights.md):
// - Dataset: non-deleted tasks in non-deleted, visible projects; rejected agent
//   drafts are excluded. Subtasks are counted as separate tasks (no roll-up).
// - Created / completed / canceled are flow events inside the selected range.
// - Completed means the latest done transition in the range; canceled is separate
//   and is excluded from lead time, cycle time and review latency.
// - Lead time = creation → latest done transition.
// - Cycle time = first in_progress (or creation when the task starts in progress)
//   → latest done transition. Claiming is not part of cycle time.
// - WIP = tasks whose status at the end of the range is todo or in_progress.
// - Review latency = agent review request (or the creation of an agent-published
//   task) → the first approval after it.
// - Date boundaries are the workspace display timezone (TACOS_TIMEZONE, otherwise
//   the server's zone). Nothing is snapshotted: every request aggregates from the
//   source tables, and a range wider than a year is clamped.
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  agentRuns,
  agentUsage,
  automationRuns,
  blockers,
  comments,
  cycles,
  events,
  issueAssignees,
  issues,
  labels,
  projectMilestones,
  projects,
  users,
  workspaceAgents,
} from "@/db/schema";
import { isAutomationManager } from "@/lib/automations/store";
import { getTaskView } from "@/lib/task-views";
import { listMembers, listProjects } from "@/lib/issues";
import { addDays, eachDay } from "@/lib/planning/dates";
import {
  INSIGHT_MAX_ROWS,
  INSIGHT_MAX_TASKS,
  defaultInsightConfig,
  median,
  normalizeInsightConfig,
  weekStartDay,
  type InsightAgentPanel,
  type InsightAssignee,
  type InsightAutomationPanel,
  type InsightAutomationRuleRow,
  type InsightBurnupPoint,
  type InsightCycleRow,
  type InsightData,
  type InsightMetrics,
  type InsightMilestoneRow,
  type InsightModelRow,
  type InsightNotice,
  type InsightProjectRow,
  type InsightRange,
  type InsightSavedConfig,
  type InsightStatusFilter,
  type InsightTaskRow,
  type InsightTaskStatus,
  type InsightWeekPoint,
  type InsightWorkloadRow,
} from "@/lib/insights.shared";

const STATUSES: InsightTaskStatus[] = ["todo", "in_progress", "done", "canceled"];

const REVIEW_EVENT_TYPES = [
  "status_changed",
  "agent_review_requested",
  "agent_approved",
  "review_approved",
] as const;

const DAY_MS = 86_400_000;

export type AggregateInsightOptions = {
  // Tests pin the zone; the page uses the workspace's configured display zone.
  timeZone?: string;
  now?: string;
  maxTasks?: number;
  maxRows?: number;
};

export type {
  InsightAgentPanel,
  InsightAutomationPanel,
  InsightBurnupPoint,
  InsightCycleRow,
  InsightData,
  InsightMilestoneRow,
  InsightProjectRow,
  InsightRange,
  InsightTaskRow,
  InsightTaskStatus,
  InsightWeekPoint,
  InsightWorkloadRow,
} from "@/lib/insights.shared";

// ---------------------------------------------------------------------------
// Timezone boundaries
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function isValidTimeZone(value: string): boolean {
  try {
    zoneFormatter(value).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The workspace display timezone: one team server runs in one zone. */
export function resolveInsightTimeZone(value?: string): string {
  const candidate = value || process.env.TACOS_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return candidate && isValidTimeZone(candidate) ? candidate : "UTC";
}

function wallClockUtc(iso: string, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
}

/** The calendar day (YYYY-MM-DD) an instant falls on in the display timezone. */
export function zoneDayOf(iso: string, timeZone: string): string {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** The first instant of a calendar day in the display timezone. */
export function zoneDayStart(day: string, timeZone: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  let instant = target;
  // Resolve the zone offset twice; a DST change on this day settles in one step.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = target - (wallClockUtc(new Date(instant).toISOString(), timeZone) - instant);
  }
  // A few zones skip midnight on a DST change. Pick the first instant that is the day.
  if (zoneDayOf(new Date(instant).toISOString(), timeZone) !== day) {
    for (let add = 0; add < 4; add += 1) {
      const candidate = instant + add * 3_600_000;
      if (zoneDayOf(new Date(candidate).toISOString(), timeZone) === day) {
        instant = candidate;
        break;
      }
    }
  }
  return new Date(instant).toISOString();
}

export function zoneRange(from: string, to: string, timeZone: string) {
  return {
    startIso: zoneDayStart(from, timeZone),
    endIso: zoneDayStart(addDays(to, 1), timeZone),
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function emptyMetrics(): InsightMetrics {
  return {
    created: 0,
    completed: 0,
    canceled: 0,
    wip: 0,
    leadTimeDays: null,
    leadSample: 0,
    cycleTimeDays: null,
    cycleSample: 0,
    reviewLatencyHours: null,
    reviewSample: 0,
    throughputPerWeek: 0,
    delegationCoverage: null,
    delegatedCompleted: 0,
    delegatedActive: 0,
    blockedActive: 0,
    blockersReported: 0,
    subtaskCreated: 0,
    reviewApprovals: 0,
    reviewChanges: 0,
  };
}

function emptyAgentPanel(): InsightAgentPanel {
  return {
    available: false,
    usageAvailable: false,
    runs: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    review: 0,
    completionRate: null,
    delegatedCompleted: 0,
    delegatedActive: 0,
    coverage: null,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    byAgent: [],
    byModel: [],
    bySource: [],
  };
}

function emptyAutomationPanel(scopedToViewer: boolean): InsightAutomationPanel {
  return {
    available: false,
    scopedToViewer,
    runs: 0,
    success: 0,
    partial: 0,
    failed: 0,
    running: 0,
    failureRate: null,
    medianDurationMs: null,
    byRule: [],
  };
}

function emptyData(
  range: InsightRange,
  filters: InsightSavedConfig,
  notices: InsightNotice[],
  generatedAt: string,
  automationScoped: boolean
): InsightData {
  return {
    range,
    filters,
    taskFiltersActive: Boolean(
      filters.projectId || filters.assigneeId || filters.label || filters.status !== "all"
    ),
    metrics: emptyMetrics(),
    weeks: [],
    burnup: [],
    workload: [],
    projects: [],
    cycles: [],
    milestones: [],
    agents: emptyAgentPanel(),
    automations: emptyAutomationPanel(automationScoped),
    rows: [],
    rowTotal: 0,
    partial: false,
    notices,
    generatedAt,
  };
}

function asStatus(value: unknown): InsightTaskStatus | null {
  return typeof value === "string" && (STATUSES as string[]).includes(value)
    ? (value as InsightTaskStatus)
    : null;
}

function parseData(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function selectInChunks<T>(ids: string[], run: (chunk: string[]) => T[]): Promise<T[]> {
  const out: T[] = [];
  for (let index = 0; index < ids.length; index += 800) {
    out.push(...run(ids.slice(index, index + 800)));
  }
  return out;
}

export async function aggregateInsights(
  workspaceId: string,
  viewerId: string,
  input: Partial<InsightSavedConfig>,
  options: AggregateInsightOptions = {}
): Promise<InsightData> {
  const db = getDb();
  const timeZone = resolveInsightTimeZone(options.timeZone);
  const generatedAt = options.now ?? new Date().toISOString();
  const today = zoneDayOf(generatedAt, timeZone);
  const { config, notices } = normalizeInsightConfig(input, today);
  const range: InsightRange = { from: config.from, to: config.to, timeZone };
  const bounds = zoneRange(config.from, config.to, timeZone);
  const maxTasks = Math.max(1, options.maxTasks ?? INSIGHT_MAX_TASKS);
  const maxRows = Math.max(1, options.maxRows ?? INSIGHT_MAX_ROWS);
  const canManageAutomations = await isAutomationManager(workspaceId, viewerId);
  const automationScoped = !canManageAutomations;

  const visibleProjects = await listProjects(workspaceId, viewerId);
  if (visibleProjects.length === 0) {
    return emptyData(range, config, notices, generatedAt, automationScoped);
  }
  const visibleProjectIds = visibleProjects.map((project) => project.id);
  const projectById = new Map(visibleProjects.map((project) => [project.id, project]));

  const condition = [
    eq(issues.workspaceId, workspaceId),
    isNull(issues.deletedAt),
    isNull(projects.deletedAt),
    ne(issues.reviewStatus, "rejected"),
    inArray(issues.projectId, visibleProjectIds),
  ];
  if (config.projectId) condition.push(eq(issues.projectId, config.projectId));
  if (config.assigneeId) {
    condition.push(
      sql`(${issues.claimedBy} = ${config.assigneeId} OR EXISTS (SELECT 1 FROM issue_assignees WHERE issue_assignees.issue_id = ${issues.id} AND issue_assignees.user_id = ${config.assigneeId}))`
    );
  }
  if (config.label) {
    const label = db
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.workspaceId, workspaceId),
          sql`${labels.name} = ${config.label} COLLATE NOCASE`
        )
      )
      .get();
    if (!label) return emptyData(range, config, notices, generatedAt, automationScoped);
    condition.push(
      sql`EXISTS (SELECT 1 FROM issue_labels WHERE issue_labels.issue_id = ${issues.id} AND issue_labels.label_id = ${label.id})`
    );
  }
  if (config.status === "active") {
    condition.push(inArray(issues.status, ["todo", "in_progress"]));
  } else if (config.status === "done") {
    condition.push(eq(issues.status, "done"));
  } else if (config.status === "canceled") {
    condition.push(eq(issues.status, "canceled"));
  }

  const issueRows = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      status: issues.status,
      projectId: issues.projectId,
      parentId: issues.parentId,
      createdAt: issues.createdAt,
      updatedAt: issues.updatedAt,
      createdVia: issues.createdVia,
      claimedBy: issues.claimedBy,
      estimate: issues.estimate,
      delegatedAgentId: issues.delegatedAgentId,
      cycleId: issues.cycleId,
      milestoneId: issues.milestoneId,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(...condition))
    .orderBy(desc(issues.createdAt))
    .limit(maxTasks + 1)
    .all();
  const truncated = issueRows.length > maxTasks;
  const scoped = truncated ? issueRows.slice(0, maxTasks) : issueRows;
  if (truncated) notices.push({ kind: "dataset-truncated", limit: maxTasks });

  const ids = scoped.map((row) => row.id);
  const taskFiltersActive = Boolean(
    config.projectId || config.assigneeId || config.label || config.status !== "all"
  );

  const eventRows = ids.length
    ? await selectInChunks(ids, (chunk) =>
        db
          .select({ issueId: events.issueId, type: events.type, data: events.data, createdAt: events.createdAt })
          .from(events)
          .where(and(inArray(events.issueId, chunk), inArray(events.type, [...REVIEW_EVENT_TYPES])))
          .orderBy(asc(events.createdAt))
          .all()
      )
    : [];
  const eventsByIssue = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    const list = eventsByIssue.get(event.issueId) ?? [];
    list.push(event);
    eventsByIssue.set(event.issueId, list);
  }

  const assigneeRows = ids.length
    ? await selectInChunks(ids, (chunk) =>
        db
          .select({
            issueId: issueAssignees.issueId,
            userId: issueAssignees.userId,
            displayName: users.displayName,
            avatar: users.avatar,
          })
          .from(issueAssignees)
          .innerJoin(users, eq(users.id, issueAssignees.userId))
          .where(inArray(issueAssignees.issueId, chunk))
          .all()
      )
    : [];
  const assigneesByIssue = new Map<string, InsightAssignee[]>();
  for (const row of assigneeRows) {
    const list = assigneesByIssue.get(row.issueId) ?? [];
    list.push({ id: row.userId, displayName: row.displayName, avatar: row.avatar ?? null });
    assigneesByIssue.set(row.issueId, list);
  }

  const blockerRows = ids.length
    ? await selectInChunks(ids, (chunk) =>
        db
          .select({ issueId: blockers.issueId, createdAt: blockers.createdAt })
          .from(blockers)
          .where(and(inArray(blockers.issueId, chunk), lt(blockers.createdAt, bounds.endIso)))
          .all()
      )
    : [];
  const blockersByIssue = new Map<string, string[]>();
  for (const row of blockerRows) {
    const list = blockersByIssue.get(row.issueId) ?? [];
    list.push(row.createdAt);
    blockersByIssue.set(row.issueId, list);
  }
  const blockersReported = blockerRows.filter(
    (row) => row.createdAt >= bounds.startIso && row.createdAt < bounds.endIso
  ).length;

  const reviewCommentRows = ids.length
    ? await selectInChunks(ids, (chunk) =>
        db
          .select({ reviewState: comments.reviewState })
          .from(comments)
          .where(
            and(
              inArray(comments.issueId, chunk),
              isNull(comments.deletedAt),
              sql`${comments.reviewState} IS NOT NULL`,
              gte(comments.createdAt, bounds.startIso),
              lt(comments.createdAt, bounds.endIso)
            )
          )
          .all()
      )
    : [];
  const reviewApprovals = reviewCommentRows.filter((row) => row.reviewState === "approve").length;
  const reviewChanges = reviewCommentRows.length - reviewApprovals;

  const delegatedAgentIds = [
    ...new Set(scoped.map((row) => row.delegatedAgentId).filter((id): id is string => Boolean(id))),
  ];
  const agentNames = new Map<string, string>();
  if (delegatedAgentIds.length) {
    const found = await db
      .select({ id: workspaceAgents.id, name: workspaceAgents.name })
      .from(workspaceAgents)
      .where(and(eq(workspaceAgents.workspaceId, workspaceId), inArray(workspaceAgents.id, delegatedAgentIds)))
      .all();
    for (const row of found) agentNames.set(row.id, row.name);
  }

  const memberNames = new Map<string, InsightAssignee>();
  for (const member of await listMembers(workspaceId)) {
    memberNames.set(member.id, {
      id: member.id,
      displayName: member.displayName,
      avatar: member.avatar ?? null,
    });
  }

  type Flow = {
    row: InsightTaskRow;
    terminalAt: string | null;
    terminalStatus: InsightTaskStatus | null;
    usedFallback: boolean;
  };

  const flows: Flow[] = [];
  const leadSamples: number[] = [];
  const cycleSamples: number[] = [];
  const reviewSamples: number[] = [];
  let legacyCompletions = 0;

  for (const issue of scoped) {
    const issueEvents = eventsByIssue.get(issue.id) ?? [];
    const statusEvents: Array<{ at: string; to: InsightTaskStatus; from: InsightTaskStatus | null }> = [];
    const requests: string[] = [];
    const approvals: Array<{ at: string; hasComment: boolean }> = [];
    for (const event of issueEvents) {
      const data = parseData(event.data);
      if (event.type === "status_changed") {
        const to = asStatus(data.to);
        if (to) statusEvents.push({ at: event.createdAt, to, from: asStatus(data.from) });
      } else if (event.type === "agent_review_requested") {
        requests.push(event.createdAt);
      } else if (event.type === "agent_approved") {
        approvals.push({ at: event.createdAt, hasComment: false });
      } else if (event.type === "review_approved") {
        approvals.push({ at: event.createdAt, hasComment: Boolean(data.commentId) });
      }
    }

    let statusAtEnd: InsightTaskStatus = statusEvents.length
      ? (statusEvents[0].from ?? "todo")
      : (issue.status as InsightTaskStatus);
    let firstInProgressAt = statusAtEnd === "in_progress" ? issue.createdAt : null;
    let lastTerminalAt: string | null = null;
    let lastTerminalStatus: InsightTaskStatus | null = null;
    for (const statusEvent of statusEvents) {
      if (statusEvent.at >= bounds.endIso) break;
      statusAtEnd = statusEvent.to;
      if (statusEvent.to === "in_progress" && !firstInProgressAt) firstInProgressAt = statusEvent.at;
      if (statusEvent.to === "done" || statusEvent.to === "canceled") {
        lastTerminalAt = statusEvent.at;
        lastTerminalStatus = statusEvent.to;
      }
    }
    let usedFallback = false;
    if (
      !lastTerminalAt &&
      (issue.status === "done" || issue.status === "canceled") &&
      issue.updatedAt < bounds.endIso
    ) {
      lastTerminalAt = issue.updatedAt;
      lastTerminalStatus = issue.status;
      usedFallback = true;
    }

    const createdInRange = issue.createdAt >= bounds.startIso && issue.createdAt < bounds.endIso;
    const terminalInRange = Boolean(
      lastTerminalAt && lastTerminalAt >= bounds.startIso && lastTerminalAt < bounds.endIso
    );
    const completedInRange = Boolean(terminalInRange && lastTerminalStatus === "done");
    const canceledInRange = Boolean(terminalInRange && lastTerminalStatus === "canceled");
    // WIP at the end of the range: only a task that already existed then. A task
    // created on the next day belongs to the next range.
    const activeAtEnd =
      issue.createdAt < bounds.endIso && (statusAtEnd === "todo" || statusAtEnd === "in_progress");
    const completionAt = completedInRange ? lastTerminalAt : null;
    const leadDays = completionAt
      ? Math.max(0, (Date.parse(completionAt) - Date.parse(issue.createdAt)) / DAY_MS)
      : null;
    const cycleDays =
      completionAt && firstInProgressAt && firstInProgressAt <= completionAt
        ? Math.max(0, (Date.parse(completionAt) - Date.parse(firstInProgressAt)) / DAY_MS)
        : null;
    if (completedInRange && statusAtEnd !== "canceled") {
      if (leadDays !== null) leadSamples.push(leadDays);
      if (cycleDays !== null) cycleSamples.push(cycleDays);
      if (usedFallback) legacyCompletions += 1;
    }

    const reviewHours: number[] = [];
    if (statusAtEnd !== "canceled" && !canceledInRange) {
      for (const approval of approvals) {
        if (approval.at < bounds.startIso || approval.at >= bounds.endIso) continue;
        const request = [...requests].reverse().find((at) => at < approval.at);
        const start =
          request ??
          (!approval.hasComment && issue.createdVia !== "web" ? issue.createdAt : null);
        if (!start) continue;
        const hours = (Date.parse(approval.at) - Date.parse(start)) / 3_600_000;
        if (Number.isFinite(hours) && hours >= 0) reviewHours.push(hours);
      }
      reviewSamples.push(...reviewHours);
    }

    const project = projectById.get(issue.projectId);
    const row: InsightTaskRow = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      status: issue.status as InsightTaskStatus,
      statusAtEnd,
      projectId: issue.projectId,
      projectName: project?.name ?? "(deleted project)",
      projectColor: project?.color ?? "#8b5cf6",
      assignees: assigneesByIssue.get(issue.id) ?? [],
      createdAt: issue.createdAt,
      createdDay: zoneDayOf(issue.createdAt, timeZone),
      completedAt: completionAt,
      completedDay: completionAt ? zoneDayOf(completionAt, timeZone) : null,
      canceledAt: canceledInRange ? lastTerminalAt : null,
      canceledDay: canceledInRange && lastTerminalAt ? zoneDayOf(lastTerminalAt, timeZone) : null,
      leadDays: leadDays === null ? null : Math.round(leadDays * 100) / 100,
      cycleDays: cycleDays === null ? null : Math.round(cycleDays * 100) / 100,
      delegatedAgentId: issue.delegatedAgentId,
      delegatedAgentName: issue.delegatedAgentId
        ? (agentNames.get(issue.delegatedAgentId) ?? "Agent")
        : null,
      estimate: issue.estimate,
      parentId: issue.parentId,
      createdInRange,
      completedInRange,
      canceledInRange,
      activeAtEnd,
      blocked: (blockersByIssue.get(issue.id) ?? []).length > 0,
    };
    flows.push({ row, terminalAt: lastTerminalAt, terminalStatus: lastTerminalStatus, usedFallback });
  }

  if (legacyCompletions > 0) {
    notices.push({ kind: "legacy-completion", count: legacyCompletions });
  }

  const metricRows = flows.map((flow) => flow.row);
  const completedFlows = flows.filter(
    (flow) => flow.row.completedInRange && flow.row.statusAtEnd !== "canceled"
  );
  const metrics = emptyMetrics();
  metrics.created = metricRows.filter((row) => row.createdInRange).length;
  metrics.completed = metricRows.filter((row) => row.completedInRange).length;
  metrics.canceled = metricRows.filter((row) => row.canceledInRange).length;
  metrics.wip = metricRows.filter((row) => row.activeAtEnd).length;
  metrics.leadTimeDays = median(leadSamples);
  metrics.leadSample = leadSamples.length;
  metrics.cycleTimeDays = median(cycleSamples);
  metrics.cycleSample = cycleSamples.length;
  metrics.reviewLatencyHours = median(reviewSamples);
  metrics.reviewSample = reviewSamples.length;
  const rangeDays = Math.max(1, (Date.parse(bounds.endIso) - Date.parse(bounds.startIso)) / DAY_MS);
  metrics.throughputPerWeek = Math.round((metrics.completed / (rangeDays / 7)) * 100) / 100;
  metrics.delegatedCompleted = completedFlows.filter((flow) => flow.row.delegatedAgentId).length;
  metrics.delegatedActive = metricRows.filter((row) => row.activeAtEnd && row.delegatedAgentId).length;
  metrics.delegationCoverage =
    metrics.completed > 0 ? metrics.delegatedCompleted / metrics.completed : null;
  metrics.blockedActive = metricRows.filter((row) => row.activeAtEnd && row.blocked).length;
  metrics.blockersReported = blockersReported;
  metrics.subtaskCreated = metricRows.filter((row) => row.createdInRange && row.parentId).length;
  metrics.reviewApprovals = reviewApprovals;
  metrics.reviewChanges = reviewChanges;

  const days = eachDay(config.from, config.to);
  const weekMap = new Map<string, InsightWeekPoint>();
  for (const day of days) {
    const key = weekStartDay(day);
    if (!weekMap.has(key)) weekMap.set(key, { weekStart: key, created: 0, completed: 0, canceled: 0 });
  }
  for (const row of metricRows) {
    if (row.createdInRange) {
      const point = weekMap.get(weekStartDay(zoneDayOf(row.createdAt, timeZone)));
      if (point) point.created += 1;
    }
    if (row.completedInRange && row.completedAt) {
      const point = weekMap.get(weekStartDay(zoneDayOf(row.completedAt, timeZone)));
      if (point) point.completed += 1;
    }
    if (row.canceledInRange && row.canceledAt) {
      const point = weekMap.get(weekStartDay(zoneDayOf(row.canceledAt, timeZone)));
      if (point) point.canceled += 1;
    }
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Burn-up: cumulative flow inside the range, seeded with everything before it.
  let cumulativeCreated = metricRows.filter((row) => row.createdAt < bounds.startIso).length;
  let cumulativeCompleted = flows.filter(
    (flow) =>
      flow.terminalStatus === "done" &&
      flow.terminalAt !== null &&
      flow.terminalAt < bounds.startIso
  ).length;
  let cumulativeCanceled = flows.filter(
    (flow) =>
      flow.terminalStatus === "canceled" &&
      flow.terminalAt !== null &&
      flow.terminalAt < bounds.startIso
  ).length;
  const createdPerDay = new Map<string, number>();
  const completedPerDay = new Map<string, number>();
  const canceledPerDay = new Map<string, number>();
  for (const row of metricRows) {
    if (row.createdInRange) {
      const day = zoneDayOf(row.createdAt, timeZone);
      createdPerDay.set(day, (createdPerDay.get(day) ?? 0) + 1);
    }
  }
  for (const flow of flows) {
    if (!flow.terminalAt) continue;
    if (flow.terminalStatus === "done" && flow.row.completedInRange) {
      const day = zoneDayOf(flow.terminalAt, timeZone);
      completedPerDay.set(day, (completedPerDay.get(day) ?? 0) + 1);
    }
    if (flow.terminalStatus === "canceled" && flow.row.canceledInRange) {
      const day = zoneDayOf(flow.terminalAt, timeZone);
      canceledPerDay.set(day, (canceledPerDay.get(day) ?? 0) + 1);
    }
  }
  const burnup: InsightBurnupPoint[] = [];
  for (const day of days) {
    cumulativeCreated += createdPerDay.get(day) ?? 0;
    cumulativeCompleted += completedPerDay.get(day) ?? 0;
    cumulativeCanceled += canceledPerDay.get(day) ?? 0;
    burnup.push({
      day,
      scope: cumulativeCreated,
      completed: cumulativeCompleted,
      canceled: cumulativeCanceled,
    });
  }

  // Workload: who is holding active work at the end, and who completed work in range.
  type Workload = {
    assigneeId: string | null;
    active: number;
    completed: number;
    estimateActive: number;
    unsizedActive: number;
  };
  const workload = new Map<string, Workload>();
  const workloadKey = (id: string | null) => (id ? `user:${id}` : "unassigned");
  const ensureWorkload = (id: string | null): Workload => {
    const key = workloadKey(id);
    const current = workload.get(key) ?? {
      assigneeId: id,
      active: 0,
      completed: 0,
      estimateActive: 0,
      unsizedActive: 0,
    };
    workload.set(key, current);
    return current;
  };
  for (const row of metricRows) {
    const people = new Set<string>(row.assignees.map((assignee) => assignee.id));
    if (row.assignees.length === 0 && row.delegatedAgentId) {
      // Delegated tasks still have human owners; when nobody is assigned they belong
      // to the unassigned bucket, not to the agent.
    }
    const owners = people.size > 0 ? [...people] : [null];
    for (const owner of owners) {
      const bucket = ensureWorkload(owner);
      if (row.activeAtEnd) {
        bucket.active += 1;
        if (row.estimate === null) bucket.unsizedActive += 1;
        else bucket.estimateActive += row.estimate;
      }
      if (row.completedInRange) bucket.completed += 1;
    }
  }
  const workloadRows: InsightWorkloadRow[] = [...workload.values()]
    .map((bucket) => {
      const person = bucket.assigneeId ? memberNames.get(bucket.assigneeId) : undefined;
      return {
        assigneeId: bucket.assigneeId,
        name: person?.displayName ?? (bucket.assigneeId ? "Removed member" : "Unassigned"),
        avatar: person?.avatar ?? null,
        active: bucket.active,
        completed: bucket.completed,
        estimateActive: bucket.estimateActive > 0 ? bucket.estimateActive : null,
        unsizedActive: bucket.unsizedActive,
      };
    })
    .sort((a, b) => b.active - a.active || b.completed - a.completed || a.name.localeCompare(b.name));

  // Per project: the same dataset, so the panel and the workspace total agree.
  type ProjectAggregate = {
    projectId: string;
    name: string;
    color: string;
    icon: string | null;
    created: number;
    completed: number;
    canceled: number;
    active: number;
    lead: number[];
    cycle: number[];
  };
  const projectAggregates = new Map<string, ProjectAggregate>();
  for (const flow of flows) {
    const row = flow.row;
    const bucket = projectAggregates.get(row.projectId) ?? {
      projectId: row.projectId,
      name: row.projectName,
      color: row.projectColor,
      icon: projectById.get(row.projectId)?.icon ?? null,
      created: 0,
      completed: 0,
      canceled: 0,
      active: 0,
      lead: [],
      cycle: [],
    };
    projectAggregates.set(row.projectId, bucket);
    if (row.createdInRange) bucket.created += 1;
    if (row.completedInRange) bucket.completed += 1;
    if (row.canceledInRange) bucket.canceled += 1;
    if (row.activeAtEnd) bucket.active += 1;
    if (row.completedInRange && row.statusAtEnd !== "canceled") {
      if (row.leadDays !== null) bucket.lead.push(row.leadDays);
      if (row.cycleDays !== null) bucket.cycle.push(row.cycleDays);
    }
  }
  const projectRows: InsightProjectRow[] = [...projectAggregates.values()]
    .map((bucket) => ({
      projectId: bucket.projectId,
      name: bucket.name,
      color: bucket.color,
      icon: bucket.icon,
      created: bucket.created,
      completed: bucket.completed,
      canceled: bucket.canceled,
      active: bucket.active,
      leadTimeDays: median(bucket.lead),
      cycleTimeDays: median(bucket.cycle),
    }))
    .sort((a, b) => b.completed - a.completed || b.active - a.active || a.name.localeCompare(b.name));

  const issueById = new Map(scoped.map((issue) => [issue.id, issue]));
  const cycleRowsRaw = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.workspaceId, workspaceId),
        sql`${cycles.startsAt} <= ${config.to}`,
        sql`${cycles.endsAt} >= ${config.from}`
      )
    )
    .orderBy(desc(cycles.startsAt))
    .limit(24)
    .all();
  const cycleRows: InsightCycleRow[] = cycleRowsRaw.map((cycle) => {
    const attached = flows.filter(
      (flow) => issueById.get(flow.row.id)?.cycleId === cycle.id
    );
    return {
      id: cycle.id,
      number: cycle.number,
      name: cycle.name,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      status: cycle.status,
      tasks: attached.length,
      doneNow: attached.filter((flow) => flow.row.status === "done").length,
      completed: attached.filter((flow) => flow.row.completedInRange).length,
      active: attached.filter((flow) => flow.row.activeAtEnd).length,
      canceled: attached.filter((flow) => flow.row.canceledInRange).length,
      estimate: attached.reduce((sum, flow) => sum + (flow.row.estimate ?? 0), 0),
      unsized: attached.filter((flow) => flow.row.estimate === null).length,
    };
  });

  const milestoneRowsRaw = await db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      name: projectMilestones.name,
      targetDate: projectMilestones.targetDate,
      position: projectMilestones.position,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(
      and(
        eq(projectMilestones.workspaceId, workspaceId),
        isNull(projects.deletedAt),
        inArray(projectMilestones.projectId, visibleProjectIds),
        ...(config.projectId ? [eq(projectMilestones.projectId, config.projectId)] : [])
      )
    )
    .orderBy(asc(projectMilestones.position), asc(projectMilestones.targetDate))
    .all();
  const milestoneRows: InsightMilestoneRow[] = milestoneRowsRaw.map((milestone) => {
    const attached = flows.filter(
      (flow) => issueById.get(flow.row.id)?.milestoneId === milestone.id
    );
    return {
      id: milestone.id,
      projectId: milestone.projectId,
      projectName: milestone.projectName,
      projectColor: milestone.projectColor,
      name: milestone.name,
      targetDate: milestone.targetDate,
      tasks: attached.length,
      doneNow: attached.filter((flow) => flow.row.status === "done").length,
      active: attached.filter((flow) => flow.row.activeAtEnd).length,
      completed: attached.filter((flow) => flow.row.completedInRange).length,
      overdue:
        milestone.targetDate !== null && milestone.targetDate < today
          ? attached.filter((flow) => flow.row.activeAtEnd).length
          : 0,
    };
  });

  // Agent runs and token usage. A task filter scopes both to the same dataset.
  const runConditions = [
    eq(agentRuns.workspaceId, workspaceId),
    gte(agentRuns.createdAt, bounds.startIso),
    lt(agentRuns.createdAt, bounds.endIso),
  ];
  if (taskFiltersActive) {
    if (ids.length === 0) runConditions.push(sql`0 = 1`);
    else runConditions.push(inArray(agentRuns.issueId, ids));
  }
  const runRows =
    taskFiltersActive && ids.length === 0
      ? []
      : await db
          .select({
            id: agentRuns.id,
            agentId: agentRuns.agentId,
            status: agentRuns.status,
            reviewStatus: agentRuns.reviewStatus,
            source: agentRuns.source,
          })
          .from(agentRuns)
          .where(and(...runConditions))
          .all();
  const usageConditions = [
    eq(agentUsage.workspaceId, workspaceId),
    gte(agentUsage.createdAt, bounds.startIso),
    lt(agentUsage.createdAt, bounds.endIso),
  ];
  if (taskFiltersActive) {
    if (ids.length === 0) usageConditions.push(sql`0 = 1`);
    else usageConditions.push(inArray(agentUsage.issueId, ids));
  }
  const usageRows =
    taskFiltersActive && ids.length === 0
      ? []
      : await db
          .select({
            id: agentUsage.id,
            runId: agentUsage.runId,
            agentId: agentUsage.agentId,
            engine: agentUsage.engine,
            model: agentUsage.model,
            source: agentUsage.source,
            inputTokens: agentUsage.inputTokens,
            outputTokens: agentUsage.outputTokens,
            cachedTokens: agentUsage.cachedTokens,
            reasoningTokens: agentUsage.reasoningTokens,
          })
          .from(agentUsage)
          .where(and(...usageConditions))
          .all();

  const usageAgentIds = [
    ...new Set(usageRows.map((row) => row.agentId).filter((id): id is string => Boolean(id))),
  ];
  if (usageAgentIds.length) {
    const found = await db
      .select({ id: workspaceAgents.id, name: workspaceAgents.name })
      .from(workspaceAgents)
      .where(and(eq(workspaceAgents.workspaceId, workspaceId), inArray(workspaceAgents.id, usageAgentIds)))
      .all();
    for (const row of found) agentNames.set(row.id, row.name);
  }

  const agents = emptyAgentPanel();
  agents.runs = runRows.length;
  agents.done = runRows.filter((row) => row.status === "done").length;
  agents.failed = runRows.filter((row) => row.status === "failed").length;
  agents.cancelled = runRows.filter((row) => row.status === "cancelled").length;
  agents.running = runRows.filter((row) => row.status === "running").length;
  agents.review = runRows.filter((row) => row.reviewStatus === "pending").length;
  const settled = agents.done + agents.failed;
  agents.completionRate = settled > 0 ? agents.done / settled : null;
  agents.delegatedCompleted = metrics.delegatedCompleted;
  agents.delegatedActive = metrics.delegatedActive;
  agents.coverage = metrics.delegationCoverage;
  for (const row of usageRows) {
    agents.inputTokens += Number(row.inputTokens) || 0;
    agents.outputTokens += Number(row.outputTokens) || 0;
    agents.cachedTokens += Number(row.cachedTokens) || 0;
    agents.reasoningTokens += Number(row.reasoningTokens) || 0;
  }
  agents.totalTokens = agents.inputTokens + agents.outputTokens;
  agents.available = runRows.length > 0 || usageRows.length > 0;
  agents.usageAvailable = usageRows.length > 0;

  const byAgent = new Map<
    string,
    { agentId: string | null; runs: number; usageRuns: number; totals: number[] }
  >();
  const ensureAgent = (agentId: string | null) => {
    const key = agentId ?? "";
    const current = byAgent.get(key) ?? {
      agentId,
      runs: 0,
      usageRuns: 0,
      totals: [0, 0, 0, 0],
    };
    byAgent.set(key, current);
    return current;
  };
  for (const run of runRows) ensureAgent(run.agentId).runs += 1;
  for (const usage of usageRows) {
    const bucket = ensureAgent(usage.agentId);
    bucket.usageRuns += 1;
    bucket.totals[0] += Number(usage.inputTokens) || 0;
    bucket.totals[1] += Number(usage.outputTokens) || 0;
    bucket.totals[2] += Number(usage.cachedTokens) || 0;
    bucket.totals[3] += Number(usage.reasoningTokens) || 0;
  }
  agents.byAgent = [...byAgent.values()]
    .map((bucket) => {
      const [inputTokens, outputTokens, cachedTokens, reasoningTokens] = bucket.totals;
      return {
        agentId: bucket.agentId,
        agentName: bucket.agentId
          ? (agentNames.get(bucket.agentId) ?? "Agent")
          : "Direct chat",
        runs: bucket.runs,
        usageRuns: bucket.usageRuns,
        inputTokens,
        outputTokens,
        cachedTokens,
        reasoningTokens,
        totalTokens: inputTokens + outputTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs);

  const modelMap = new Map<string, InsightModelRow>();
  for (const usage of usageRows) {
    const key = `${usage.engine}\u0000${usage.model}`;
    const row = modelMap.get(key) ?? {
      engine: usage.engine,
      model: usage.model || "default",
      usageRuns: 0,
      totalTokens: 0,
    };
    row.usageRuns += 1;
    row.totalTokens += (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    modelMap.set(key, row);
  }
  agents.byModel = [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  const sourceMap = new Map<string, { source: string; usageRuns: number; totalTokens: number }>();
  for (const usage of usageRows) {
    const row = sourceMap.get(usage.source) ?? {
      source: usage.source,
      usageRuns: 0,
      totalTokens: 0,
    };
    row.usageRuns += 1;
    row.totalTokens += (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    sourceMap.set(usage.source, row);
  }
  agents.bySource = [...sourceMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);

  // Automation runs. Members see their own runs, matching Settings › Automations.
  const automationConditions = [
    eq(automationRuns.workspaceId, workspaceId),
    gte(automationRuns.createdAt, bounds.startIso),
    lt(automationRuns.createdAt, bounds.endIso),
  ];
  if (!canManageAutomations) automationConditions.push(eq(automationRuns.triggeredBy, viewerId));
  const automationRows = await db
    .select({
      id: automationRuns.id,
      ruleId: automationRuns.ruleId,
      ruleName: automationRuns.ruleName,
      status: automationRuns.status,
      durationMs: automationRuns.durationMs,
      event: automationRuns.event,
    })
    .from(automationRuns)
    .where(and(...automationConditions))
    .all();
  const datasetIdSet = new Set(ids);
  const automationScopedRows = taskFiltersActive
    ? automationRows.filter((row) => {
        const data = parseData(row.event);
        return typeof data.issueId === "string" && datasetIdSet.has(data.issueId);
      })
    : automationRows;
  const automations = emptyAutomationPanel(automationScoped);
  automations.runs = automationScopedRows.length;
  automations.success = automationScopedRows.filter((row) => row.status === "success").length;
  automations.partial = automationScopedRows.filter((row) => row.status === "partial").length;
  automations.failed = automationScopedRows.filter((row) => row.status === "failed").length;
  automations.running = automationScopedRows.filter((row) => row.status === "running").length;
  const finished = automations.success + automations.partial + automations.failed;
  automations.failureRate = finished > 0 ? automations.failed / finished : null;
  const durations = automationScopedRows
    .filter((row) => row.status !== "running" && row.durationMs > 0)
    .map((row) => row.durationMs);
  automations.medianDurationMs = median(durations);
  const ruleMap = new Map<string, InsightAutomationRuleRow>();
  for (const run of automationScopedRows) {
    const row = ruleMap.get(run.ruleId) ?? {
      ruleId: run.ruleId,
      ruleName: run.ruleName || "Deleted rule",
      runs: 0,
      failures: 0,
      success: 0,
    };
    row.runs += 1;
    if (run.status === "failed") row.failures += 1;
    if (run.status === "success") row.success += 1;
    ruleMap.set(run.ruleId, row);
  }
  automations.byRule = [...ruleMap.values()]
    .sort((a, b) => b.runs - a.runs || b.failures - a.failures)
    .slice(0, 10);
  automations.available = automations.runs > 0;
  if (automationScoped) notices.push({ kind: "automation-own-runs" });

  const relevant = flows.filter(
    (flow) =>
      flow.row.createdInRange ||
      flow.row.completedInRange ||
      flow.row.canceledInRange ||
      flow.row.activeAtEnd
  );
  relevant.sort((a, b) => {
    const stamp = (row: InsightTaskRow) =>
      row.completedAt ?? row.canceledAt ?? row.createdAt;
    return stamp(b.row).localeCompare(stamp(a.row));
  });
  const rowTotal = relevant.length;
  if (rowTotal > maxRows) notices.push({ kind: "table-truncated", limit: maxRows });
  const rows = relevant.slice(0, maxRows).map((flow) => flow.row);

  const partial =
    truncated ||
    rowTotal > maxRows ||
    legacyCompletions > 0;

  return {
    range,
    filters: config,
    taskFiltersActive,
    metrics,
    weeks,
    burnup,
    workload: workloadRows,
    projects: projectRows,
    cycles: cycleRows,
    milestones: milestoneRows,
    agents,
    automations,
    rows,
    rowTotal,
    partial,
    notices,
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// Request resolution (URL params + a saved workspace view)
// ---------------------------------------------------------------------------

export type InsightRequest = {
  config: InsightSavedConfig;
  defaults: InsightSavedConfig;
  timeZone: string;
  today: string;
  viewId: string | null;
  viewName: string | null;
  notices: InsightNotice[];
};

function readQuery(
  query: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The page, the export route and the checks share one interpretation of a report URL:
 * a saved view supplies the base, explicit params override it, and normalization owns
 * the default range and the one-year clamp.
 */
export async function resolveInsightRequest(
  workspaceId: string,
  userId: string,
  query: Record<string, string | string[] | undefined>,
  options: { timeZone?: string; now?: string } = {}
): Promise<InsightRequest> {
  const timeZone = resolveInsightTimeZone(options.timeZone);
  const generatedAt = options.now ?? new Date().toISOString();
  const today = zoneDayOf(generatedAt, timeZone);
  const defaults = defaultInsightConfig(today);
  const notices: InsightNotice[] = [];
  let base: Partial<InsightSavedConfig> = {};
  let viewId: string | null = null;
  let viewName: string | null = null;
  const requestedView = readQuery(query, "viewId");
  if (requestedView) {
    try {
      const view = getTaskView(workspaceId, userId, requestedView);
      // Only a shared report is a link another member can open; a personal view is not.
      if (view.shared && view.definition.insight) {
        base = view.definition.insight;
        viewId = view.id;
        viewName = view.name;
      } else {
        notices.push({ kind: "view-unavailable" });
      }
    } catch {
      notices.push({ kind: "view-unavailable" });
    }
  }
  const normalized = normalizeInsightConfig(
    {
      from: readQuery(query, "from") ?? base.from,
      to: readQuery(query, "to") ?? base.to,
      projectId: readQuery(query, "project") ?? base.projectId,
      assigneeId: readQuery(query, "assignee") ?? base.assigneeId,
      label: readQuery(query, "label") ?? base.label,
      status: (readQuery(query, "status") as InsightStatusFilter | undefined) ?? base.status,
    },
    today
  );
  return {
    config: normalized.config,
    defaults,
    timeZone,
    today,
    viewId,
    viewName,
    notices: [...notices, ...normalized.notices],
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The CSV is generated from the same `InsightData.rows` the table renders, so the
 * exported rows match the screen (and the same visibility checks already ran).
 */
export function buildInsightsCsv(data: InsightData): string {
  const timeZone = data.range.timeZone;
  const header = [
    "identifier",
    "title",
    "status",
    "project",
    "assignees",
    "created",
    "completed",
    "canceled",
    "lead_days",
    "cycle_days",
    "delegated_agent",
    "estimate",
  ];
  const lines = [header.join(",")];
  for (const row of data.rows) {
    lines.push(
      [
        row.identifier,
        row.title,
        row.status,
        row.projectName,
        row.assignees.map((assignee) => assignee.displayName).join("; "),
        zoneDayOf(row.createdAt, timeZone),
        row.completedAt ? zoneDayOf(row.completedAt, timeZone) : "",
        row.canceledAt ? zoneDayOf(row.canceledAt, timeZone) : "",
        row.leadDays === null ? "" : row.leadDays.toFixed(2),
        row.cycleDays === null ? "" : row.cycleDays.toFixed(2),
        row.delegatedAgentName ?? "",
        row.estimate === null ? "" : String(row.estimate),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function insightExportName(data: InsightData): string {
  return `insights-${data.range.from}-to-${data.range.to}.csv`;
}
