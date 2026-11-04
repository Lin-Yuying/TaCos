/**
 * Document trash (docs/plans/team-2.2.md item 4): delete, restore and purge a page with its subtree.
 *   npx tsx scripts/check-doc-trash.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-trash-"));

async function status(call: () => Promise<unknown>): Promise<number> {
  try {
    await call();
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

async function main() {
  const lib = await import("../src/lib/pages");
  const { getDb } = await import("../src/db/client");
  const { pageVersions, pages } = await import("../src/db/schema");
  const ws = "w1";
  const a = "user-a";
  const b = "user-b";

  const root = await lib.createPage(ws, a, { title: "Root" });
  const child = await lib.createPage(ws, a, { title: "Child", parentId: root.id });
  const grandchild = await lib.createPage(ws, a, { title: "Grandchild", parentId: child.id });
  await lib.updatePage(ws, child.id, a, { doc: "child text" });

  // Deleted: gone from every reader, but listed once in the Trash with its subtree count.
  assert(await status(() => lib.deletePage(ws, root.id, b)) === 404, "others cannot delete a private page");
  const deleted = await lib.deletePage(ws, root.id, a);
  assert(deleted.length === 3, "delete takes the subtree");
  assert(!(await lib.getPage(ws, child.id, a)), "deleted page is unreadable");
  assert((await lib.listPages(ws, a)).length === 0, "deleted pages leave the list");
  assert((await lib.listPageRefs(ws, a)).length === 0, "deleted pages leave the references");
  assert(await status(() => lib.updatePage(ws, child.id, a, { doc: "x" })) === 404, "deleted page cannot be edited");
  let trash = await lib.listTrashedPages(ws, a);
  assert(trash.length === 1 && trash[0].id === root.id && trash[0].subpageCount === 2, "one Trash row per deletion");
  assert((await lib.listTrashedPages(ws, b)).length === 0, "a private page stays hidden in the Trash");
  assert(await status(() => lib.restorePage(ws, root.id, b)) === 404, "others cannot restore a private page");

  // Restored: the same tree, text and history.
  await lib.restorePage(ws, root.id, a);
  assert((await lib.listPages(ws, a)).length === 3, "restore brings the subtree back");
  assert((await lib.getPage(ws, child.id, a))?.doc === "child text", "restore keeps the text");
  assert((await lib.getPage(ws, grandchild.id, a))?.parentId === child.id, "restore keeps the tree");
  assert((await lib.listPageVersions(ws, child.id, a)).length === 1, "restore keeps the versions");
  assert((await lib.listTrashedPages(ws, a)).length === 0, "restore empties the Trash");
  assert(await status(() => lib.restorePage(ws, root.id, a)) === 404, "only a page in the Trash can be restored");

  // A child deleted by itself, then its parent purged: the child comes back at the top.
  await lib.deletePage(ws, grandchild.id, a);
  await lib.deletePage(ws, root.id, a);
  trash = await lib.listTrashedPages(ws, a);
  assert(trash.length === 2, "separate deletions are separate rows");
  assert(await status(() => lib.restorePage(ws, "nope", a)) === 404, "unknown page");
  assert(await status(() => lib.purgePage(ws, grandchild.id, b, false)) === 404, "others cannot purge a private page");
  await lib.purgePage(ws, root.id, a, false);
  await lib.restorePage(ws, grandchild.id, a);
  const back = await lib.getPage(ws, grandchild.id, a);
  assert(back && back.parentId === null, "orphan comes back at the top");
  assert(!(await lib.getPage(ws, child.id, a)), "purged page is gone");
  const left = await getDb().select().from(pages);
  assert(left.length === 1 && left[0].id === grandchild.id, "purge removes the rows");
  assert((await getDb().select().from(pageVersions)).length === 0, "purge removes the versions");

  // A shared page: a member can restore, only the author or workspace owner can purge.
  const shared = await lib.createPage(ws, a, { title: "Shared" });
  await lib.setPageShared(ws, shared.id, a, true);
  await lib.deletePage(ws, shared.id, a);
  assert((await lib.listTrashedPages(ws, b)).length === 1, "a shared page is in everyone's Trash");
  await lib.restorePage(ws, shared.id, b);
  await lib.deletePage(ws, shared.id, a);
  assert(await status(() => lib.purgePage(ws, shared.id, b, false)) === 403, "a member cannot purge");
  await lib.purgePage(ws, shared.id, b, true);

  console.log("check-doc-trash: ok");
}

void main();
