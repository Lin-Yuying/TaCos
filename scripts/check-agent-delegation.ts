/**
 * #79 delegation and review: a human keeps the task, an agent is delegated, the run comes
 * back as a comment with a review state, notifications and filters. Exercises the real API
 * loop against a fake OpenAI-compatible server. Run: npx tsx scripts/check-agent-delegation.ts
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-delegation-"));
process.env.TACOS_SEED_DEMO = "0";
delete process.env.TACOS_SERVER_MODE;

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what: string, test: () => boolean | Promise<boolean>, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await test()) return;
    await sleep(80);
  }
  assert(false, `timed out waiting for ${what}`);
}

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "The task is done. " } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Nothing is left." } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 } } })}\n\n` +
      `data: [DONE]\n\n`
  );
  res.end();
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const { getDb } = await import("../src/db/client");
  const { agentRuns, comments, issueAssignees, issues, notifications, projectMembers, projects, users, workspaceMembers, workspaces } =
    await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { saveModelEndpoint } = await import("../src/lib/model-keys");
  const { createAgent } = await import("../src/lib/workspace-agents");
  const { delegateTask, delegationPanel, reviewDelegation } = await import("../src/lib/agent-delegation");
  const { listIssues } = await import("../src/lib/issues");

  const db = getDb();
  const now = new Date().toISOString();
  for (const id of ["u1", "u2"]) {
    await db.insert(users).values({ id, username: id, displayName: id === "u1" ? "Uma" : "Ugo", passwordHash: "x", createdAt: now } as never);
  }
  await db.insert(workspaces).values({ id: "w1", name: "Del", key: "DEL", createdBy: "u1", createdAt: now, membersSeeAllTasks: 1 } as never);
  for (const userId of ["u1", "u2"]) {
    await db.insert(workspaceMembers).values({ workspaceId: "w1", userId, role: userId === "u1" ? "admin" : "member", createdAt: now } as never);
  }
  await db.insert(projects).values({ id: "p1", workspaceId: "w1", key: "DEL", name: "One", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  await db.insert(projects).values({ id: "p2", workspaceId: "w1", key: "OTH", name: "Two", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  for (const projectId of ["p1", "p2"]) {
    await db.insert(projectMembers).values({ projectId, userId: "u1", createdAt: now } as never);
  }
  await db.insert(issues).values({
    id: "i1",
    workspaceId: "w1",
    projectId: "p1",
    number: 1,
    identifier: "DEL-1",
    title: "Ship the thing",
    description: "",
    createdBy: "u1",
    createdAt: now,
    updatedAt: now,
  } as never);
  // The human keeps the task even after delegation.
  await db.insert(issueAssignees).values({ issueId: "i1", userId: "u2", createdAt: now } as never);

  await saveModelEndpoint("u1", { label: "Fake", baseUrl, key: "secret-key", models: "" });
  const api = await createAgent({
    workspaceId: "w1",
    userId: "u1",
    name: "Builder",
    source: "api",
    approval: "ask",
    projectIds: ["p1"],
  });
  const personal = await createAgent({
    workspaceId: "w1",
    userId: "u1",
    name: "Scoped elsewhere",
    source: "api",
    projectIds: ["p2"],
  });

  await delegationPanel("w1", "i1", "u1"); // options resolve without a runner

  // Project scope is enforced in lib, not only in the picker.
  await delegateTask({ workspaceId: "w1", issueId: "i1", userId: "u1", agentId: personal.id }).then(
    () => assert(false, "an agent scoped to another project is refused"),
    (err: Error) => assert(/project/.test(err.message), err.message)
  );

  const started = await delegateTask({ workspaceId: "w1", issueId: "i1", userId: "u1", agentId: api.id, note: "Use short sentences." });
  assert(started.run?.source === "api", "API agent runs in process");
  assert(started.run?.status === "running" || started.run?.status === "queued", "run started");
  assert(started.agent?.id === api.id, "panel names the agent");

  await until("the delegated API run to finish", () => {
    const [row] = db.select().from(agentRuns).where(eq(agentRuns.issueId, "i1")).all();
    return row?.status === "done";
  });
  const [run] = db.select().from(agentRuns).where(eq(agentRuns.issueId, "i1")).all();
  assert(run.reviewStatus === "pending", "a finished run waits for review");
  const [issue] = db.select().from(issues).where(eq(issues.id, "i1")).all();
  assert(issue.delegationStatus === "review", "the task shows review");
  assert(issue.delegatedAgentId === api.id, "the task names its agent");
  const assigned = db.select().from(issueAssignees).where(eq(issueAssignees.issueId, "i1")).all();
  assert(assigned.length === 1 && assigned[0].userId === "u2", "the human assignee keeps ownership");
  const said = db.select().from(comments).where(eq(comments.issueId, "i1")).all();
  assert(said.some((comment) => comment.body.includes("The task is done")), "the result is a comment");
  assert(said.some((comment) => comment.agentAuthor === "Builder"), "the comment names the agent");
  const notices = db.select().from(notifications).where(eq(notifications.issueId, "i1")).all();
  assert(notices.some((row) => row.type === "delegation_started" && row.userId === "u2"), "start notified the assignee");
  assert(notices.some((row) => row.type === "delegation_review" && row.userId === "u2"), "review notified the assignee");
  assert(notices.some((row) => row.type === "delegation_review" && row.userId === "u1"), "review notified the requester");
  const usage = (await import("../src/lib/agent-usage")).usageForRun(run.id);
  assert((await usage).totalTokens === 26 && (await usage).cachedTokens === 4, "tokens are recorded per run");

  const listed = await listIssues("w1", { delegated: true });
  assert(listed.some((row) => row.id === "i1"), "the delegated filter lists the task");
  const byAgent = await listIssues("w1", { delegatedAgentId: api.id });
  assert(byAgent.some((row) => row.id === "i1"), "the per-agent filter lists the task");

  // Approve.
  const approved = await reviewDelegation({ workspaceId: "w1", issueId: "i1", userId: "u2", action: "approve" });
  assert(approved.status === "approved", "approval is recorded");
  const [approvedRun] = db.select().from(agentRuns).where(eq(agentRuns.id, run.id)).all();
  assert(approvedRun.reviewStatus === "approved", "the run is approved");

  // Request changes starts the same agent again with the note.
  const changes = await reviewDelegation({
    workspaceId: "w1",
    issueId: "i1",
    userId: "u2",
    action: "request_changes",
    note: "Name the next step.",
  });
  assert(changes.run?.runId !== run.id, "request changes starts a new run");
  await until("the second run to finish", () => {
    return db.select().from(agentRuns).where(eq(agentRuns.id, changes.run!.runId)).get()?.status === "done";
  });

  // A harness agent that cannot run falls back to the API loop and says so in the payload.
  const fallbackAgent = await createAgent({
    workspaceId: "w1",
    userId: "u1",
    name: "Fallback",
    source: "harness",
    engine: "acp",
    projectIds: [],
  });
  await db.update(issues).set({ status: "todo", delegationRunId: null, delegationStatus: null, delegatedAgentId: null }).where(eq(issues.id, "i1"));
  const fallback = await delegateTask({ workspaceId: "w1", issueId: "i1", userId: "u1", agentId: fallbackAgent.id });
  assert(fallback.run?.source === "api", "an unavailable harness falls back to the API agent");
  assert(fallback.run?.fallback === true, "the run panel shows the fallback");
  const [fallbackRow] = db.select().from(agentRuns).where(eq(agentRuns.id, fallback.run!.runId)).all();
  assert(JSON.parse(fallbackRow.payload).fallbackFrom === "acp", "the payload records the harness that was away");
  await until("the fallback run to finish", () => {
    return db.select().from(agentRuns).where(eq(agentRuns.id, fallback.run!.runId)).get()?.status === "done";
  });

  server.close();
  console.log("check-agent-delegation: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  server.close();
  process.exit(1);
});
