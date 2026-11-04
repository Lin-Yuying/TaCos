/**
 * Agent partial edit and undo (docs/plans/team-2.2.md item 11).
 *   npx tsx scripts/check-doc-agent-edit.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-agent-edit-"));

async function error(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { users, workspaces, workspaceMembers, projects } = await import("../src/db/schema");
  const pagesLib = await import("../src/lib/pages");
  const { executeAgentTool, AGENT_TOOLS } = await import("../src/lib/agent-tools");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w1";
  await db.insert(workspaces).values({ id: ws, name: "W", key: "TW", createdBy: "ann", createdAt: at } as never);
  for (const id of ["ann", "bob"]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: at } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: id, role: "member", createdAt: at } as never);
  }
  await db.insert(projects).values({ id: "p1", workspaceId: ws, key: "P1", name: "p1", createdBy: "ann", createdAt: at, updatedAt: at } as never);
  const ctx = (userId: string) => ({ workspaceId: ws, projectId: "p1", projectKey: "P1", userId });
  const run = (userId: string, name: string, args: unknown) => executeAgentTool(ctx(userId), name, args);

  for (const name of ["edit_doc", "undo_doc_edit"]) {
    assert(AGENT_TOOLS.find((tool) => tool.name === name)?.write, `${name} is a write, so it asks for approval`);
  }

  const original = "# 周报\n\n第一段 unchanged\n\n第二段 target\n\nrepeat\n\nrepeat\n\n末尾 **保留** `code`\n";
  const page = await pagesLib.createPage(ws, "ann", { projectId: "p1", title: "Doc" });
  await pagesLib.setPageShared(ws, page.id, "ann", true);
  await pagesLib.updatePage(ws, page.id, "ann", { doc: original });
  const textOf = async () => (await pagesLib.getPage(ws, page.id, "ann"))!.doc;
  const versions = () => pagesLib.listPageVersions(ws, page.id, "ann");
  const count = (await versions()).length;

  // A partial edit changes the named passage, and every other byte stays.
  await run("ann", "edit_doc", { id: page.id, edits: [{ find: "第二段 target", replace: "第二段 changed" }] });
  assert((await textOf()) === original.replace("第二段 target", "第二段 changed"), "only the named passage changes");
  const [newest] = await versions();
  assert(newest.via === "mcp" && newest.reason === "edit", "the edit shows as an Agent version");
  assert((await versions()).length === count + 1, "the edit is one version");

  // Undo restores the exact text, and adds to the history instead of erasing it.
  await run("ann", "undo_doc_edit", { id: page.id });
  assert((await textOf()) === original, "undo restores the text");
  const [undone] = await versions();
  assert(undone.reason === "undo" && undone.restoredFrom === newest.seq, "undo says which version it took back");
  assert((await versions()).length === count + 2, "undo keeps the history");
  assert((await error(() => run("ann", "undo_doc_edit", { id: page.id }))).includes("not an Agent edit"), "nothing left to undo");

  // Several edits apply in order. One bad edit leaves the document alone.
  await run("ann", "edit_doc", {
    id: page.id,
    edits: [
      { find: "第一段", replace: "One" },
      { find: "One unchanged", replace: "One done" },
    ],
  });
  assert((await textOf()).includes("One done\n"), "edits apply in order");
  const before = await textOf();
  const failed = await error(() =>
    run("ann", "edit_doc", {
      id: page.id,
      edits: [
        { find: "One done", replace: "lost" },
        { find: "no such text", replace: "x" },
      ],
    })
  );
  assert(failed.includes("not in the document"), `missing text refused: ${failed}`);
  assert((await textOf()) === before, "a failed batch changes nothing");
  assert(
    (await error(() => run("ann", "edit_doc", { id: page.id, edits: [{ find: "repeat", replace: "x" }] }))).includes("more than once"),
    "ambiguous text refused"
  );
  assert((await error(() => run("ann", "edit_doc", { id: page.id, edits: [] }))).includes("at least one"), "no edits refused");
  await run("ann", "edit_doc", { id: page.id, edits: [{ find: "One done\n\n", replace: "" }] });
  assert(!(await textOf()).includes("One done"), "empty replace deletes");

  // Undo must not lose what a person wrote after the Agent.
  await run("ann", "edit_doc", { id: page.id, edits: [{ find: "第二段 target", replace: "agent text" }] });
  const agentVersion = (await versions())[0];
  await pagesLib.updatePage(ws, page.id, "bob", { doc: `${await textOf()}\nbob wrote this\n` });
  assert((await error(() => run("ann", "undo_doc_edit", { id: page.id }))).includes("not an Agent edit"), "a person's later edit blocks undo");
  assert(
    (await error(() => pagesLib.undoAgentEdit(ws, page.id, "ann", { versionId: agentVersion.id }))).includes("changed after"),
    "the panel's undo of an older edit is refused"
  );
  assert((await textOf()).includes("bob wrote this"), "the person's text survives");

  // One person's Agent cannot undo another's by accident; the panel can, once they have looked.
  await run("ann", "edit_doc", { id: page.id, edits: [{ find: "bob wrote this", replace: "ann agent" }] });
  assert((await error(() => run("bob", "undo_doc_edit", { id: page.id }))).includes("someone else"), "another's Agent edit");
  await pagesLib.undoAgentEdit(ws, page.id, "bob", { versionId: (await versions())[0].id });
  assert((await textOf()).includes("bob wrote this"), "the panel undoes the newest Agent edit");

  // A document that started empty goes back to empty.
  const blank = await pagesLib.createPage(ws, "ann", { projectId: "p1", title: "Blank" });
  await run("ann", "update_doc", { id: blank.id, markdown: "written by the Agent" });
  await run("ann", "undo_doc_edit", { id: blank.id });
  assert((await pagesLib.getPage(ws, blank.id, "ann"))!.doc === "", "undo of the first text empties the page");

  // Permissions still apply through the tools.
  await pagesLib.setPageShareLevel(ws, page.id, "ann", "view");
  assert((await error(() => run("bob", "edit_doc", { id: page.id, edits: [{ find: "ann", replace: "x" }] }))) !== "", "a viewer's Agent cannot edit");

  console.log("check-doc-agent-edit: ok");
}

void main();
