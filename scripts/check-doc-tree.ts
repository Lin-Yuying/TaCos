/**
 * Document tree (docs/plans/team-2.2.md item 8): moving a page, its sharing following the parent,
 * breadcrumbs that stop at what the reader can see, and per-person favorites.
 *   npx tsx scripts/check-doc-tree.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-tree-"));

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
  const ws = "w1";
  const owner = "owner";
  const member = "member";
  const titles = async (viewer: string) => (await lib.listPageTree(ws, viewer)).map((p) => `${p.depth}:${p.title}`).join(" ");
  const shape = async (viewer = owner) => titles(viewer);

  const a = await lib.createPage(ws, owner, { title: "A" });
  const b = await lib.createPage(ws, owner, { title: "B" });
  const c = await lib.createPage(ws, owner, { title: "C" });
  assert((await shape()) === "0:A 0:B 0:C", "new pages go last");

  // Reorder among siblings.
  await lib.movePage(ws, c.id, owner, { parentId: null, beforeId: a.id });
  assert((await shape()) === "0:C 0:A 0:B", `move before: ${await shape()}`);
  await lib.movePage(ws, c.id, owner, { parentId: null });
  assert((await shape()) === "0:A 0:B 0:C", "move to the end");

  // Reparent; children come along; a new page lands last.
  await lib.movePage(ws, c.id, owner, { parentId: b.id });
  const d = await lib.createPage(ws, owner, { title: "D", parentId: b.id });
  assert((await shape()) === "0:A 0:B 1:C 1:D", `reparent: ${await shape()}`);
  await lib.movePage(ws, d.id, owner, { parentId: b.id, beforeId: c.id });
  assert((await shape()) === "0:A 0:B 1:D 1:C", "reorder under a parent");
  await lib.movePage(ws, b.id, owner, { parentId: a.id });
  assert((await shape()) === "0:A 1:B 2:D 2:C", `subtree moves with it: ${await shape()}`);

  // No cycles.
  assert((await status(() => lib.movePage(ws, a.id, owner, { parentId: c.id }))) === 400, "cannot move under a descendant");
  assert((await status(() => lib.movePage(ws, a.id, owner, { parentId: a.id }))) === 400, "cannot move under itself");

  // Breadcrumb.
  const leaf = (await lib.getPage(ws, c.id, owner))!;
  assert((await lib.pageAncestors(ws, leaf, owner)).map((p) => p.title).join("/") === "A/B", "breadcrumb is top first");

  // Sharing follows the parent, down the subtree, with the parent's levels.
  const team = await lib.createPage(ws, owner, { title: "Team" });
  await lib.setPageShared(ws, team.id, owner, true);
  await lib.setPageShareLevel(ws, team.id, owner, "comment");
  await lib.setPageMemberLevel(ws, team.id, owner, member, "edit");
  await lib.movePage(ws, b.id, owner, { parentId: team.id });
  const moved = (await lib.getPage(ws, c.id, member))!;
  assert(moved?.shared && moved.shareLevel === "comment", "moved subtree takes the parent's sharing");
  assert((await lib.pageLevel(moved, member)) === "edit", "moved subtree takes people's levels");
  assert((await lib.pageAncestors(ws, moved, member)).map((p) => p.title).join("/") === "Team/B", "reader's breadcrumb");

  // Only the owner changes who can see a page by moving it.
  const mine = await lib.createPage(ws, member, { title: "Mine" });
  assert((await status(() => lib.movePage(ws, c.id, member, { parentId: mine.id }))) === 403, "an editor cannot hide someone's page");
  assert((await status(() => lib.movePage(ws, c.id, member, { parentId: null, shared: false }))) === 403, "an editor cannot unshare by moving");
  assert((await status(() => lib.movePage(ws, c.id, member, { parentId: b.id, beforeId: d.id }))) === 200, "an editor can reorder inside the shared tree");

  // Parent and page both need edit.
  await lib.setPageMemberLevel(ws, team.id, owner, member, "view");
  assert((await status(() => lib.movePage(ws, team.id, member, { parentId: null }))) === 403, "view cannot move");
  assert((await status(() => lib.movePage(ws, mine.id, member, { parentId: team.id }))) === 403, "view on the parent refuses a move in");

  // A section drop: top level plus the section's sharing.
  await lib.movePage(ws, b.id, owner, { parentId: null, shared: false });
  assert(!(await lib.getPage(ws, c.id, owner))?.shared, "dropping on Private unshares the subtree");
  assert(!(await lib.getPage(ws, c.id, member)), "and hides it");
  await lib.movePage(ws, b.id, owner, { parentId: null, shared: true });
  assert((await lib.getPage(ws, c.id, member))?.shared, "dropping on Shared shares the subtree");
  const hidden = await lib.createPage(ws, owner, { title: "Hidden root" });
  const under = await lib.createPage(ws, owner, { title: "Under", parentId: hidden.id });
  await lib.setPageShared(ws, under.id, owner, true);
  assert((await lib.pageAncestors(ws, (await lib.getPage(ws, under.id, member))!, member)).length === 0, "breadcrumb stops at a hidden parent");

  // Favorites are per person, follow visibility and go with a purge.
  assert((await lib.togglePageFavorite(ws, c.id, member)) === true, "star");
  assert((await lib.listFavoritePages(ws, member)).map((p) => p.id).includes(c.id), "listed");
  assert((await lib.listFavoritePages(ws, owner)).length === 0, "per person");
  assert(await lib.isPageFavorite(c.id, member), "isPageFavorite");
  await lib.setPageShared(ws, b.id, owner, false);
  assert((await lib.listFavoritePages(ws, member)).length === 0, "unshared drops out");
  await lib.setPageShared(ws, b.id, owner, true);
  assert((await lib.togglePageFavorite(ws, c.id, member)) === false, "unstar");
  assert((await status(() => lib.togglePageFavorite(ws, hidden.id, member))) === 404, "cannot star what you cannot see");

  console.log("check-doc-tree: ok");
}

void main();
