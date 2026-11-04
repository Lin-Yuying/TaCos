// H-COLLAB-02: agent-created tasks carry the publisher and creator, and start as pending review.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-publish-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const { executeAgentTool } = await import("../src/lib/agent-tools");
  const { createIssue, findIssueRow } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  assert(project && user, "seed data required");
  const ctx = { workspaceId: project.workspaceId, projectId: project.id, projectKey: project.key, userId: user.id, threadId: "thread-test" };
  const out = (await executeAgentTool(ctx, "create_task", { title: "Agent published task" })).text;
  const identifier = /Created (\S+)/.exec(out)?.[1];
  assert(identifier, `agent create failed: ${out}`);
  const row = (await findIssueRow(project.workspaceId, identifier)) as Record<string, unknown> | null;
  assert(row, "agent task row required");
  assert(row.createdBy === user.id, `agent task createdBy must be the user, got ${row.createdBy}`);
  assert(row.publishedBy === user.id, `agent task publishedBy must be the user, got ${row.publishedBy}`);
  assert(row.reviewStatus === "pending", `agent task must be pending, got ${row.reviewStatus}`);
  assert(row.sourceThreadId === "thread-test", `agent task sourceThreadId required, got ${row.sourceThreadId}`);

  const human = await createIssue(project.workspaceId, { title: "Human task", project: project.key }, { kind: "user", userId: user.id, displayName: user.displayName });
  const issue = human.issue as unknown as Record<string, unknown>;
  assert(issue.publishedBy === user.id, "human task publishedBy must be the user");
  assert(issue.reviewStatus === "approved", "human task must be approved");
  console.log("check-collab-agent-publish: pass");
}

main().catch((err) => {
  console.error("check-collab-agent-publish: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
