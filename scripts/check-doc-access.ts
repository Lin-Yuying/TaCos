/**
 * Document permissions (docs/plans/team-2.2.md item 6): each level allows and refuses the right
 * actions, one person's level overrides the page's, and it covers the subtree.
 *   npx tsx scripts/check-doc-access.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-access-"));

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
  const comments = await import("../src/lib/page-comments");
  const ws = "w1";
  const owner = "owner";
  const member = "member";

  const page = await lib.createPage(ws, owner, { title: "Doc", doc: "text" });
  await lib.updatePage(ws, page.id, owner, { doc: "text two" });
  const version = (await lib.listPageVersions(ws, page.id, owner)).at(-1)!;

  // Private: nothing at all.
  assert(!(await lib.getPage(ws, page.id, member)), "private page is unreadable");
  await lib.setPageShared(ws, page.id, owner, true);

  async function can() {
    const current = (await lib.getPage(ws, page.id, member))!;
    const edit = await status(() => lib.updatePage(ws, page.id, member, { doc: `${current.doc}.` }));
    const title = await status(() => lib.updatePage(ws, page.id, member, { title: "Renamed" }));
    const sub = await status(() => lib.createPage(ws, member, { parentId: page.id }));
    const restore = await status(() => lib.restorePageVersion(ws, page.id, member, version.id));
    const comment = await status(() => comments.addPageComment(ws, page.id, member, { body: "hi" }));
    const list = await status(() => comments.listPageComments(ws, page.id, member));
    const history = await status(() => lib.listPageVersions(ws, page.id, member));
    return { edit, title, sub, restore, comment, list, history };
  }

  // Default for a shared page stays edit, as before.
  let result = await can();
  assert(Object.values(result).every((code) => code === 200), `edit level allows all: ${JSON.stringify(result)}`);

  await lib.setPageShareLevel(ws, page.id, owner, "comment");
  result = await can();
  assert(result.comment === 200 && result.list === 200 && result.history === 200, "comment level can comment and read");
  assert(result.edit === 403 && result.title === 403 && result.sub === 403 && result.restore === 403, "comment level cannot edit");
  assert((await lib.pageLevel((await lib.getPage(ws, page.id, member))!, member)) === "comment", "level is reported");

  await lib.setPageShareLevel(ws, page.id, owner, "view");
  result = await can();
  assert(result.list === 200 && result.history === 200, "view level can read");
  assert(result.comment === 403 && result.edit === 403, "view level cannot comment or edit");
  const thread = (await comments.listPageComments(ws, page.id, member))[0];
  assert(await status(() => comments.setPageCommentResolved(ws, page.id, member, thread.id, true)) === 403, "view level cannot resolve");

  // One person's level wins, either way, and clearing it goes back.
  await lib.setPageMemberLevel(ws, page.id, owner, member, "edit");
  assert((await can()).edit === 200, "person's level raises");
  await lib.setPageShareLevel(ws, page.id, owner, "edit");
  await lib.setPageMemberLevel(ws, page.id, owner, member, "view");
  assert((await can()).edit === 403, "person's level lowers");
  assert((await lib.getPage(ws, page.id, "other")) !== null, "other members still see it");
  assert((await status(() => lib.updatePage(ws, page.id, "other", { doc: "by other" }))) === 200, "others keep the page level");
  await lib.setPageMemberLevel(ws, page.id, owner, member, null);
  assert((await can()).comment === 200, "clearing returns to the page level");

  // Only the owner changes sharing; the owner keeps edit at any level.
  assert(await status(() => lib.setPageShareLevel(ws, page.id, member, "edit")) === 403, "member cannot change the level");
  assert(await status(() => lib.setPageMemberLevel(ws, page.id, member, member, "edit")) === 403, "member cannot raise themselves");
  assert(await status(() => lib.listPageAccess(ws, page.id, member)) === 403, "member cannot read the list");
  await lib.setPageShareLevel(ws, page.id, owner, "view");
  assert(await status(() => lib.updatePage(ws, page.id, owner, { title: "Mine" })) === 200, "owner keeps edit");

  // Subtree: existing and new subpages follow; a new subpage is shared with its parent.
  const child = await lib.createPage(ws, owner, { title: "Child", parentId: page.id });
  assert(child.shared && child.shareLevel === "view", "new subpage inherits sharing");
  await lib.setPageMemberLevel(ws, page.id, owner, member, "edit");
  assert((await lib.pageLevel(child, member)) === "edit", "person's level covers the subtree");
  const grandchild = await lib.createPage(ws, owner, { title: "Grandchild", parentId: child.id });
  assert((await lib.pageLevel(grandchild, member)) === "edit", "a new subpage copies people's levels");
  await lib.setPageShareLevel(ws, page.id, owner, "comment");
  assert((await lib.getPage(ws, grandchild.id, owner))?.shareLevel === "comment", "level covers the subtree");

  console.log("check-doc-access: ok");
}

void main();
