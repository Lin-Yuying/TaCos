// H-COLLAB-10: @username in a comment or description notifies that member once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-mention-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { projects, users, workspaceMembers, notifications } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const mentions = (await import("../src/lib/mentions").catch(() => null)) as { parseMentions: (s: string) => string[] } | null;
  assert(mentions, "src/lib/mentions.ts required");
  assert(
    JSON.stringify(mentions.parseMentions("hi @Alex and @sam.r, mail a@b.com @alex")) === JSON.stringify(["alex", "sam.r"]),
    "parseMentions must find unique usernames and skip emails"
  );
  assert(
    JSON.stringify(mentions.parseMentions("请@[张三 丰]看，@李四 也看，@[Mary Ann]、a@[x]")) ===
      JSON.stringify(["张三 丰", "李四", "mary ann"]),
    "parseMentions must read any username in brackets and a hand-typed one"
  );
  const { createIssue, addComment, updateIssue } = await import("../src/lib/issues");
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const ws = project.workspaceId;
  const [me, mate, third] = await db.select().from(users).limit(3);
  for (const u of [me, mate, third]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: u.id, createdAt: new Date().toISOString() }).onConflictDoNothing();
  }
  const actor = { kind: "user", userId: me.id, displayName: me.displayName } as const;
  const created = await createIssue(ws, { title: "Mention test", project: project.key }, actor);
  const id = created.issue.id;
  const count = async (userId: string, type: string) =>
    (await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.issueId, id), eq(notifications.type, type)))).length;

  await addComment(ws, id, `@${mate.username} please look. @${me.username} @nobody`, actor);
  assert((await count(mate.id, "mentioned")) === 1, "a comment mention must notify the member");
  assert((await count(me.id, "mentioned")) === 0, "a self mention must not notify");

  await updateIssue(ws, id, { description: `Owner: @${third.username}` }, actor);
  assert((await count(third.id, "mentioned")) === 1, "a description mention must notify the member");
  await updateIssue(ws, id, { description: `Owner: @${third.username} (updated)` }, actor);
  assert((await count(third.id, "mentioned")) === 1, "an unchanged description mention must not notify again");
  console.log("check-collab-mentions: pass");
}

main().catch((err) => {
  console.error("check-collab-mentions: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
