// #80: the only scheduled trigger. One in-process interval asks for tasks that are
// exactly N days from their due date; the run's idempotency key keeps a restart or a
// second process from firing the same rule twice for the same due date.
import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { issues, projects } from "@/db/schema";
import type { AutomationEvent } from "./shared";
import { evaluateAutomationEvent } from "./evaluator";
import { listDueAutomationRules } from "./store";

function dateAfter(now: Date, days: number): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Evaluates every enabled due-trigger rule against tasks due N days from `now`.
 * Returns the number of due tasks considered. Safe to call repeatedly.
 */
export async function runDueAutomationRules(now: Date = new Date()): Promise<number> {
  const rules = await listDueAutomationRules();
  if (rules.length === 0) return 0;
  const groups = new Map<string, { workspaceId: string; days: number }>();
  for (const rule of rules) {
    if (rule.trigger.type !== "task.due_soon" || !rule.trigger.days) continue;
    groups.set(`${rule.workspaceId}:${rule.trigger.days}`, {
      workspaceId: rule.workspaceId,
      days: rule.trigger.days,
    });
  }
  let considered = 0;
  for (const group of groups.values()) {
    const dueDate = dateAfter(now, group.days);
    const rows = await getDb()
      .select({
        id: issues.id,
        identifier: issues.identifier,
        dueDate: issues.dueDate,
      })
      .from(issues)
      .where(
        and(
          eq(issues.workspaceId, group.workspaceId),
          eq(issues.dueDate, dueDate),
          isNull(issues.deletedAt),
          ne(issues.reviewStatus, "rejected"),
          notInArray(issues.status, ["done", "canceled"]),
          sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${issues.projectId} AND ${projects.deletedAt} IS NULL)`
        )
      );
    for (const row of rows) {
      const event: AutomationEvent = {
        id: `due:${row.id}:${row.dueDate}`,
        type: "task.due_soon",
        workspaceId: group.workspaceId,
        issueId: row.id,
        issueIdentifier: row.identifier,
        actorName: "Automation scheduler",
        occurredAt: now.toISOString(),
        data: { days: group.days, dueDate: row.dueDate },
        depth: 0,
        idempotencyKey: `due:${row.id}:${row.dueDate}`,
      };
      await evaluateAutomationEvent(event);
      considered += 1;
    }
  }
  return considered;
}

let scheduler: ReturnType<typeof setInterval> | null = null;

/** Starts the single automation interval once per server process. */
export function startAutomationScheduler(intervalMs = 60_000) {
  if (scheduler) return;
  const tick = () =>
    void runDueAutomationRules().catch((err) => console.error("automation scheduler:", err));
  tick();
  scheduler = setInterval(tick, intervalMs);
  scheduler.unref?.();
}
