/**
 * Document comments (docs/plans/team-2.2.md item 5): a passage comment finds its text after an
 * edit before it, a mention notifies a member who can read the page, and no one else.
 *   npx tsx scripts/check-doc-comments.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-comments-"));

async function status(call: () => Promise<unknown>): Promise<number> {
  try {
    await call();
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

async function main() {
  const { anchorFromRange, locateAnchor } = await import("../src/lib/doc-anchor");
  const { anchorFromSelection, anchorRanges } = await import("../src/lib/editor/anchors");
  const { documentMarkdown, markdownToDocument } = await import("../src/lib/editor/document-markdown");
  const { documentExtensions } = await import("../src/lib/editor/extensions");
  const { getSchema } = await import("@tiptap/core");
  const lib = await import("../src/lib/pages");
  const comments = await import("../src/lib/page-comments");
  const { listNotifications, unreadNotificationCount } = await import("../src/lib/issues");
  const { getDb } = await import("../src/db/client");
  const { pageComments, users, workspaceMembers } = await import("../src/db/schema");

  // Plain text: an edit before the quote, a repeated quote, a quote that is gone.
  const text = "第一段。\n重复的话在这里。\n第二段：重复的话在那里。";
  const start = text.indexOf("重复的话", 10);
  const anchor = anchorFromRange(text, start, start + 4);
  const edited = `新加的开头。\n${text}`;
  const found = locateAnchor(edited, anchor);
  assert(found && edited.slice(found.start, found.end) === "重复的话", "anchor found after an edit before it");
  assert(found && edited.slice(found.end, found.end + 3) === "在那里", "the right occurrence wins");
  assert(locateAnchor(text.replaceAll("重复的话", "别的话"), anchor) === null, "a removed quote is not found");

  // Editor document: Markdown formatting and blocks do not break the anchor.
  const schema = getSchema(documentExtensions());
  const markdown = documentMarkdown();
  const toNode = (source: string) => schema.nodeFromJSON(markdownToDocument(markdown, source));
  const before = toNode("# 标题\n\n这段有 **加粗** 的文字，后面还有内容。\n\n- 列表项目");
  let from = -1;
  before.descendants((node, pos) => {
    if (node.isText && node.text?.startsWith("加粗")) from = pos;
  });
  const picked = anchorFromSelection(before, from, from + 2);
  assert(picked?.quote === "加粗", "selection becomes a quote");
  const after = toNode("# 标题\n\n上面新加一段。\n\n这段有 **加粗** 的文字，后面还有内容。\n\n- 列表项目");
  const ranges = anchorRanges(after, [{ id: "c1", ...picked! }]);
  assert(ranges.length === 1, "anchor found in the edited document");
  assert(after.textBetween(ranges[0].from, ranges[0].to) === "加粗", "range covers the same words");

  // Stored comments, notices, permissions.
  const ws = "w1";
  const at = new Date().toISOString();
  const db = getDb();
  for (const [id, username] of [["a", "ann"], ["b", "bob"], ["c", "cat"]]) {
    await db.insert(users).values({ id, username, displayName: username, passwordHash: "x", createdAt: at } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: id, role: "member", createdAt: at } as never);
  }
  const page = await lib.createPage(ws, "a", { title: "Doc", doc: "text" });
  await lib.setPageShared(ws, page.id, "a", true);

  let list = await comments.addPageComment(ws, page.id, "b", {
    body: "看一下 @cat 和 @ann",
    anchor: { quote: "text", prefix: "", suffix: "" },
  });
  assert(list.length === 1 && list[0].quote === "text", "passage comment is stored");
  const cat = await listNotifications(ws, "c");
  assert(cat.length === 1 && cat[0].type === "doc_mentioned" && cat[0].pageId === page.id, "mention creates a notice");
  assert(cat[0].pageTitle === "Doc" && cat[0].body === "bob", "notice names the page and who wrote");
  const ann = await listNotifications(ws, "a");
  assert(ann.length === 1 && ann[0].type === "doc_mentioned", "a mentioned page author gets one notice");
  assert((await unreadNotificationCount(ws, "b")) === 0, "the writer gets no notice");

  await comments.addPageComment(ws, page.id, "b", { body: "second" });
  assert((await listNotifications(ws, "a")).length === 2, "page author is told about a comment");
  await comments.addPageComment(ws, page.id, "a", { body: "@ann self" });
  assert((await listNotifications(ws, "a")).length === 3, "a self @ in a comment notifies the author");

  const secret = await lib.createPage(ws, "a", { title: "Secret" });
  await comments.addPageComment(ws, secret.id, "a", { body: "@bob read this" });
  assert((await listNotifications(ws, "b")).every((n) => n.pageId !== secret.id), "no notice for a page they cannot read");
  assert(await status(() => comments.listPageComments(ws, secret.id, "b")) === 404, "private page's comments are private");
  assert(await status(() => comments.addPageComment(ws, secret.id, "b", { body: "hi" })) === 404, "cannot comment on a private page");
  assert(await status(() => comments.addPageComment(ws, page.id, "b", { body: "  " })) === 400, "empty comment refused");

  list = await comments.listPageComments(ws, page.id, "a");
  const first = list[0];
  list = await comments.setPageCommentResolved(ws, page.id, "c", first.id, true);
  assert(list[0].resolvedAt, "any reader can resolve");
  list = await comments.setPageCommentResolved(ws, page.id, "c", first.id, false);
  assert(!list[0].resolvedAt, "and reopen");
  assert(await status(() => comments.removePageComment(ws, page.id, "c", first.id)) === 403, "others cannot delete");
  const reply = (await comments.addPageComment(ws,page.id,"a",{body:"Threaded answer",parentId:first.id})).find(c=>c.parentId===first.id)!;
  assert(reply?.body==="Threaded answer","reply retains its parent");
  assert(await status(()=>comments.editPageComment(ws,page.id,"c",reply.id,"Changed"))===403,"only author edits a reply");
  const editedComment=(await comments.editPageComment(ws,page.id,"a",reply.id,"Edited answer")).find(c=>c.id===reply.id)!;
  assert(editedComment.body==="Edited answer"&&editedComment.editedAt,"editing preserves identity and records time");
  await comments.removePageComment(ws, page.id, "b", first.id);
  const deleted=(await comments.listPageComments(ws,page.id,"a")).find(c=>c.id===first.id)!;
  assert(deleted.deletedAt&&deleted.body==="","soft delete hides body and retains thread");
  assert(await status(()=>comments.restorePageComment(ws,page.id,"c",first.id))===403,"others cannot restore");
  const restored=(await comments.restorePageComment(ws,page.id,"b",first.id)).find(c=>c.id===first.id)!;
  assert(!restored.deletedAt&&restored.body===first.body,"author can restore original comment");
  await comments.removePageComment(ws, page.id, "a", (await comments.listPageComments(ws, page.id, "a"))[0].id);

  // Purging a page takes its comments and notices with it.
  await lib.deletePage(ws, page.id, "a");
  await lib.purgePage(ws, page.id, "a", false);
  assert((await listNotifications(ws, "c")).length === 0, "purge removes the notices");
  const rows = await db.select().from(pageComments);
  assert(rows.every((row) => row.pageId !== page.id), "purge removes the comments");

  console.log("check-doc-comments: ok");
}

void main();
