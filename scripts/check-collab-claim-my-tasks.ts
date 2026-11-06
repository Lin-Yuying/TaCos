// A claimed task shows up in the claimer's My Tasks (listIssues assigneeId), and leaves it on release.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-claim-my-tasks-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/db/client");
  const { issues, issueAssignees, workspaceMembers } = await import("../src/db/schema");
  const { claimIssue, releaseIssue, listIssues } = await import("../src/lib/issues");

  const db = getDb();
  const assigned = new Set((await db.select().from(issueAssignees)).map((r) => r.issueId));
  const candidates = await db.select().from(issues).where(eq(issues.reviewStatus, "approved"));
  const issue = candidates.find((i) => !assigned.has(i.id) && !i.claimedBy && (i.status === "todo" || i.status === "in_progress"));
  assert(issue, "seed data needs an approved, open, unassigned task");
  const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, issue.workspaceId)).limit(1);
  assert(member, "seed data needs a workspace member");
  const me = member.userId;

  const mine = async () => (await listIssues(issue.workspaceId, { assigneeId: me })).map((i) => i.id);

  assert(!(await mine()).includes(issue.id), "task must not be in My Tasks before the claim");
  await claimIssue(issue.workspaceId, issue.id, me);
  assert((await mine()).includes(issue.id), "claimed task must appear in the claimer's My Tasks");
  const open = await listIssues(issue.workspaceId, { status: "open" });
  assert(!open.some((i) => i.id === issue.id), "claimed task must leave Open Tasks");
  const unassigned = await listIssues(issue.workspaceId, { assigneeId: null });
  assert(unassigned.some((i) => i.id === issue.id), "claim must not change assignees");

  await releaseIssue(issue.workspaceId, issue.id, me);
  assert(!(await mine()).includes(issue.id), "released task must leave My Tasks");
  console.log("check-collab-claim-my-tasks: pass");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
