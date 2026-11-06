/**
 * Blocker report (docs/plans/team-2.3.md item 21).
 * A report is a row on the task, and the notice goes to the assignee.
 * When the reporter is that assignee, the notice goes to the person who opened the task.
 *   node --import tsx scripts/check-blocker-report.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-blocker-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, notifications, events, blockers, workspaceMembers } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const { createIssue, reportBlocker } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const members = await db.select({ id: users.id, displayName: users.displayName }).from(users).limit(2);
  assert(members.length >= 2, "need two members");
  for (const member of members) {
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws, userId: member.id, role: "member", createdAt: new Date().toISOString() })
      .onConflictDoNothing();
  }
  const [creator, assignee] = members;
  const created = await createIssue(
    ws,
    { title: "Stuck work", project: project.key, assigneeIds: [assignee.id] },
    { kind: "user", userId: creator.id, displayName: creator.displayName }
  );
  const issueId = created.issue.id;

  const reported = await reportBlocker(ws, issueId, "Waiting on the API", {
    kind: "user",
    userId: creator.id,
    displayName: creator.displayName,
  });
  const [row] = await db.select().from(blockers).where(eq(blockers.id, reported.id));
  assert(row?.issueId === issueId && row.body === "Waiting on the API", "the report is a record on the task");
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.issueId, issueId), eq(events.type, "blocker_reported")));
  assert(event, "the report is recorded on the task");
  const notices = async (userId: string) =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.issueId, issueId), eq(notifications.type, "blocker")));
  assert((await notices(assignee.id)).length === 1, "the assignee is notified");
  assert((await notices(creator.id)).length === 0, "the reporter is not notified");

  await reportBlocker(ws, issueId, "Still stuck", {
    kind: "user",
    userId: assignee.id,
    displayName: assignee.displayName,
  });
  assert((await notices(creator.id)).length === 1, "an assignee's report notifies the person who opened the task");
  assert((await notices(assignee.id)).length === 1, "an assignee's own report does not notify them again");

  let empty = false;
  try {
    await reportBlocker(ws, issueId, "   ", { kind: "user", userId: creator.id, displayName: creator.displayName });
  } catch (err) {
    empty = err instanceof Error && err.message === "Say what is blocking this task";
  }
  assert(empty, "an empty report is refused");
  const rows = await db.select().from(blockers).where(eq(blockers.issueId, issueId));
  assert(rows.length === 2, "a refused report does not add a record");

  const panel = fs.readFileSync(new URL("../src/components/issue-panel/blocker-report.tsx", import.meta.url), "utf8");
  const action = fs.readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
  assert(panel.includes('data-testid="blocker-report"'), "the task panel can report a blocker");
  assert(action.includes("reportBlocker("), "the task panel calls the report");

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
