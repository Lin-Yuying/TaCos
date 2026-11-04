// H-COLLAB-05: claim, release and transfer record events and notify the creator, the assignees and the new claimer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-claimnotify-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, notifications, events, workspaceMembers } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  assert(typeof lib.transferClaim === "function", "transferClaim required");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const members = await db.select({ id: users.id }).from(users).limit(3);
  for (const m of members) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: m.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  assert(members.length >= 3, "need three members");
  const [creator, assignee, claimer] = members.map((m) => m.id);
  const created = (await lib.createIssue(
    ws,
    { title: "Shared work", project: project.key, assigneeIds: [assignee] },
    { kind: "user", userId: creator, displayName: "Creator" }
  )) as { issue: { id: string } };
  const id = created.issue.id;
  const count = async (userId: string, type: string) =>
    (await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type), eq(notifications.issueId, id)))).length;
  const hasEvent = async (type: string) =>
    (await db.select().from(events).where(and(eq(events.issueId, id), eq(events.type, type)))).length > 0;

  await lib.claimIssue(ws, id, claimer);
  assert(await hasEvent("claimed"), "claim must record an event");
  assert((await count(creator, "claimed")) === 1 && (await count(assignee, "claimed")) === 1, "claim must notify creator and assignee");
  assert((await count(claimer, "claimed")) === 0, "claim must not notify the claimer");

  let refused = false;
  try { await lib.transferClaim(ws, id, assignee, creator); } catch { refused = true; }
  assert(refused, "only the claimer can transfer");
  await lib.transferClaim(ws, id, claimer, assignee);
  assert(await hasEvent("claim_transferred"), "transfer must record an event");
  assert((await count(assignee, "claim_transferred")) === 1, "transfer must notify the new claimer");

  await lib.releaseIssue(ws, id, assignee);
  assert(await hasEvent("released"), "release must record an event");
  assert((await count(creator, "released")) === 1, "release must notify the creator");
  console.log("check-collab-claim-notify: pass");
}

main().catch((err) => {
  console.error("check-collab-claim-notify: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
