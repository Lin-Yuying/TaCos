/**
 * Task dependencies (docs/plans/team-2.3.md item 23).
 * A cycle is refused. A task stays blocked while a dependency is still open.
 *   node --import tsx scripts/check-task-dependencies.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-deps-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const { addDependency, createIssue, getIssueDetail, updateIssue } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: user.id, displayName: user.displayName };
  const agent = { kind: "agent" as const, label: "check", via: "mcp" as const };

  const first = await createIssue(ws, { title: "First", project: project.key }, actor);
  const second = await createIssue(ws, { title: "Second", project: project.key }, actor);
  const third = await createIssue(ws, { title: "Third", project: project.key }, actor);

  const linked = await addDependency(ws, first.issue.id, second.issue.identifier, actor);
  assert(linked.blocked, "an open dependency blocks the task");
  assert(linked.dependencies.some((item) => item.id === second.issue.id), "the blocking task is listed");

  let loop = false;
  try {
    await addDependency(ws, second.issue.id, first.issue.identifier, actor);
  } catch (err) {
    loop = err instanceof Error && err.message === "That dependency would loop";
  }
  assert(loop, "a two-task loop is refused");

  await addDependency(ws, second.issue.id, third.issue.identifier, actor);
  let longer = false;
  try {
    await addDependency(ws, third.issue.id, first.issue.identifier, actor);
  } catch (err) {
    longer = err instanceof Error && err.message === "That dependency would loop";
  }
  assert(longer, "a longer loop is refused");

  let self = false;
  try {
    await addDependency(ws, first.issue.id, first.issue.identifier, actor);
  } catch (err) {
    self = err instanceof Error && err.message === "A task cannot depend on itself";
  }
  assert(self, "a task cannot depend on itself");

  await updateIssue(ws, second.issue.id, { status: "done" }, agent);
  const cleared = await getIssueDetail(ws, first.issue.id);
  assert(cleared?.blocked === false, "a finished dependency no longer blocks the task");

  const panel = fs.readFileSync(new URL("../src/components/issue-panel/dependencies.tsx", import.meta.url), "utf8");
  assert(panel.includes('data-testid="task-blocked"') && panel.includes('t("Blocked")'), "the task panel shows Blocked");

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
