/**
 * The six findings left open by the 2.2 review (docs/plans/team-2.3.md item 25).
 *   node --import tsx scripts/check-security-2.2.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-sec22-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function throws(message: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof Error && err.message === message, `expected "${message}", got "${err instanceof Error ? err.message : err}"`);
    return;
  }
  throw new Error(`expected "${message}"`);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { apiKeys, users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const {
    createApiKey,
    createIssue,
    createProject,
    getIssueDetail,
    getProject,
    inviteMember,
    listIssues,
    revokeApiKey,
    setMemberRole,
    setMembersSeeAllTasks,
  } = await import("../src/lib/issues");
  const { createSiteMember, deleteSiteMember } = await import("../src/lib/admin");
  const { signIn } = await import("../src/lib/auth");
  const db = getDb();
  const [project] = await db.select().from((await import("../src/db/schema")).projects).limit(1);
  const ws = project.workspaceId;
  const [ownerRow] = await db.select().from(workspaces).where(eq(workspaces.id, ws));
  const ownerId = ownerRow.createdBy!;
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));

  const outsider = await createSiteMember({
    username: "outsider",
    displayName: "Outsider",
    password: "password1",
  });
  await inviteMember(ws, outsider.username);
  await setMembersSeeAllTasks(ws, false);
  const hidden = await createProject({ workspaceId: ws, name: "Hidden", createdBy: ownerId });
  const task = await createIssue(
    ws,
    { title: "Hidden task", project: hidden.key },
    { kind: "user", userId: ownerId, displayName: owner.displayName }
  );
  const listed = await listIssues(ws, { viewerId: outsider.id });
  assert(!listed.some((row) => row.id === task.issue.id), "a member outside the project does not see its tasks");
  assert((await getIssueDetail(ws, task.issue.id, outsider.id)) === null, "opening the task by id is refused");
  assert((await getProject(ws, hidden.id, outsider.id)) === null, "opening the project by id is refused");
  const ownerList = await listIssues(ws, { viewerId: ownerId });
  assert(ownerList.some((row) => row.id === task.issue.id), "the owner still sees the task");
  const board = fs.readFileSync(new URL("../src/app/[workspaceId]/page.tsx", import.meta.url), "utf8");
  assert(board.includes("viewerId: user.id"), "the task board applies the viewer's projects");

  const { record } = await createApiKey(ws, "member-key", ownerId);
  await throws("Only the key's owner or an admin can revoke it", () => revokeApiKey(ws, record.id, outsider.id));
  await revokeApiKey(ws, record.id, ownerId);
  const [revoked] = await db.select().from(apiKeys).where(eq(apiKeys.id, record.id));
  assert(revoked.revokedAt, "the owner can revoke the key");

  await throws("The workspace owner cannot be demoted", () => setMemberRole(ws, ownerId, "member"));
  const [still] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, ownerId));
  assert(still.role === "admin" || still.role === "member", "the owner keeps a role");
  const [ownerStill] = await db.select({ createdBy: workspaces.createdBy }).from(workspaces).where(eq(workspaces.id, ws));
  assert(ownerStill.createdBy === ownerId, "demotion did not run");

  const departing = await createSiteMember({
    username: "departing",
    displayName: "Departing",
    password: "password1",
  });
  await inviteMember(ws, departing.username);
  await db.update(workspaces).set({ createdBy: departing.id }).where(eq(workspaces.id, ws));
  await deleteSiteMember(ownerId, departing.id);
  const [handed] = await db.select({ createdBy: workspaces.createdBy }).from(workspaces).where(eq(workspaces.id, ws));
  assert(handed.createdBy && handed.createdBy !== departing.id, "a deleted owner's workspace goes to a remaining member");

  const locked = await createSiteMember({
    username: "locked",
    displayName: "Locked",
    password: "password1",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await throws("Invalid username or password", () => signIn(locked.username, "wrong-pass"));
  }
  await throws("Too many sign-in attempts. Try again later.", () => signIn(locked.username, "password1"));

  const reusable = await createSiteMember({
    username: "reusable",
    displayName: "Reusable",
    password: "password1",
  });
  await deleteSiteMember(ownerId, reusable.id);
  await throws("Username is already taken", () =>
    createSiteMember({ username: "reusable", displayName: "Again", password: "password1" })
  );

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
