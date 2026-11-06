"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import {
  assertAutomationManager,
  createAutomationRule,
  deleteAutomationRule,
  getAutomationRule,
  setAutomationRuleEnabled,
  updateAutomationRule,
  type AutomationRuleView,
} from "@/lib/automations/store";
import { dryRunAutomationRule } from "@/lib/automations/evaluator";
import type { AutomationDryRun } from "@/lib/automations/shared";
import type { ActionResult } from "./actions";

function refresh(workspaceId: string) {
  revalidatePath(`/${workspaceId}/settings`);
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export type AutomationRuleActionInput = {
  name: string;
  trigger: string;
  conditions: unknown[];
  actions: unknown[];
};

export async function createAutomationRuleAction(
  workspaceId: string,
  input: AutomationRuleActionInput
): Promise<ActionResult<AutomationRuleView>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const rule = await createAutomationRule(workspaceId, input, {
      id: user.id,
      displayName: user.displayName,
    });
    refresh(workspaceId);
    return rule;
  });
}

export async function updateAutomationRuleAction(
  workspaceId: string,
  ruleId: string,
  input: AutomationRuleActionInput
): Promise<ActionResult<AutomationRuleView>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const rule = await updateAutomationRule(workspaceId, ruleId, input, {
      id: user.id,
      displayName: user.displayName,
    });
    refresh(workspaceId);
    return rule;
  });
}

export async function setAutomationRuleEnabledAction(
  workspaceId: string,
  ruleId: string,
  enabled: boolean
): Promise<ActionResult<AutomationRuleView>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const rule = await setAutomationRuleEnabled(workspaceId, ruleId, enabled, {
      id: user.id,
      displayName: user.displayName,
    });
    refresh(workspaceId);
    return rule;
  });
}

export async function deleteAutomationRuleAction(
  workspaceId: string,
  ruleId: string
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await deleteAutomationRule(workspaceId, ruleId, {
      id: user.id,
      displayName: user.displayName,
    });
    refresh(workspaceId);
    return { id: ruleId };
  });
}

// Dry-run reads the rule and the task; it writes no comment, run or delegation.
export async function dryRunAutomationRuleAction(
  workspaceId: string,
  ruleId: string,
  target: { issueId?: string; runId?: string }
): Promise<ActionResult<AutomationDryRun>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertAutomationManager(workspaceId, user.id);
    const rule = await getAutomationRule(workspaceId, ruleId);
    if (!rule) throw new Error("Rule not found");
    return dryRunAutomationRule(workspaceId, ruleId, target);
  });
}
