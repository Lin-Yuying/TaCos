/**
 * Release-gate review, findings 2 and 4: blockedBy visibility and Trash visibility.
 *   node --import tsx scripts/check-review-visibility.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-review-vis-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function throws(message: string, fn: () => Promise<unknown>, status?: number) {
  try {
    await fn();
  } catch (err) {
    assert(
      err instanceof Error && err.message === message,
      `expected "${message}", got "${err instanceof Error ? err.message : err}"`
    );
    if (status !== undefined) {
      assert((err as { status?: number }).status === status, `expected status ${status}`);
    }
    return;
  }
  throw new Error(`expected "${message}"`);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaces } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const {
    addDependency,
    createIssue,
    createProject,
    getIssueDetail,
    inviteMember,
    listTrashedProjects,
    removeDependency,
    restoreProject,
    setMembersSeeAllTasks,
    trashProject,
  } = await import("../src/lib/issues");
  const { createSiteMember } = await import("../src/lib/admin");
  await import("../src/lib/auth");

  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, ws));
  const ownerId = workspace.createdBy!;
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId));

  const ownerActor = { kind: "user" as const, userId: ownerId, displayName: owner.displayName };
  const outsider = await createSiteMember({
    username: "visibilityoutsider",
    displayName: "Visibility Outsider",
    password: "password1",
  });
  const outsiderActor = {
    kind: "user" as const,
    userId: outsider.id,
    displayName: outsider.displayName,
  };
  await inviteMember(ws, outsider.username);
  await setMembersSeeAllTasks(ws, false);

  const hidden = await createProject({ workspaceId: ws, name: "Hidden Review", createdBy: ownerId });
  const hiddenTask = await createIssue(ws, { title: "Hidden dependency", project: hidden.key }, ownerActor);
  const own = await createProject({ workspaceId: ws, name: "Outsider Own", createdBy: outsider.id });
  const targetTask = await createIssue(ws, { title: "Outsider task", project: own.key }, outsiderActor);
  const blockedByIdentifier = hiddenTask.issue.identifier;
  const refused = `Issue "${blockedByIdentifier}" not found`;

  // 1. A task in a hidden project named as blockedBy is refused by addDependency.
  await throws(refused, () =>
    addDependency(ws, targetTask.issue.id, blockedByIdentifier, outsider.id, outsiderActor)
  );

  // The owner, who sees all tasks, links it so a real dependency row exists.
  const linked = await addDependency(ws, targetTask.issue.id, blockedByIdentifier, ownerId, ownerActor);
  assert(linked.dependencies.some((item) => item.id === hiddenTask.issue.id), "the owner sees the linked dependency");

  // 2. removeDependency refuses the same hidden blockedBy even though the row exists.
  await throws(refused, () =>
    removeDependency(ws, targetTask.issue.id, blockedByIdentifier, outsider.id, outsiderActor)
  );

  // The hidden dependency never leaks into a restricted viewer's task detail.
  const outsiderDetail = await getIssueDetail(ws, targetTask.issue.id, outsider.id);
  assert(outsiderDetail, "the outsider can open their own task");
  assert(
    !outsiderDetail!.dependencies.some((item) => item.id === hiddenTask.issue.id),
    "a hidden project's dependency is filtered from the outsider's detail"
  );

  // 3. Trash list does not leak hidden projects; the owner still sees them; a no-viewer
  // call keeps the original full behaviour.
  await trashProject(ws, hidden.id, ownerId);
  assert(
    !(await listTrashedProjects(ws, outsider.id)).some((row) => row.id === hidden.id),
    "the outsider does not see the hidden project in Trash"
  );

  // ownProjectCondition requires deleted_at IS NULL, which no Trash row satisfies.
  // A restricted member must still see the projects they deleted themselves.
  const ownTrashed = await createProject({
    workspaceId: ws,
    name: "Outsider Trashed",
    createdBy: outsider.id,
  });
  await trashProject(ws, ownTrashed.id, outsider.id);
  const outsiderTrash = await listTrashedProjects(ws, outsider.id);
  assert(
    outsiderTrash.some((row) => row.id === ownTrashed.id),
    "a restricted member sees a project they deleted themselves"
  );
  assert(
    !outsiderTrash.some((row) => row.id === hidden.id),
    "seeing their own Trash project does not expose the hidden project"
  );
  assert(
    (await listTrashedProjects(ws, ownerId)).some((row) => row.id === hidden.id),
    "the owner still sees the hidden project in Trash"
  );
  assert(
    (await listTrashedProjects(ws)).some((row) => row.id === hidden.id),
    "a no-viewer call keeps the full behaviour"
  );

  // 4. Restoring is owner-only: the outsider gets 403 and the row stays trashed;
  // the owner restores it and deletedAt goes back to null.
  await throws(
    "Only the project creator or the workspace owner can delete this project",
    () => restoreProject(ws, hidden.id, outsider.id),
    403
  );
  const [stillTrashed] = await db
    .select({ deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, hidden.id));
  assert(stillTrashed.deletedAt, "a refused restore leaves the project in Trash");
  await restoreProject(ws, hidden.id, ownerId);
  const [restored] = await db
    .select({ deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, hidden.id));
  assert(restored.deletedAt === null, "the owner restores the project (deletedAt is null)");

  // The restricted member restores their own project too.
  await restoreProject(ws, ownTrashed.id, outsider.id);
  const [ownRestored] = await db
    .select({ deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, ownTrashed.id));
  assert(ownRestored.deletedAt === null, "a restricted member restores a project they deleted themselves");

  console.log("check-review-visibility: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
