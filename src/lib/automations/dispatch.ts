// #80: the business layer reports a mutation here. Dispatch does the cheap "is any rule
// listening" check, then loads the evaluator on demand so issues.ts never imports the
// action code (which imports issues.ts again).
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AutomationEvent, AutomationTriggerType } from "./shared";
import { hasEnabledAutomationRules } from "./store";

type AutomationContext = { ruleId: string; ruleName: string; depth: number };

const store = new AsyncLocalStorage<AutomationContext>();

export function automationContext(): AutomationContext | undefined {
  return store.getStore();
}

/**
 * Runs one rule's actions with the rule id attached to every event they cause, so the
 * rule never re-triggers itself and a pair of rules that feed each other stops at a
 * bounded depth.
 */
export function runWithAutomationContext<T>(
  context: AutomationContext,
  work: () => Promise<T>
): Promise<T> {
  return store.run(context, work);
}

export type EmitAutomationEventInput = {
  type: AutomationTriggerType;
  workspaceId: string;
  issueId?: string;
  issueIdentifier?: string;
  pageId?: string;
  actorUserId?: string;
  actorName: string;
  data?: Record<string, unknown>;
  idempotencyKey?: string;
};

/**
 * Runs the rules listening to this event. Errors are logged, never thrown into the
 * mutation that caused them: a broken rule must not fail task creation or a comment.
 */
export async function emitAutomationEvent(input: EmitAutomationEventInput): Promise<void> {
  try {
    if (!(await hasEnabledAutomationRules(input.workspaceId, input.type))) return;
    const context = store.getStore();
    const event: AutomationEvent = {
      id: crypto.randomUUID(),
      type: input.type,
      workspaceId: input.workspaceId,
      issueId: input.issueId,
      issueIdentifier: input.issueIdentifier,
      pageId: input.pageId,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      occurredAt: new Date().toISOString(),
      data: input.data ?? {},
      originRuleId: context?.ruleId,
      depth: context?.depth ?? 0,
      idempotencyKey: input.idempotencyKey,
    };
    const { evaluateAutomationEvent } = await import("./evaluator");
    await evaluateAutomationEvent(event);
  } catch (err) {
    console.error("automation dispatch:", err);
  }
}
