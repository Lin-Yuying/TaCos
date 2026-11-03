// H-COLLAB-09: a workspace member continues a shared chat. Messages keep their author.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-shared-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers } = await import("../src/db/schema");
  const threads = await import("../src/lib/agent-threads");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [owner, mate] = await db.select().from(users).limit(2);
  for (const u of [owner, mate]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const t = await threads.startAgentThread({ workspaceId: ws, projectId: project.id, visibility: "shared", engine: "codex", approval: "full", userId: owner.id });
  await threads.appendAgentMessage({ threadId: t.id, role: "user", content: "Plan the sprint", authorId: owner.id } as never);
  await threads.appendAgentMessage({ threadId: t.id, role: "assistant", content: "Here is a plan." });
  await threads.appendAgentMessage({ threadId: t.id, role: "user", content: "Add a QA step", authorId: mate.id } as never);

  const seen = (await threads.getAgentThread(ws, owner.id, t.id)) as unknown as { messages: { content: string; authorName?: string | null }[] };
  const qa = seen.messages.find((m) => m.content === "Add a QA step");
  assert(qa?.authorName === mate.displayName, "the owner must see who wrote the message");

  const turn = await threads.loadThreadForTurn(ws, mate.id, t.id);
  assert(turn.approval === "ask", "a collaborator turn must ask for every write");
  assert(turn.messages.some((m) => m.content.startsWith(`${mate.displayName}:`)), "the model must know who wrote each message");
  const own = await threads.loadThreadForTurn(ws, owner.id, t.id);
  assert(own.approval === "full", "the owner keeps the chosen approval mode");

  await threads.setAgentThreadVisibility(ws, owner.id, t.id, "private");
  let hidden = false;
  try {
    await threads.loadThreadForTurn(ws, mate.id, t.id);
  } catch {
    hidden = true;
  }
  assert(hidden, "a private chat must refuse other members");
  console.log("check-collab-shared-chat: pass");
}

main().catch((err) => {
  console.error("check-collab-shared-chat: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
