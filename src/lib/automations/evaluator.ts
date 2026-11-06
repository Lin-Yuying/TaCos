// #80: matching and execution. One event runs every enabled rule whose trigger and
// conditions fit, in creation order. Each (rule, event) runs at most once.
import { getIssueDetail, type IssueWithLabels } from "@/lib/issues";
import { getPageUnfiltered, type DocPage } from "@/lib/pages";
import { TacosError } from "@/lib/tacos-error";
import { executeAutomationAction, type AutomationActionContext } from "./actions";
import { runWithAutomationContext } from "./dispatch";
import {
  MAX_AUTOMATION_DEPTH,
  actionSummary,
  conditionSummary,
  type AutomationAction,
  type AutomationActionResult,
  type AutomationCondition,
  type AutomationDryRun,
  type AutomationEvent,
  type AutomationRunStatus,
  type AutomationTriggerSpec,
} from "./shared";
import {
  automationNameMaps,
  automationRunEvent,
  claimAutomationRun,
  finishAutomationRun,
  getAutomationRule,
  listEnabledAutomationRules,
  touchAutomationRuleLastRun,
  type AutomationRuleView,
} from "./store";

type AutomationContext = {
  issue: IssueWithLabels | null;
  page: DocPage | null;
};

function triggerMatches(ruleTrigger: AutomationTriggerSpec, event: AutomationEvent): boolean {
  if (ruleTrigger.type !== event.type) return false;
  if (event.type === "task.due_soon") return ruleTrigger.days === Number(event.data.days);
  return true;
}

function conditionMatches(condition: AutomationCondition, context: AutomationContext): boolean {
  const { issue, page } = context;
  switch (condition.kind) {
    case "project":
      return issue?.projectId === condition.projectId || page?.projectId === condition.projectId;
    case "label":
      return Boolean(issue?.labels.some((label) => label.name === condition.label));
    case "priority":
      return issue?.priority === condition.priority;
    case "assignee":
      return issue ? (issue.assignees.length > 0) === condition.present : false;
    case "status":
      return issue?.status === condition.status;
    case "text": {
      const haystack = issue
        ? `${issue.title}\n${issue.description}`
        : page
          ? `${page.title}\n${page.doc}`
          : "";
      return haystack.toLocaleLowerCase().includes(condition.contains.toLocaleLowerCase());
    }
  }
}

function conditionsMatch(conditions: AutomationCondition[], context: AutomationContext): boolean {
  return conditions.every((condition) => conditionMatches(condition, context));
}

async function loadContext(event: AutomationEvent): Promise<AutomationContext> {
  const issue = event.issueId
    ? (await getIssueDetail(event.workspaceId, event.issueId))?.issue ?? null
    : null;
  const page = event.pageId ? await getPageUnfiltered(event.workspaceId, event.pageId) : null;
  return { issue, page };
}

function runStatus(results: AutomationActionResult[]): {
  status: AutomationRunStatus;
  error: string | null;
} {
  const failed = results.filter((result) => result.status === "failed");
  const skipped = results.filter((result) => result.status === "skipped");
  if (failed.length === 0) {
    return { status: skipped.length > 0 ? "partial" : "success", error: null };
  }
  return {
    status: failed.length === results.length ? "failed" : "partial",
    error: failed
      .slice(0, 3)
      .map((result) => `Action ${result.index + 1}: ${result.error ?? "failed"}`)
      .join(" · "),
  };
}

/**
 * Runs every listening rule once for this event. A rule action that emits another event
 * carries this rule's id, so it never re-enters itself; the depth cap stops a pair of
 * rules that call each other.
 */
export async function evaluateAutomationEvent(event: AutomationEvent): Promise<void> {
  if ((event.depth ?? 0) >= MAX_AUTOMATION_DEPTH) return;
  const rules = await listEnabledAutomationRules(event.workspaceId, event.type);
  const eligible = rules.filter(
    (rule) => triggerMatches(rule.trigger, event) && event.originRuleId !== rule.id
  );
  if (eligible.length === 0) return;
  const context = await loadContext(event);
  for (const rule of eligible) {
    if (!conditionsMatch(rule.conditions, context)) continue;
    const idempotencyKey = event.idempotencyKey ?? event.id;
    const runId = await claimAutomationRun({
      workspaceId: event.workspaceId,
      rule,
      event,
      idempotencyKey,
    });
    // Already run for this event: a dispatch retry, a scheduler restart or a duplicate.
    if (!runId) continue;
    const started = Date.now();
    const results: AutomationActionResult[] = [];
    const actionContext: AutomationActionContext = {
      event,
      rule,
      issue: context.issue,
      pageTitle: context.page?.title ?? null,
      pageProjectId: context.page?.projectId ?? null,
    };
    await runWithAutomationContext(
      { ruleId: rule.id, ruleName: rule.name, depth: (event.depth ?? 0) + 1 },
      async () => {
        for (const [index, action] of rule.actions.entries()) {
          results.push(await executeAutomationAction(action, index, actionContext));
        }
      }
    );
    const outcome = runStatus(results);
    await finishAutomationRun(runId, {
      status: outcome.status,
      actionResults: results,
      error: outcome.error,
      durationMs: Date.now() - started,
    });
    await touchAutomationRuleLastRun(rule.id);
  }
}

/** Picks the trigger's own type for a synthetic event, used by the task dry-run. */
function syntheticEvent(
  workspaceId: string,
  rule: AutomationRuleView,
  issue: { id: string; identifier: string }
): AutomationEvent {
  return {
    id: "dry-run",
    type: rule.trigger.type,
    workspaceId,
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    actorUserId: undefined,
    actorName: "Dry run",
    occurredAt: new Date().toISOString(),
    data: rule.trigger.type === "task.due_soon" ? { days: rule.trigger.days } : {},
    depth: 0,
  };
}

/**
 * Evaluates a rule against a chosen task or the event of its last run without writing
 * anything: no comment, no delegation, no run row.
 */
export async function dryRunAutomationRule(
  workspaceId: string,
  ruleId: string,
  target: { issueId?: string; runId?: string }
): Promise<AutomationDryRun> {
  const rule = await getAutomationRule(workspaceId, ruleId);
  if (!rule) throw new TacosError("Rule not found", 404);
  let event: AutomationEvent;
  if (target.issueId) {
    const detail = await getIssueDetail(workspaceId, target.issueId);
    if (!detail) throw new TacosError("Task not found", 404);
    event = syntheticEvent(workspaceId, rule, detail.issue);
  } else if (target.runId) {
    const stored = await automationRunEvent(workspaceId, ruleId, target.runId);
    if (!stored) throw new TacosError("There is no matching event for this rule yet", 404);
    event = { ...stored, originRuleId: undefined, depth: 0 };
  } else {
    throw new TacosError("Choose a task or the last matching event", 400);
  }
  const context = await loadContext(event);
  const names = await automationNameMaps(workspaceId);
  const matchedTrigger = triggerMatches(rule.trigger, event);
  const conditions = rule.conditions.map((condition) => ({
    text: conditionSummary(condition, names),
    passed: conditionMatches(condition, context),
  }));
  const actions = rule.actions.map((action: AutomationAction) => actionSummary(action, names));
  return {
    matched: matchedTrigger && conditions.every((condition) => condition.passed),
    trigger: rule.trigger,
    event,
    issue: context.issue
      ? {
          id: context.issue.id,
          identifier: context.issue.identifier,
          title: context.issue.title,
        }
      : null,
    conditions,
    actions,
  };
}
