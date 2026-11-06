// H-COLLAB-08: "用 Agent 推进" claims an open task, opens a chat with the task context, and links them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-advance-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers, issues } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const threads = (await import("../src/lib/agent-threads")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const { createIssue } = await import("../src/lib/issues");
  const { agentContext } = await import("../src/lib/ai");
  assert(typeof threads.startTaskChat === "function", "startTaskChat required");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [me, other] = await db.select().from(users).limit(2);
  for (const u of [me, other]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const created = await createIssue(ws, { title: "Fix the login bug", description: "Steps: open login.", project: project.key }, { kind: "user", userId: me.id, displayName: me.displayName });
  const task = created.issue;

  const open1 = (await threads.startTaskChat(ws, task.id, me.id)) as {
    thread: { id: string; title: string; projectId: string };
    openingMessage: string | null;
  };
  const t1 = open1.thread;
  assert(open1.openingMessage, "a new task chat must include an opening message");
  const [row] = await db.select().from(issues).where(eq(issues.id, task.id));
  assert(row.claimedBy === me.id, "an unclaimed task must be claimed by the user");
  assert(t1.projectId === project.id, "the chat must bind to the task project");
  assert(t1.title.includes(task.identifier), "the chat title must name the task");
  const turn = (await threads.loadThreadForTurn(ws, me.id, t1.id)) as { focusIssueId: string | null };
  assert(turn.focusIssueId === task.id, "the chat must link to the task");
  const ctx = await agentContext({ workspaceId: ws, userId: me.id, workspaceName: "W", workspaceKey: "W", userName: "U", focusIssueId: task.id } as Parameters<typeof agentContext>[0]);
  assert(ctx.includes("Focus task") && ctx.includes("Steps: open login."), "the agent context must carry the task details");
  const chips = (await threads.listThreadTasks(ws, t1.id, me.id)) as { id: string }[];
  assert(chips.some((c) => c.id === task.id), "the chat header must show the task chip");

  const open2 = (await threads.startTaskChat(ws, task.id, me.id)) as {
    thread: { id: string };
    openingMessage: string | null;
  };
  assert(open2.thread.id === t1.id, "a second click must reopen the same chat");
  // 2.3 item 6: a task chat that never ran a turn still needs its opening message.
  assert(open2.openingMessage, "a task chat with no messages must still offer its opening message");
  await threads.appendAgentMessage({ threadId: t1.id, role: "user", content: "Check the login bug", authorId: me.id } as never);
  const open3 = (await threads.startTaskChat(ws, task.id, me.id)) as {
    thread: { id: string };
    openingMessage: string | null;
  };
  assert(open3.thread.id === t1.id, "a third click must reopen the same chat");
  assert(open3.openingMessage === null, "reopening a chat with messages must not offer another opening message");

  let refused = false;
  try {
    await threads.startTaskChat(ws, task.id, other.id);
  } catch {
    refused = true;
  }
  assert(refused, "a task claimed by another member must refuse");
  console.log("check-collab-agent-advance: pass");
}

main().catch((err) => {
  console.error("check-collab-agent-advance: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
