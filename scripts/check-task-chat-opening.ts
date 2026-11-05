/**
 * docs/plans/team-2.3.md item 6: "Work on it in chat" sends the opening turn once on a new
 * empty task chat; reopening sends nothing.
 *   node --import tsx scripts/check-task-chat-opening.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-task-chat-open-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const advance = fs.readFileSync("src/components/issue-panel/advance-button.tsx", "utf8");
  assert(advance.includes('t("Work on it in chat")'), "advance button uses the new label");
  assert(advance.includes("openingMessage"), "advance button reads openingMessage from the action");
  assert(advance.includes("tacos:agent:pending:"), "advance button queues the opening turn for the chat view");

  const handoff = fs.readFileSync("src/components/issue-panel/handoff-row.tsx", "utf8");
  assert(handoff.includes('t("Hand to Agent in background")'), "handoff button uses the new label");

  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers } = await import("../src/db/schema");
  const { createIssue } = await import("../src/lib/issues");
  const { startTaskChat, taskChatOpeningMessage } = await import("../src/lib/agent-threads");

  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [me] = await db.select().from(users).limit(1);
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws, userId: me.id, createdAt: new Date().toISOString() })
    .onConflictDoNothing();

  const created = await createIssue(
    ws,
    { title: "Ship the feature", description: "Do the thing.", project: project.key },
    { kind: "user", userId: me.id, displayName: me.displayName }
  );
  const task = created.issue;
  const expected = taskChatOpeningMessage(task.identifier);

  const first = await startTaskChat(ws, task.id, me.id);
  assert(first.openingMessage === expected, "a new empty task chat must offer one opening message");
  assert(first.thread.id, "a new task chat must return the thread");

  const second = await startTaskChat(ws, task.id, me.id);
  assert(second.thread.id === first.thread.id, "a second open must reuse the same chat");
  assert(second.openingMessage === null, "an existing task chat must not send an opening message again");

  console.log("check-task-chat-opening: pass");
}

main().catch((err) => {
  console.error("check-task-chat-opening: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
