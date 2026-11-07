/**
 * U-11: @ on a private page warns for members who cannot read it, and a self @ in the
 * document or a comment does not notify the author.
 *   node --import tsx scripts/check-doc-mentions.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-mentions-"));

async function main() {
  const { mentionedMembersWithoutAccess } = await import("../src/lib/mentions");
  const lib = await import("../src/lib/pages");
  const comments = await import("../src/lib/page-comments");
  const { listNotifications } = await import("../src/lib/issues");
  const { getDb } = await import("../src/db/client");
  const { users, workspaceMembers } = await import("../src/db/schema");

  const members = [
    { id: "a", username: "ann", displayName: "Ann" },
    { id: "b", username: "bob", displayName: "Bob" },
  ];
  const privatePage = { shared: false, createdBy: "a" };
  assert(
    mentionedMembersWithoutAccess(privatePage, members, "hi @bob").map((m) => m.id).join() === "b",
    "a private page warns for a mentioned member who cannot read it"
  );
  assert(
    mentionedMembersWithoutAccess(privatePage, members, "@[Bob] and @ann").length === 1,
    "the page author is not warned when they mention themselves"
  );
  assert(
    mentionedMembersWithoutAccess({ shared: true, createdBy: "a" }, members, "@bob").length === 0,
    "a shared page names no one who cannot read it"
  );
  assert(
    mentionedMembersWithoutAccess(privatePage, members, "```\n@bob\n```", { doc: true }).length === 0,
    "mentions inside code blocks are ignored in the document"
  );

  const ws = "w1";
  const at = new Date().toISOString();
  const db = getDb();
  for (const member of members) {
    await db
      .insert(users)
      .values({ id: member.id, username: member.username, displayName: member.displayName, passwordHash: "x", createdAt: at } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: member.id, role: "member", createdAt: at } as never);
  }

  const page = await lib.createPage(ws, "a", { title: "Private", doc: "draft" });
  await lib.updatePage(ws, page.id, "a", { doc: "please @ann read this" });
  let ann = await listNotifications(ws, "a");
  assert(
    ann.every((n) => !(n.type === "doc_mentioned" && n.pageId === page.id)),
    "a self @ in the document does not notify the author"
  );

  await comments.addPageComment(ws, page.id, "a", { body: "@ann in a comment" });
  ann = await listNotifications(ws, "a");
  assert(
    ann.every((n) => !(n.type === "doc_mentioned" && n.pageId === page.id)),
    "a self @ in a comment does not notify the author"
  );

  assert(
    (await listNotifications(ws, "b")).every((n) => n.pageId !== page.id),
    "someone who cannot read the page gets no mention notice"
  );

  console.log("check-doc-mentions: ok");
}

void main();
