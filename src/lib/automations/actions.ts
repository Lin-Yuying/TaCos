// #80: actions a rule can take. Every action is internal to TaCos; failures are
// recorded and never roll back the actions that already succeeded.
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { workspaceMembers } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import { addComment, createIssue, notify, updateIssue, type IssueWithLabels } from "@/lib/issues";
import { delegateTask } from "@/lib/agent-delegation";
import { createPage } from "@/lib/pages";
import { STATUS_META } from "@/lib/constants";
import type { AutomationAction, AutomationActionResult, AutomationEvent } from "./shared";
import type { AutomationRuleView } from "./store";

const ACTION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 25;

export type AutomationActionContext = {
  event: AutomationEvent;
  rule: AutomationRuleView;
  issue: IssueWithLabels | null;
  pageTitle: string | null;
  pageProjectId: string | null;
};

function ruleActor(rule: AutomationRuleView) {
  return { kind: "agent" as const, label: `Automation · ${rule.name}`, via: "api" as const };
}

function creatorActor(rule: AutomationRuleView) {
  return { kind: "user" as const, userId: rule.createdBy, displayName: rule.createdByName };
}

/** Retry only failures that are not a settled business answer (4xx). */
async function withRetries<T>(
  work: () => Promise<T>
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }> {
  let attempts = 0;
  let last = "Action failed";
  while (attempts < ACTION_ATTEMPTS) {
    attempts += 1;
    try {
      return { ok: true, value: await work(), attempts };
    } catch (err) {
      last = err instanceof Error ? err.message : "Action failed";
      const retryable = !(err instanceof TacosError) || err.status >= 500;
      if (!retryable || attempts >= ACTION_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempts));
    }
  }
  return { ok: false, error: last, attempts };
}

function taskId(context: AutomationActionContext): string {
  if (!context.event.issueId) {
    throw new TacosError("This action needs a task trigger", 400);
  }
  return context.event.issueId;
}

async function assertCreatorIsMember(workspaceId: string, userId: string): Promise<void> {
  const [row] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!row) throw new TacosError("The rule creator is no longer a workspace member", 409);
}

function projectId(context: AutomationActionContext): string {
  const id = context.issue?.projectId ?? context.pageProjectId;
  if (!id) throw new TacosError("This action needs a project; run it from a task or a project document", 400);
  return id;
}

export async function executeAutomationAction(
  action: AutomationAction,
  index: number,
  context: AutomationActionContext
): Promise<AutomationActionResult> {
  const { rule } = context;
  const actor = ruleActor(rule);
  const result = await withRetries(async (): Promise<string> => {
    switch (action.kind) {
      case "set_status": {
        const id = taskId(context);
        await updateIssue(context.event.workspaceId, id, { status: action.status }, actor);
        return `Status set to ${STATUS_META[action.status].label}`;
      }
      case "set_assignees": {
        const id = taskId(context);
        await updateIssue(context.event.workspaceId, id, { assigneeIds: action.assigneeIds }, actor);
        return `Assignees set to ${action.assigneeIds.length}`;
      }
      case "set_labels": {
        const id = taskId(context);
        await updateIssue(context.event.workspaceId, id, { labelNames: action.labels }, actor);
        return `Labels set to ${action.labels.join(", ")}`;
      }
      case "add_comment": {
        const id = taskId(context);
        const detail = await addComment(context.event.workspaceId, id, action.body, actor);
        return `Comment added to ${detail.issue.identifier}`;
      }
      case "notify_users": {
        const title = context.issue?.title ?? context.pageTitle ?? "";
        const recipients = await getDb()
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, context.event.workspaceId),
              inArray(workspaceMembers.userId, action.userIds)
            )
          );
        const current = new Set(recipients.map((row) => row.userId));
        let delivered = 0;
        for (const userId of action.userIds) {
          if (!current.has(userId)) continue;
          await notify({
            workspaceId: context.event.workspaceId,
            userId,
            issueId: context.event.issueId ?? "",
            pageId: context.event.pageId,
            type: "automation",
            body: "",
            data: {
              actorName: `Automation · ${rule.name}`,
              ruleName: rule.name,
              note: action.message,
              title,
            },
          });
          delivered += 1;
        }
        return `Notified ${delivered}`;
      }
      case "delegate_agent": {
        const id = taskId(context);
        await assertCreatorIsMember(context.event.workspaceId, rule.createdBy);
        const note = [action.note.trim(), `Automation: ${rule.name}`].filter(Boolean).join("\n\n");
        const panel = await delegateTask({
          workspaceId: context.event.workspaceId,
          issueId: id,
          userId: rule.createdBy,
          agentId: action.agentId,
          note,
        });
        return panel.agent ? `Delegated to ${panel.agent.name}` : "Delegated";
      }
      case "create_document": {
        await assertCreatorIsMember(context.event.workspaceId, rule.createdBy);
        // A document does not need a project; it sits in the library when the event has none.
        const page = await createPage(
          context.event.workspaceId,
          rule.createdBy,
          {
            title: action.title,
            doc: action.doc,
            projectId: context.issue?.projectId ?? context.pageProjectId ?? null,
          },
          { via: "automation" }
        );
        return `Created document ${page.title}`;
      }
      case "create_task": {
        await assertCreatorIsMember(context.event.workspaceId, rule.createdBy);
        const detail = await createIssue(
          context.event.workspaceId,
          {
            title: action.title,
            description: action.description,
            project: projectId(context),
          },
          creatorActor(rule)
        );
        return `Created task ${detail.issue.identifier}`;
      }
    }
  });
  if (result.ok) {
    return { index, kind: action.kind, status: "ok", output: result.value, attempts: result.attempts };
  }
  return { index, kind: action.kind, status: "failed", error: result.error, attempts: result.attempts };
}
