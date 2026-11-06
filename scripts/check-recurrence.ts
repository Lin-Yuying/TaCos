/**
 * Recurring tasks (docs/plans/team-2.3.md item 24).
 * Marking one done opens the next occurrence, and a second pass does not open another.
 *   node --import tsx scripts/check-recurrence.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-recur-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { issues, projects, users } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createIssue, openNextOccurrence, updateIssue } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: user.id, displayName: user.displayName };
  const agent = { kind: "agent" as const, label: "check", via: "mcp" as const };

  const created = await createIssue(
    ws,
    { title: "Weekly review", project: project.key, dueDate: "2026-11-05", recurrence: "weekly" },
    actor
  );
  assert(created.issue.recurrence === "weekly", "the task repeats weekly");

  await updateIssue(ws, created.issue.id, { status: "done" }, agent);
  await updateIssue(ws, created.issue.id, { status: "done" }, agent);
  const again = await openNextOccurrence(ws, created.issue.id, agent);

  const rows = await db.select().from(issues).where(eq(issues.title, "Weekly review"));
  assert(rows.length === 2, `the next occurrence is created once, got ${rows.length}`);
  const next = rows.find((row) => row.id !== created.issue.id);
  assert(next?.status === "todo", "the next occurrence is open");
  assert(next?.dueDate === "2026-11-12", `the due date moves one week, got ${next?.dueDate}`);
  assert(next?.recurrence === "weekly", "the next occurrence keeps repeating");
  assert(again?.id === next?.id, "a second pass returns the same occurrence");

  const plain = await createIssue(ws, { title: "One time", project: project.key }, actor);
  await updateIssue(ws, plain.issue.id, { status: "done" }, agent);
  const plainRows = await db.select().from(issues).where(eq(issues.title, "One time"));
  assert(plainRows.length === 1, "a task without a recurrence does not open another");

  const panel = fs.readFileSync(new URL("../src/components/issue-panel/recurrence-row.tsx", import.meta.url), "utf8");
  assert(panel.includes('data-testid="recurrence"'), "the task panel sets the recurrence");

  console.log("ok");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
