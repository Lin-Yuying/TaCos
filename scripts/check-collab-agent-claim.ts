// H-COLLAB-06: the agent claim_task tool is a write tool. It claims for the current user and refuses a pending task.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-agentclaim-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const { executeAgentTool, AGENT_TOOLS } = await import("../src/lib/agent-tools");
  const { createIssue, findIssueRow } = await import("../src/lib/issues");
  const spec = AGENT_TOOLS.find((t) => t.name === "claim_task");
  assert(spec, "claim_task tool required");
  assert(spec.write === true, "claim_task must be a write tool so it waits for the approval card");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ctx = { workspaceId: project.workspaceId, projectId: project.id, projectKey: project.key, userId: user.id };
  const human = await createIssue(project.workspaceId, { title: "Claim me", project: project.key }, { kind: "user", userId: user.id, displayName: user.displayName });
  const out = (await executeAgentTool(ctx, "claim_task", { workspace: ctx.workspaceId, id: human.issue.identifier })).text;
  const row = await findIssueRow(project.workspaceId, human.issue.identifier);
  assert(row?.claimedBy === user.id, `claim_task must claim for the user: ${out}`);

  const agentOut = (await executeAgentTool(ctx, "create_task", { workspace: ctx.workspaceId, title: "Pending one" })).text;
  const pendingId = /Created (\S+)/.exec(agentOut)?.[1];
  let refused = false;
  try { await executeAgentTool(ctx, "claim_task", { workspace: ctx.workspaceId, id: pendingId }); } catch { refused = true; }
  assert(refused, "claim_task must refuse a task that waits for review");

  const open = JSON.parse((await executeAgentTool(ctx, "list_tasks", { status: "open" })).text) as { tasks: { identifier: string }[] };
  assert(!open.tasks.some((t) => t.identifier === human.issue.identifier), "list_tasks open must hide the claimed task");
  console.log("check-collab-agent-claim: pass");
}

main().catch((err) => {
  console.error("check-collab-agent-claim: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
