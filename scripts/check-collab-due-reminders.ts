// H-COLLAB-11: a task with a due date and a reminder preset sends one "due_soon"
// notice at dueDate minus the preset. A second run sends no duplicate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-remind-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { issues, projects, users, workspaceMembers, notifications } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const lib = (await import("../src/lib/issues")) as Record<string, unknown>;
  const send = lib.sendDueReminders as ((now?: Date) => Promise<number>) | undefined;
  assert(typeof send === "function", "sendDueReminders(now) must exist");
  const { createIssue, updateIssue } = lib as never as typeof import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [me, mate] = await db.select().from(users).limit(2);
  for (const u of [me, mate]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const actor = { kind: "user", userId: me.id, displayName: me.displayName } as const;
  const created = await createIssue(ws, { title: "Reminder test", project: project.key, dueDate: "2030-01-10", reminder: "1d" } as never, actor);
  const id = created.issue.id;
  const count = async (userId: string) =>
    (await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.issueId, id), eq(notifications.type, "due_soon")))).length;

  // due moment = end of 2030-01-10 local; 1d earlier = end of 2030-01-09
  await send!(new Date(2030, 0, 9, 12, 0, 0));
  assert((await count(me.id)) === 0, "no reminder before dueDate minus preset");
  await send!(new Date(2030, 0, 10, 8, 0, 0));
  assert((await count(me.id)) === 1, "the creator must get one reminder at dueDate minus preset");
  await send!(new Date(2030, 0, 10, 9, 0, 0));
  assert((await count(me.id)) === 1, "a second run must not send a duplicate");

  await updateIssue(ws, id, { dueDate: "2030-02-10" } as never, actor);
  await send!(new Date(2030, 1, 10, 8, 0, 0));
  assert((await count(me.id)) === 2, "a new due date must arm the reminder again");

  await db.update(issues).set({ status: "done" }).where(eq(issues.id, id));
  await updateIssue(ws, id, { dueDate: "2030-03-10" } as never, actor);
  await send!(new Date(2030, 2, 10, 8, 0, 0));
  assert((await count(me.id)) === 2, "a done task must not remind");
  console.log("check-collab-due-reminders: pass");
}

main().catch((err) => {
  console.error("check-collab-due-reminders: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
