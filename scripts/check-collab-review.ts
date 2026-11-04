// H-COLLAB-03: a person approves or rejects agent tasks. Approved tasks become claimable. Rejected tasks leave the board.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-review-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  for (const fn of ["reviewIssue", "listPendingReview"]) assert(typeof lib[fn] === "function", `${fn} required`);
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const agent = { kind: "agent", label: "codex", via: "mcp", publishedBy: user.id };
  const a = (await lib.createIssue(ws, { title: "Agent A", project: project.key }, agent)) as { issue: { id: string } };
  const b = (await lib.createIssue(ws, { title: "Agent B", project: project.key }, agent)) as { issue: { id: string } };

  const pending = (await lib.listPendingReview(ws)) as { id: string }[];
  assert(pending.some((r) => r.id === a.issue.id) && pending.some((r) => r.id === b.issue.id), "pending list must show both");

  const approved = (await lib.reviewIssue(ws, a.issue.id, user.id, "approve")) as { reviewStatus: string; reviewedBy: string };
  assert(approved.reviewStatus === "approved" && approved.reviewedBy === user.id, "approve sets status and reviewer");
  let twice = false;
  try { await lib.reviewIssue(ws, a.issue.id, user.id, "reject"); } catch { twice = true; }
  assert(twice, "a reviewed task must refuse a second review");
  await lib.claimIssue(ws, a.issue.id, user.id);

  await lib.reviewIssue(ws, b.issue.id, user.id, "reject");
  const board = (await lib.listIssues(ws, {})) as { id: string }[];
  assert(!board.some((r) => r.id === b.issue.id), "rejected task must leave the board");
  const after = (await lib.listPendingReview(ws)) as { id: string }[];
  assert(after.length === 0, "pending list must be empty");
  console.log("check-collab-review: pass");
}

main().catch((err) => {
  console.error("check-collab-review: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
