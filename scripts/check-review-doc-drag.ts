/**
 * Finding 5 (release blocker): the 2.3 merge of origin/main brought back the
 * side effect v2.2.3 (233cfa3) removed — dropping a page on a sidebar section
 * flipped its `shared` flag, silently publishing a private page workspace-wide.
 *
 * Static: the section-drop branch passes only ordering fields, never `shared`.
 * Behavior: movePage() itself still honours an explicit `shared` target; it is
 * the UI that must no longer send it.
 *
 *   node --import tsx scripts/check-review-doc-drag.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-review-doc-drag-"));

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function staticChecks() {
  const tree = read("src/components/doc-tree.tsx");

  // Pinpoint the section-drop branch, not a loose string anywhere in the file.
  const branchAt = tree.indexOf('typeof target.data.sectionShared === "boolean"');
  assert(branchAt >= 0, "the section-drop branch exists");
  const branchEnd = tree.indexOf("const rowId", branchAt);
  assert(branchEnd > branchAt, "the section branch is followed by the row-drop path");
  const branch = tree.slice(branchAt, branchEnd);

  // Exactly the object literal handed to moveRef.current inside this branch.
  const call = /moveRef\.current\(pageId,\s*\{([^}]*)\}\)/.exec(branch);
  assert(call, "section drop calls moveRef.current with an object literal");
  const args = call[1];
  assert(/parentId/.test(args) && /beforeId/.test(args), "section drop still reorders / un-nests (parentId, beforeId)");
  assert(!/\bshared\b/.test(args), "section drop does not pass `shared`");
  assert(!/\bsectionShared\b/.test(args), "section drop does not pass `sectionShared`");
  assert(!/\bshared\s*:/.test(args), "section drop has no `shared:` key");

  // No other drag path in the file may construct a `shared` target either.
  for (const line of tree.split("\n")) {
    if (line.includes("moveRef.current")) {
      assert(!/\bshared\s*:/.test(line), `a drag path must not pass shared: -> ${line.trim()}`);
      assert(!line.includes("sectionShared"), `a drag path must not pass sectionShared: -> ${line.trim()}`);
    }
  }

  // The two partitions and their explicit create-time sharing must remain. Creating a
  // page moved into NewPageMenu (it can also start from a template), so the shared
  // section's flag is checked where it is passed and where it is applied.
  assert(tree.includes("getData: () => ({ sectionShared })"), "sections are still identified via getData");
  assert(tree.includes("sectionShared={false}"), "the Private section still exists");
  assert(tree.split("\n").some((line) => line.trim() === "sectionShared"), "the Shared section still exists (bare sectionShared prop)");
  assert(tree.includes("<NewPageMenu"), "the tree creates documents through the shared NewPageMenu");
  assert(tree.includes("shared={sectionShared}"), "the section's sharing is handed to the create menu");
  const menu = read("src/components/new-page-menu.tsx");
  assert(menu.includes("if (shared) await setPageSharedAction"), "create path still sets sharing via setPageSharedAction");
  assert(menu.includes("createPageFromTemplateAction"), "create path still offers page templates");

  // movePage's library semantics are untouched (we must not "fix" this by deleting them).
  const lib = read("src/lib/pages.ts");
  assert(lib.includes("target.shared ?? page.shared"), "movePage still honours an explicit `shared` target");
}

async function behaviorChecks() {
  const lib = await import("../src/lib/pages");
  const { getDb } = await import("../src/db/client");
  const { pages } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const db = getDb();

  const ws = "w1";
  const viewerId = "owner";

  // Read the raw column (0/1), not toPage()'s boolean, so the assertions are literal.
  const rawShared = async (id: string): Promise<number> => {
    const [row] = await db.select({ shared: pages.shared }).from(pages).where(eq(pages.id, id));
    assert(row, `page ${id} exists`);
    return row.shared;
  };

  // Minimal fixture: one private page, one shared page.
  const privatePage = await lib.createPage(ws, viewerId, { title: "Private" });
  const sharedPage = await lib.createPage(ws, viewerId, { title: "Shared" });
  await lib.setPageShared(ws, sharedPage.id, viewerId, true);
  assert((await rawShared(privatePage.id)) === 0, "fixture: private page starts shared=0");
  assert((await rawShared(sharedPage.id)) === 1, "fixture: shared page is shared=1");

  // A section drop carries no `shared`: reorder / un-nest must NOT flip sharing.
  await lib.movePage(ws, privatePage.id, viewerId, { parentId: null, beforeId: null });
  assert((await rawShared(privatePage.id)) === 0, "movePage without `shared` keeps a private page private (0)");
  assert((await rawShared(sharedPage.id)) === 1, "movePage without `shared` keeps a shared page shared (1)");

  // Library semantics are intact: an explicit `shared` target still changes it.
  const target = { parentId: null, beforeId: null, shared: true };
  const impact = await lib.previewPageMove(ws, privatePage.id, viewerId, target);
  await lib.movePage(ws, privatePage.id, viewerId, { ...target, confirmedImpact: impact.token });
  assert((await rawShared(privatePage.id)) === 1, "movePage with shared:true still shares the page (1)");
}

async function main() {
  staticChecks();
  await behaviorChecks();
  console.log("check-review-doc-drag: pass");
}

main().catch((err) => {
  console.error("check-review-doc-drag: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
