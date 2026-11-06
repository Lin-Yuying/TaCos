/**
 * Subtasks (docs/plans/team-2.3.md item 22).
 * A child stays in its parent's project, and a loop is refused.
 * The task panel, the REST API and the agent tools all use that rule.
 *   node --import tsx scripts/check-subtasks.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-subtasks-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const { createIssue, createProject, createApiKey, getIssueDetail, updateIssue } = await import("../src/lib/issues");
  const { executeAgentTool } = await import("../src/lib/agent-tools");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: user.id, displayName: user.displayName };

  const parent = await createIssue(ws, { title: "Parent task", project: project.key }, actor);
  const child = await createIssue(
    ws,
    { title: "Child task", project: project.key, parent: parent.issue.identifier },
    actor
  );
  assert(child.issue.parentId === parent.issue.id, "a subtask records its parent");
  const detail = await getIssueDetail(ws, parent.issue.id);
  assert(detail?.children.some((row) => row.id === child.issue.id), "the parent lists the subtask");

  const other = await createProject({ workspaceId: ws, name: "Other", createdBy: user.id });
  let crossed = false;
  try {
    await createIssue(ws, { title: "Wrong project", project: other.key, parent: parent.issue.id }, actor);
  } catch (err) {
    crossed = err instanceof Error && err.message === "A subtask stays in its parent's project";
  }
  assert(crossed, "a subtask cannot leave its parent's project");

  let loop = false;
  try {
    await updateIssue(ws, parent.issue.id, { parent: child.issue.identifier }, actor);
  } catch (err) {
    loop = err instanceof Error && err.message === "A task cannot sit inside its own subtask";
  }
  assert(loop, "a parent cannot move inside its subtask");

  let self = false;
  try {
    await updateIssue(ws, child.issue.id, { parent: child.issue.id }, actor);
  } catch (err) {
    self = err instanceof Error && err.message === "A task cannot be a subtask of itself";
  }
  assert(self, "a task cannot be a subtask of itself");

  const { key } = await createApiKey(ws, "subtasks", ["read", "write"], null, 90, user.id);
  const { POST } = await import("../src/app/api/v1/issues/route");
  const created = await POST(
    new Request("http://localhost/api/v1/issues", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ title: "From the API", project: project.key, parent: parent.issue.identifier }),
    })
  );
  const createdBody = (await created.json()) as { parentId?: string; error?: string; identifier?: string };
  assert(created.status === 201 && createdBody.parentId === parent.issue.id, `REST create failed: ${created.status} ${createdBody.error ?? ""}`);

  const { PATCH } = await import("../src/app/api/v1/issues/[id]/route");
  const refused = await PATCH(
    new Request(`http://localhost/api/v1/issues/${parent.issue.identifier}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ parent: child.issue.identifier }),
    }),
    { params: Promise.resolve({ id: parent.issue.identifier }) }
  );
  const refusedBody = (await refused.json()) as { error?: string };
  assert(refused.status === 400 && refusedBody.error === "A task cannot sit inside its own subtask", "REST refuses a loop");

  const ctx = { workspaceId: ws, projectId: project.id, projectKey: project.key, userId: user.id };
  const agent = await executeAgentTool(ctx, "create_task", {
    workspace: ws,
    title: "From the agent",
    parent: parent.issue.identifier,
  });
  const identifier = /Created (\S+)/.exec(agent.text)?.[1];
  assert(identifier, `agent create failed: ${agent.text}`);
  const agentRow = await getIssueDetail(ws, identifier);
  assert(agentRow?.issue.parentId === parent.issue.id, "the agent tool records the parent");
  let agentLoop = false;
  try {
    await executeAgentTool(ctx, "update_task", {
      workspace: ws,
      id: parent.issue.identifier,
      parent: child.issue.identifier,
    });
  } catch (err) {
    agentLoop = err instanceof Error && err.message === "A task cannot sit inside its own subtask";
  }
  assert(agentLoop, "the agent tool refuses a loop");

  const panel = fs.readFileSync(new URL("../src/components/issue-panel/index.tsx", import.meta.url), "utf8");
  const subtasks = fs.readFileSync(new URL("../src/components/issue-panel/subtasks.tsx", import.meta.url), "utf8");
  const mcp = fs.readFileSync(new URL("../mcp/server.ts", import.meta.url), "utf8");
  assert(panel.includes("parent: detail.id"), "the task panel sends the parent");
  assert(subtasks.includes('data-testid="subtasks"'), "the task panel lists subtasks");
  assert(mcp.includes("parent,"), "the MCP server passes the parent through");

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
