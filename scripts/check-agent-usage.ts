/**
 * #79 usage: the token ledger records input/output/cached/reasoning per run/thread/
 * model/agent, the usage views agree with it, and nothing stops a run. No USD, no budget.
 * Run: npx tsx scripts/check-agent-usage.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-usage-"));
process.env.TACOS_SEED_DEMO = "0";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { agentUsage, users, workspaceAgents, workspaces } = await import("../src/db/schema");
  const { recordAgentUsage, usageForRun, usageForThread, usageForIssue, agentUsageSummary } =
    await import("../src/lib/agent-usage");
  const { formatTokens } = await import("../src/lib/agent-usage.shared");

  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: "u1", username: "u1", displayName: "Uma", passwordHash: "x", createdAt: now } as never);
  await db.insert(workspaces).values({ id: "w1", name: "Use", key: "USE", createdBy: "u1", createdAt: now } as never);
  await db.insert(workspaceAgents).values({
    id: "a1",
    workspaceId: "w1",
    name: "Builder",
    source: "api",
    engine: "api",
    createdBy: "u1",
    createdAt: now,
    updatedAt: now,
  } as never);
  await db.insert(workspaceAgents).values({
    id: "a2",
    workspaceId: "w1",
    name: "Reviewer",
    source: "harness",
    engine: "codex",
    createdBy: "u1",
    createdAt: now,
    updatedAt: now,
  } as never);

  // A zero-token turn leaves no row.
  await recordAgentUsage({
    workspaceId: "w1",
    userId: "u1",
    engine: "api",
    model: "m",
    source: "api",
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  });
  assert((await db.select().from(agentUsage)).length === 0, "no row for an unreported turn");

  await recordAgentUsage({
    workspaceId: "w1",
    userId: "u1",
    engine: "api",
    model: "model-a",
    source: "api",
    usage: { inputTokens: 100, outputTokens: 40, cachedTokens: 20, reasoningTokens: 10 },
    runId: "r1",
    threadId: "t1",
    messageId: "m1",
    issueId: "i1",
    agentId: "a1",
    durationMs: 1200,
  });
  await recordAgentUsage({
    workspaceId: "w1",
    userId: "u1",
    engine: "codx",
    model: "model-b",
    source: "runner",
    usage: { inputTokens: 50, outputTokens: 25, cachedTokens: 5, reasoningTokens: 0 },
    runId: "r2",
    threadId: "t2",
    issueId: "i2",
    agentId: "a2",
  });

  const run = await usageForRun("r1");
  assert(run.inputTokens === 100 && run.outputTokens === 40 && run.totalTokens === 140, "run totals");
  assert(run.cachedTokens === 20 && run.reasoningTokens === 10, "cached and reasoning tokens");
  assert((await usageForThread("t1")).totalTokens === 140, "thread totals");
  assert((await usageForIssue("i1")).inputTokens === 100, "task totals");

  const summary = await agentUsageSummary("w1");
  assert(summary.totals.totalTokens === 215, `workspace total ${summary.totals.totalTokens}`);
  assert(summary.totals.cachedTokens === 25 && summary.totals.reasoningTokens === 10, "workspace token split");
  assert(summary.byAgent.some((row) => row.agentId === "a1" && row.agentName === "Builder" && row.usage.totalTokens === 140), "by agent");
  assert(summary.byAgent.some((row) => row.agentId === "a2" && row.usage.totalTokens === 75), "second agent");
  assert(summary.byModel.some((row) => row.model === "model-a" && row.usage.totalTokens === 140), "by model");
  assert(summary.byTask.some((row) => row.issueId === "i1" && row.usage.totalTokens === 140), "by task");
  assert(summary.byDay.reduce((sum, row) => sum + row.usage.totalTokens, 0) === 215, "by day agrees");
  assert(formatTokens(215) === "215" && formatTokens(12_300).endsWith("k"), "token labels");

  const usageCode = fs.readFileSync(new URL("../src/lib/agent-usage.ts", import.meta.url), "utf8");
  assert(!/throw new .*[Bb]udget/.test(usageCode), "usage never stops a run");
  assert(!/priceTable|costUsd|usdCents/.test(usageCode), "the ledger has no price table");
  const panel = fs.readFileSync(new URL("../src/components/agent-usage-section.tsx", import.meta.url), "utf8");
  assert(panel.includes("formatTokens") && !panel.includes("USD"), "the usage view shows token counts only");
  assert(panel.includes("agent-usage-totals") && panel.includes("Tokens"), "the usage view renders totals");
  const delegation = fs.readFileSync(new URL("../src/components/issue-panel/delegation-row.tsx", import.meta.url), "utf8");
  assert(delegation.includes("delegation-tokens"), "the run panel renders tokens");
  assert(delegation.includes("Built-in API agent") && delegation.includes("Desktop runner"), "the run panel shows the source");

  console.log("check-agent-usage: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
