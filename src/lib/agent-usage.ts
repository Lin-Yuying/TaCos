import crypto from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentUsage, issues, users, workspaceAgents } from "@/db/schema";
import type { TurnUsage } from "@/lib/harness/types";

// #79: the token ledger. Observe-only — nothing here can stop a turn, and there is no
// USD/price table and no budget. Tokens are exactly what the provider or adapter reported;
// a turn that reports nothing leaves no row.

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type UsageRow = UsageTotals & {
  id: string;
  runId: string | null;
  threadId: string | null;
  messageId: string | null;
  issueId: string | null;
  agentId: string | null;
  userId: string;
  engine: string;
  model: string;
  source: string;
  durationMs: number;
  createdAt: string;
};

function totalsOf(rows: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number }[]): UsageTotals {
  const totals = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 };
  for (const row of rows) {
    totals.inputTokens += Number(row.inputTokens) || 0;
    totals.outputTokens += Number(row.outputTokens) || 0;
    totals.cachedTokens += Number(row.cachedTokens) || 0;
    totals.reasoningTokens += Number(row.reasoningTokens) || 0;
  }
  totals.totalTokens = totals.inputTokens + totals.outputTokens;
  return totals;
}

export async function recordAgentUsage(input: {
  workspaceId: string;
  userId: string;
  engine: string;
  model: string;
  source: "runner" | "api";
  usage: TurnUsage;
  runId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  issueId?: string | null;
  agentId?: string | null;
  durationMs?: number;
}): Promise<void> {
  const usage = input.usage;
  if (!usage || (!usage.inputTokens && !usage.outputTokens)) return;
  await getDb().insert(agentUsage).values({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    runId: input.runId ?? null,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    issueId: input.issueId ?? null,
    agentId: input.agentId ?? null,
    userId: input.userId,
    engine: input.engine,
    model: input.model ?? "",
    source: input.source,
    inputTokens: Math.max(0, Math.round(Number(usage.inputTokens) || 0)),
    outputTokens: Math.max(0, Math.round(Number(usage.outputTokens) || 0)),
    cachedTokens: Math.max(0, Math.round(Number(usage.cachedTokens) || 0)),
    reasoningTokens: Math.max(0, Math.round(Number(usage.reasoningTokens) || 0)),
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
    createdAt: new Date().toISOString(),
  });
}

export async function usageForRun(runId: string): Promise<UsageTotals> {
  const rows = await getDb().select().from(agentUsage).where(eq(agentUsage.runId, runId));
  return totalsOf(rows);
}

export async function usageForThread(threadId: string): Promise<UsageTotals> {
  const rows = await getDb().select().from(agentUsage).where(eq(agentUsage.threadId, threadId));
  return totalsOf(rows);
}

export async function usageForIssue(issueId: string): Promise<UsageTotals> {
  const rows = await getDb().select().from(agentUsage).where(eq(agentUsage.issueId, issueId));
  return totalsOf(rows);
}

export type AgentUsageSummary = {
  totals: UsageTotals;
  byAgent: { agentId: string | null; agentName: string; runs: number; usage: UsageTotals }[];
  byModel: { engine: string; model: string; runs: number; usage: UsageTotals }[];
  byDay: { date: string; usage: UsageTotals }[];
  byTask: { issueId: string; task: string; title: string; usage: UsageTotals }[];
  recent: UsageRow[];
};

/** Settings → Agent usage. Newest 30 days, grouped by agent and model. */
export async function agentUsageSummary(workspaceId: string, days = 30): Promise<AgentUsageSummary> {
  const since = new Date(Date.now() - Math.max(1, days) * 86_400_000).toISOString();
  const rows = await getDb()
    .select()
    .from(agentUsage)
    .where(and(eq(agentUsage.workspaceId, workspaceId), gte(agentUsage.createdAt, since)))
    .orderBy(desc(agentUsage.createdAt));
  const agentIds = [...new Set(rows.map((row) => row.agentId).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (agentIds.length) {
    const found = await getDb()
      .select({ id: workspaceAgents.id, name: workspaceAgents.name })
      .from(workspaceAgents)
      .where(inArray(workspaceAgents.id, agentIds));
    for (const row of found) names.set(row.id, row.name);
  }
  if (!names.size) {
    const people = await getDb().select({ id: users.id, name: users.displayName }).from(users);
    for (const person of people) names.set(person.id, person.name);
  }
  const agentGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.agentId ?? "";
    const list = agentGroups.get(key) ?? [];
    list.push(row);
    agentGroups.set(key, list);
  }
  const modelGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.engine}|${row.model}`;
    const list = modelGroups.get(key) ?? [];
    list.push(row);
    modelGroups.set(key, list);
  }
  const dayGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.createdAt.slice(0, 10);
    const list = dayGroups.get(key) ?? [];
    list.push(row);
    dayGroups.set(key, list);
  }
  const issueIds = [...new Set(rows.map((row) => row.issueId).filter((id): id is string => Boolean(id)))];
  const taskNames = new Map<string, { task: string; title: string }>();
  if (issueIds.length) {
    const found = await getDb()
      .select({ id: issues.id, identifier: issues.identifier, title: issues.title })
      .from(issues)
      .where(inArray(issues.id, issueIds));
    for (const row of found) taskNames.set(row.id, { task: row.identifier, title: row.title });
  }
  const taskGroups = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.issueId) continue;
    const list = taskGroups.get(row.issueId) ?? [];
    list.push(row);
    taskGroups.set(row.issueId, list);
  }
  return {
    totals: totalsOf(rows),
    byAgent: [...agentGroups.entries()]
      .map(([agentId, list]) => ({
        agentId: agentId || null,
        agentName: agentId ? (names.get(agentId) ?? "Agent") : "Direct chat",
        runs: new Set(list.map((row) => row.runId ?? row.id)).size,
        usage: totalsOf(list),
      }))
      .sort((a, b) => b.usage.totalTokens - a.usage.totalTokens),
    byModel: [...modelGroups.entries()]
      .map(([key, list]) => {
        const [engine, ...rest] = key.split("|");
        return {
          engine,
          model: rest.join("|") || "default",
          runs: new Set(list.map((row) => row.runId ?? row.id)).size,
          usage: totalsOf(list),
        };
      })
      .sort((a, b) => b.usage.totalTokens - a.usage.totalTokens),
    byDay: [...dayGroups.entries()]
      .map(([date, list]) => ({ date, usage: totalsOf(list) }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30),
    byTask: [...taskGroups.entries()]
      .map(([issueId, list]) => ({
        issueId,
        task: taskNames.get(issueId)?.task ?? "",
        title: taskNames.get(issueId)?.title ?? "Deleted task",
        usage: totalsOf(list),
      }))
      .sort((a, b) => b.usage.totalTokens - a.usage.totalTokens)
      .slice(0, 20),
    recent: rows.slice(0, 50).map((row) => ({
      ...row,
      ...totalsOf([row]),
    })),
  };
}

