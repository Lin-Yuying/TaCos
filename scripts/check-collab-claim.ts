// H-COLLAB-01: claim columns exist, claim is atomic, release clears it, assignees stay, pending tasks refuse.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-claim-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { issues, users, issueAssignees } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as Record<string, unknown>;
  const claimIssue = lib.claimIssue as (w: string, id: string, u: string) => Promise<{ claimedBy: string | null }>;
  const releaseIssue = lib.releaseIssue as (w: string, id: string, u: string) => Promise<{ claimedBy: string | null }>;
  assert(typeof claimIssue === "function", "claimIssue required");
  assert(typeof releaseIssue === "function", "releaseIssue required");

  const db = getDb();
  const cols = (db as unknown as { $client: { prepare(s: string): { all(): { name: string }[] } } }).$client
    .prepare("PRAGMA table_info(issues)")
    .all()
    .map((c) => c.name);
  for (const c of ["claimed_by", "claimed_at", "source_thread_id", "published_by", "review_status", "reviewed_by", "reviewed_at"]) {
    assert(cols.includes(c), `issues.${c} required`);
  }

  const [issue] = await db.select().from(issues).limit(1);
  const allUsers = await db.select().from(users).limit(2);
  assert(issue && allUsers.length >= 1, "seed data required");
  const a = allUsers[0].id;
  const b = allUsers[1]?.id ?? a + "-other";
  const before = await db.select().from(issueAssignees);
  const beforeCount = before.filter((r) => r.issueId === issue.id).length;

  const results = await Promise.allSettled([
    claimIssue(issue.workspaceId, issue.id, a),
    claimIssue(issue.workspaceId, issue.id, b),
  ]);
  const wins = results.filter((r) => r.status === "fulfilled");
  assert(wins.length === 1, `exactly one claim must win, got ${wins.length}`);
  const winner = (wins[0] as PromiseFulfilledResult<{ claimedBy: string | null }>).value.claimedBy!;
  const loser = winner === a ? b : a;
  const after = await db.select().from(issueAssignees);
  assert(after.filter((r) => r.issueId === issue.id).length === beforeCount, "claim must not change assignees");

  let refused = false;
  try { await releaseIssue(issue.workspaceId, issue.id, loser); } catch { refused = true; }
  assert(refused, "only the claimer may release");
  const released = await releaseIssue(issue.workspaceId, issue.id, winner);
  assert(released.claimedBy === null, "release must clear the claim");

  const { eq } = await import("drizzle-orm");
  await db.update(issues).set({ reviewStatus: "pending" } as never).where(eq(issues.id, issue.id));
  let pendingRefused = false;
  try { await claimIssue(issue.workspaceId, issue.id, a); } catch { pendingRefused = true; }
  assert(pendingRefused, "pending review task must not be claimable");
  console.log("check-collab-claim: pass");
}

main().catch((err) => {
  console.error("check-collab-claim: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
