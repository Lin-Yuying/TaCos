// H-COLLAB-07: a task links to its source chat and the chat lists its tasks. Private chats stay hidden from others.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-chatlink-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers } = await import("../src/db/schema");
  const threads = (await import("../src/lib/agent-threads")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const { executeAgentTool } = await import("../src/lib/agent-tools");
  for (const fn of ["getSourceThread", "listThreadTasks"]) assert(typeof threads[fn] === "function", `${fn} required`);
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [owner, other] = await db.select().from(users).limit(2);
  for (const u of [owner, other]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const thread = (await threads.startAgentThread({ workspaceId: ws, projectId: project.id, visibility: "private", engine: "codex", userId: owner.id })) as { id: string };
  await threads.renameAgentThread(ws, owner.id, thread.id, "Plan the sprint");
  const ctx = { workspaceId: ws, projectId: project.id, projectKey: project.key, userId: owner.id, threadId: thread.id };
  const out = (await executeAgentTool(ctx, "create_task", { workspace: ctx.workspaceId, title: "From chat" })).text;
  const identifier = /Created (\S+)/.exec(out)?.[1];

  const tasks = (await threads.listThreadTasks(ws, thread.id, owner.id)) as { identifier: string }[];
  assert(tasks.some((t) => t.identifier === identifier), "chat must list the task it made");
  const src = (await threads.getSourceThread(ws, thread.id, owner.id)) as { id: string; title: string } | null;
  assert(src?.id === thread.id && src.title === "Plan the sprint", "task must resolve its source chat for the owner");
  const hidden = await threads.getSourceThread(ws, thread.id, other.id);
  assert(hidden === null, "a private source chat must stay hidden from other members");
  await threads.setAgentThreadVisibility(ws, owner.id, thread.id, "shared");
  const shared = await threads.getSourceThread(ws, thread.id, other.id);
  assert(shared !== null, "a shared source chat must show for other members");
  console.log("check-collab-chat-link: pass");
}

main().catch((err) => {
  console.error("check-collab-chat-link: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
