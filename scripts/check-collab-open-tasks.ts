// H-COLLAB-04: the open-tasks view shows only approved, unclaimed tasks that are not done or canceled.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-open-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const web = { kind: "user", userId: user.id };
  const agent = { kind: "agent", label: "codex", via: "mcp", publishedBy: user.id };
  const mk = async (title: string, actor: unknown, extra: Record<string, unknown> = {}) =>
    ((await lib.createIssue(ws, { title, project: project.key, ...extra }, actor)) as { issue: { id: string } }).issue.id;
  const open = await mk("Open one", web);
  const claimed = await mk("Claimed one", web);
  await lib.claimIssue(ws, claimed, user.id);
  const done = await mk("Done one", web, { status: "done" });
  const pending = await mk("Pending one", agent);

  const rows = (await lib.listIssues(ws, { status: "open" })) as { id: string }[];
  const ids = new Set(rows.map((r) => r.id));
  assert(ids.has(open), "open view must show an approved, unclaimed task");
  assert(!ids.has(claimed), "open view must hide a claimed task");
  assert(!ids.has(done), "open view must hide a done task");
  assert(!ids.has(pending), "open view must hide a task that waits for review");
  console.log("check-collab-open-tasks: pass");
}

main().catch((err) => {
  console.error("check-collab-open-tasks: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
