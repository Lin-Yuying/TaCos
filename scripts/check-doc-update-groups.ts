/**
 * Updates by several editors collapse into one entry (docs/plans/team-2.3.md item 12).
 *   node --import tsx scripts/check-doc-update-groups.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DOC_UPDATE_MERGE_MS, groupDocUpdates, type DocUpdateRef } from "../src/lib/doc-update-groups";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const MIN = 60 * 1000;

function at(ms: number, seq: number, extra: Partial<DocUpdateRef> = {}): DocUpdateRef {
  const createdAt = new Date(ms).toISOString();
  return {
    id: `v${seq}`,
    seq,
    via: "you",
    reason: "edit",
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

function ids(group: { versions: { id: string }[] }): string {
  return group.versions.map((version) => version.id).join(",");
}

function groupingRule() {
  const burst = groupDocUpdates([at(DOC_UPDATE_MERGE_MS - 1, 2), at(0, 1)]);
  assert(burst.length === 1 && ids(burst[0]) === "v2,v1", "edits inside the window are one entry, newest first");
  assert(burst[0].id === "v2", "the entry is addressed by its newest version");

  const edge = groupDocUpdates([at(0, 1), at(DOC_UPDATE_MERGE_MS, 2)]);
  assert(edge.length === 2 && ids(edge[0]) === "v2" && ids(edge[1]) === "v1", "an edit at the window boundary starts a new entry");

  // 12 minutes after the first edit is a new entry, even though it is 6 minutes after the middle one.
  const anchored = groupDocUpdates([at(0, 1), at(6 * MIN, 2), at(12 * MIN, 3)]);
  assert(anchored.length === 2 && ids(anchored[0]) === "v3" && ids(anchored[1]) === "v2,v1", "the window stays anchored on the first edit");

  const split = groupDocUpdates([
    at(0, 1),
    at(MIN, 2, { via: "mcp" }),
    at(2 * MIN, 3),
    at(3 * MIN, 4, { reason: "restore" }),
    at(4 * MIN, 5, { reason: "undo" }),
    at(5 * MIN, 6, { reason: "unsaved" }),
    at(6 * MIN, 7, { reason: "earlier" }),
    at(7 * MIN, 8, { via: "api:key" }),
    at(8 * MIN, 9),
  ]);
  assert(split.length === 9, "agent, restore, undo, unsaved, earlier, and api edits each stay their own entry");
  assert(
    split.every((group) => group.versions.length === 1),
    "those rows do not absorb the human edits beside them"
  );

  const agents = groupDocUpdates([at(0, 1, { via: "mcp" }), at(MIN, 2, { via: "mcp" })]);
  assert(agents.length === 2, "agent edits stay separate from each other");

  const stamped = { ...at(MIN, 2), updatedAt: new Date(2 * MIN).toISOString() };
  const [stampedGroup] = groupDocUpdates([stamped, at(0, 1)]);
  assert(stampedGroup.updatedAt === stamped.updatedAt, "the entry time is the newest edit");

  const blank = groupDocUpdates([
    at(0, 1, { createdAt: "not-a-date" }),
    at(MIN, 2, { createdAt: "also-not" }),
  ]);
  assert(blank.length === 2, "unreadable times stay separate");

  assert(groupDocUpdates([]).length === 0, "no versions is no entries");
}

async function refused(call: () => Promise<unknown>, status: number): Promise<boolean> {
  try {
    await call();
    return false;
  } catch (err) {
    return (err as { status?: number }).status === status;
  }
}

async function storedRuns() {
  process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-update-groups-"));
  const lib = await import("../src/lib/pages");
  const ws = "w1";
  const a = "user-a";
  const b = "user-b";

  const page = await lib.createPage(ws, a, { title: "Plan" });
  await lib.setPageShared(ws, page.id, a, true);
  let now = await lib.updatePage(ws, page.id, a, { doc: "alpha", baseRevision: 0 });
  now = await lib.updatePage(ws, page.id, b, { doc: "alpha\nbeta", baseRevision: now.revision });
  let versions = await lib.listPageVersions(ws, page.id, a);
  assert(versions.length === 2, "two editors leave two versions");
  assert(versions.every((version) => !Number.isNaN(Date.parse(version.createdAt))), "each version has a created time");
  let groups = groupDocUpdates(versions);
  assert(groups.length === 1 && groups[0].versions.length === 2, "those versions collapse into one entry");

  const newest = groups[0].versions[0];
  const oldest = groups[0].versions[groups[0].versions.length - 1];
  const span = await lib.getPageVersionChange(ws, page.id, a, newest.id, oldest.id);
  assert(span.beforeDoc === "" && span.doc === "alpha\nbeta", "the collapsed entry diffs the whole run");
  const lastOnly = await lib.getPageVersionChange(ws, page.id, a, newest.id);
  assert(lastOnly.beforeDoc === "alpha" && lastOnly.doc === "alpha\nbeta", "one version still diffs only itself");
  assert(
    await refused(() => lib.getPageVersionChange(ws, page.id, a, oldest.id, newest.id), 404),
    "a span cannot run backwards"
  );

  now = await lib.updatePage(ws, page.id, b, { doc: "alpha\nbeta\ngamma" }, { via: "mcp" });
  await lib.updatePage(ws, page.id, a, { doc: "alpha\nbeta\ngamma\ndelta", baseRevision: now.revision });
  versions = await lib.listPageVersions(ws, page.id, a);
  groups = groupDocUpdates(versions);
  assert(groups.length === 3, "an agent edit splits the surrounding human edits");
  assert(groups[1].versions.length === 1 && groups[1].versions[0].via === "mcp", "the agent edit is its own entry");
  assert(groups[0].versions.length === 1 && groups[2].versions.length === 2, "human edits on each side keep their own runs");
}

function panelUsesRule() {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const panel = fs.readFileSync(path.join(root, "src/components/doc-updates.tsx"), "utf8");
  const pages = fs.readFileSync(path.join(root, "src/lib/pages.ts"), "utf8");
  assert(panel.includes("groupDocUpdates"), "Updates panel uses the grouping rule");
  assert(panel.includes("oldest.id"), "collapsed entry asks for the whole run");
  assert(pages.includes("DOC_UPDATE_MERGE_MS"), "stored versions use the same window");
}

async function main() {
  groupingRule();
  panelUsesRule();
  await storedRuns();
  console.log("check-doc-update-groups: ok");
}

void main();
