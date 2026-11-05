/**
 * Document versions (docs/plans/team-2.2.md item 3): a stale save is refused, a restore adds a
 * version, and refused text a writer left behind stays in the history without changing the page.
 *   npx tsx scripts/check-doc-versions.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-versions-"));

async function refused(call: () => Promise<unknown>, status: number): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (err) {
    return (err as { status?: number }).status === status;
  }
}

async function main() {
  const lib = await import("../src/lib/pages");
  const { docDiffRows } = await import("../src/lib/doc-diff");
  const ws = "w1";
  const a = "user-a";
  const b = "user-b";

  const page = await lib.createPage(ws, a, { title: "Plan" });
  await lib.setPageShared(ws, page.id, a, true);
  assert(page.revision === 0, "new page starts at revision 0");

  // Same person within the window: one version. An Agent's edit always gets its own.
  let now = await lib.updatePage(ws, page.id, a, { doc: "one", baseRevision: 0 });
  now = await lib.updatePage(ws, page.id, a, { doc: "one two", baseRevision: now.revision });
  assert(now.revision === 2, "each body change raises the revision");
  let versions = await lib.listPageVersions(ws, page.id, a);
  assert(versions.length === 1 && versions[0].seq === 1, "typing merges into one version");
  now = await lib.updatePage(ws, page.id, b, { doc: "one two\nthree" }, { via: "mcp" });
  now = await lib.updatePage(ws, page.id, b, { doc: "one two\nthree\nfour" }, { via: "mcp" });
  versions = await lib.listPageVersions(ws, page.id, a);
  assert(versions.length === 3 && versions[0].via === "mcp", "each Agent edit is its own version");

  // Stale save: refused, page untouched, no version added.
  assert(
    await refused(() => lib.updatePage(ws, page.id, a, { doc: "stale", baseRevision: 1 }), 409),
    "stale save must be refused with 409"
  );
  const afterStale = await lib.getPage(ws, page.id, a);
  assert(afterStale?.doc === "one two\nthree\nfour", "stale save must not change the body");
  assert((await lib.listPageVersions(ws, page.id, a)).length === 3, "stale save adds no version");
  // The same text, or a title, is not a conflict.
  await lib.updatePage(ws, page.id, a, { doc: "one two\nthree\nfour", baseRevision: 1 });
  now = await lib.updatePage(ws, page.id, a, { title: "Plan 2", baseRevision: 1 });
  assert(now.title === "Plan 2" && now.revision === 4, "title change neither conflicts nor raises the revision");

  // Refused text kept on leaving: in history, not on the page, not in the next diff's "before".
  await lib.keepUnsavedText(ws, page.id, a, "left behind");
  assert((await lib.getPage(ws, page.id, a))?.doc === "one two\nthree\nfour", "kept text leaves the page alone");
  versions = await lib.listPageVersions(ws, page.id, a);
  assert(versions[0].reason === "unsaved", "kept text is in the history");

  // Restore adds a version on top and removes nothing.
  const oldest = versions[versions.length - 1];
  const count = versions.length;
  const restored = await lib.restorePageVersion(ws, page.id, b, oldest.id);
  assert(restored.doc === "one two" && restored.revision === 5, "restore brings the body back");
  versions = await lib.listPageVersions(ws, page.id, a);
  assert(versions.length === count + 1, "restore creates a new version");
  assert(versions[0].reason === "restore" && versions[0].restoredFrom === oldest.seq, "restore names its source");
  const change = await lib.getPageVersionChange(ws, page.id, a, versions[0].id);
  assert(change.beforeDoc === "one two\nthree\nfour" && change.doc === "one two", "diff skips kept text");

  // A body from before versions existed is kept when the first edit replaces it.
  const imported = await lib.createPage(ws, a, { title: "Imported", doc: "old body" });
  await lib.updatePage(ws, imported.id, a, { doc: "new body" });
  const history = await lib.listPageVersions(ws, imported.id, a);
  assert(history.length === 2 && history[1].reason === "earlier", "existing text becomes the first version");

  // Permissions: a private page's history is as private as the page.
  assert(await refused(() => lib.listPageVersions(ws, imported.id, b), 404), "others cannot list a private page's history");
  assert(
    await refused(() => lib.restorePageVersion(ws, imported.id, b, history[1].id), 404),
    "others cannot restore a private page"
  );
  const other = await lib.createPage(ws, a, { title: "Other" });
  assert(
    await refused(() => lib.restorePageVersion(ws, other.id, a, history[1].id), 404),
    "a version of another page cannot be restored"
  );

  // Deleting a page takes its history with it.
  await lib.deletePage(ws, imported.id, a);
  await lib.updatePage(ws, other.id, a, { doc: "x" });
  assert(await refused(() => lib.listPageVersions(ws, imported.id, a), 404), "deleted page has no history");

  const rows = docDiffRows("a\nb\nc\nd\ne\nf\ng\nh\ni\nj", "a\nb\nc\nd\nX\nf\ng\nh\ni\nj");
  assert(rows.some((row) => row.kind === "gap"), "long unchanged runs collapse");
  assert(rows.some((row) => row.kind === "add" && row.text === "X"), "added line shown");
  assert(rows.some((row) => row.kind === "del" && row.text === "e"), "removed line shown");

  console.log("check-doc-versions: ok");
}

void main();
