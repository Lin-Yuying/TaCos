/**
 * Agent view for tasks (docs/plans/team-2.3.md item 20).
 * The view lists tasks an agent created and leaves out tasks a person opened.
 *   node --import tsx scripts/check-agent-task-view.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-agent-view-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const { createIssue, listIssues, reviewIssue } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const person = { kind: "user" as const, userId: user.id, displayName: user.displayName };
  const agent = { kind: "agent" as const, label: "codex", via: "mcp" as const, publishedBy: user.id };

  const human = await createIssue(ws, { title: "Opened by a person", project: project.key }, person);
  const published = await createIssue(ws, { title: "Opened by the agent", project: project.key }, agent);
  const rejected = await createIssue(ws, { title: "Rejected agent task", project: project.key }, agent);
  await reviewIssue(ws, rejected.issue.id, user.id, "reject");
  await reviewIssue(ws, published.issue.id, user.id, "approve");

  const rows = await listIssues(ws, { agent: true });
  const ids = rows.map((row) => row.id);
  assert(ids.includes(published.issue.id), "an agent task is in the view");
  assert(!ids.includes(human.issue.id), "a person's task is not in the view");
  assert(!ids.includes(rejected.issue.id), "a rejected agent task is not in the view");
  assert(rows.every((row) => row.createdVia === "api" || row.createdVia === "mcp"), "every row was created by an agent");

  const page = fs.readFileSync(new URL("../src/app/[workspaceId]/page.tsx", import.meta.url), "utf8");
  const nav = fs.readFileSync(new URL("../src/components/workspace-shell.tsx", import.meta.url), "utf8");
  assert(page.includes('view === "agent"'), "the tasks page asks for the agent view");
  assert(nav.includes('view: "agent"'), "the task list links to the agent view");

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
