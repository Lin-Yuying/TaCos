/**
 * Agent reads and writes across workspaces (docs/plans/team-2.2.md item 12).
 *   npx tsx scripts/check-agent-workspace-reach.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-agent-reach-"));

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
  const { users, workspaces, workspaceMembers, projects, issues, projectMembers } = await import("../src/db/schema");
  const { executeAgentTool, AGENT_TOOLS, writesElsewhere } = await import("../src/lib/agent-tools");
  const pagesLib = await import("../src/lib/pages");
  const { createTaskField, setTaskFieldValue } = await import("../src/lib/task-fields");
  const db = getDb();
  const at = new Date().toISOString();
  await db.insert(users).values({ id: "ann", username: "ann", displayName: "Ann", passwordHash: "x", createdAt: at } as never);
  await db.insert(users).values({ id: "zed", username: "zed", displayName: "Zed", passwordHash: "x", createdAt: at } as never);
  const space = async (id: string, key: string, members: string[], over: object = {}) => {
    await db.insert(workspaces).values({ id, name: `${key} space`, key, createdBy: members[0], createdAt: at, ...over } as never);
    for (const member of members) {
      await db.insert(workspaceMembers).values({ workspaceId: id, userId: member, role: "member", createdAt: at } as never);
    }
    await db.insert(projects).values({ id: `${id}-p`, workspaceId: id, key: `${key}P`, name: `${key} plan`, createdBy: members[0], createdAt: at, updatedAt: at } as never);
    await db.insert(issues).values({ id: `${id}-i`, workspaceId: id, projectId: `${id}-p`, number: 1, identifier: `${key}P-1`, title: `needle in ${key}`, description: "", createdAt: at, updatedAt: at } as never);
  };
  await space("home", "HOME", ["ann"]);
  await space("away", "AWAY", ["ann", "zed"]);
  await space("shut", "SHUT", ["zed"]); // Ann never joined this one.
  await space("hide", "HIDE", ["zed", "ann"], { membersSeeAllTasks: 0 }); // Joined, but its project is not hers.
  await db.insert(projectMembers).values({ projectId: "hide-p", userId: "zed", createdAt: at } as never);
  await db.insert(projects).values({ id: "home-q", workspaceId: "home", key: "HOMEQ", name: "other", createdBy: "ann", createdAt: at, updatedAt: at } as never);
  await db.insert(issues).values({ id: "home-j", workspaceId: "home", projectId: "home-q", number: 1, identifier: "HOMEQ-1", title: "in the other project", description: "", createdAt: at, updatedAt: at } as never);

  const ctx = { workspaceId: "home", projectId: "home-p", projectKey: "HOMEP", userId: "ann" };
  const run = async (name: string, args: unknown = {}) => (await executeAgentTool(ctx, name, args)).text;
  const json = async (name: string, args: unknown = {}) => JSON.parse(await run(name, args));

  // Every write tool requires a target in its schema, so the model knows before it calls.
  for (const tool of AGENT_TOOLS.filter((candidate) => candidate.write)) {
    assert(tool.inputSchema.required?.includes("workspace"), `${tool.name} requires workspace`);
  }

  // Reads.
  const joined = await json("list_workspaces");
  assert(joined.map((w: { key: string }) => w.key).sort().join() === "AWAY,HIDE,HOME", "only joined workspaces are listed");
  assert(joined.find((w: { key: string }) => w.key === "HOME").current, "the current workspace is marked");
  assert((await json("list_projects")).length === 2, "projects of this workspace");
  assert((await json("list_projects", { workspace: "away" }))[0].key === "AWAYP", "projects by workspace key, any case");
  assert((await json("list_projects", { workspace: "AWAY space" }))[0].key === "AWAYP", "by workspace name");
  assert((await json("list_tasks")).tasks.length === 1, "default stays on the bound project");
  assert((await json("list_tasks", { project: "HOMEQ" })).tasks[0].identifier === "HOMEQ-1", "another project by name");
  assert((await json("list_tasks", { workspace: "AWAY" })).tasks[0].identifier === "AWAYP-1", "a whole other workspace");
  assert((await json("get_task", { id: "HOMEQ-1" })).identifier === "HOMEQ-1", "workspace-level read of a task");
  assert((await json("get_task", { id: "AWAYP-1", workspace: "AWAY" })).identifier === "AWAYP-1", "a task elsewhere");
  assert((await error(() => run("get_overview", { workspace: "AWAY" }))).includes("project"), "an overview elsewhere needs a project");
  assert((await json("get_overview", { workspace: "AWAY", project: "AWAYP" })).key === "AWAYP", "an overview elsewhere");

  const field = await createTaskField("away", "ann", { name: "Stage", type: "text" });
  await setTaskFieldValue("away", "away-i", field.id, "beta", "ann", { kind: "user", userId: "ann" } as never);
  assert((await json("get_task", { id: "AWAYP-1", workspace: "AWAY" })).customFields.Stage === "beta", "custom fields are read");

  const doc = await pagesLib.createPage("away", "ann", { projectId: "away-p", title: "Away doc" });
  await pagesLib.setPageShared("away", doc.id, "ann", true);
  await pagesLib.updatePage("away", doc.id, "ann", { doc: "needle body" });
  assert((await json("get_doc", { title: "Away doc", workspace: "AWAY" })).title === "Away doc", "a document elsewhere");

  // Search.
  const here = await json("search_workspace", { query: "needle" });
  assert(here.results.every((hit: { ref: string }) => hit.ref?.startsWith("HOME")), "search defaults to this workspace");
  assert(here.count === 1, `one hit here: ${JSON.stringify(here)}`);
  const all = await json("search_workspace", { query: "needle", workspace: "all" });
  const found = all.results.map((hit: { workspace: string }) => hit.workspace);
  assert(found.includes("HOME") && found.includes("AWAY"), "all covers every joined workspace");
  assert(!found.includes("SHUT"), "all stops at joined workspaces");
  assert(!found.includes("HIDE"), "all keeps to what the person can see");

  // Nothing outside joined workspaces, and the refusal does not confirm it exists.
  const notJoined = await error(() => run("list_tasks", { workspace: "SHUT" }));
  assert(notJoined.includes("have not joined"), `unjoined refused: ${notJoined}`);
  assert((await error(() => run("list_tasks", { workspace: "NOPE" }))).replace("NOPE", "SHUT") === notJoined, "unjoined reads like nonexistent");
  for (const [name, args] of [
    ["list_projects", {}],
    ["get_task", { id: "SHUTP-1" }],
    ["get_doc", { title: "x" }],
    ["get_overview", { project: "SHUTP" }],
    ["search_workspace", { query: "needle" }],
  ] as const) {
    assert((await error(() => run(name, { ...args, workspace: "SHUT" }))).includes("have not joined"), `${name} stays out`);
    assert((await error(() => run(name, { ...args, workspace: "shut" }))).includes("have not joined"), `${name} any case`);
  }
  assert((await error(() => run("get_task", { id: "SHUTP-1" }))).includes("not found"), "an id from elsewhere finds nothing");
  assert((await error(() => run("get_task", { id: "HIDEP-1", workspace: "HIDE" }))).includes("not found"), "a task hidden from her");
  assert((await error(() => run("list_tasks", { workspace: "HIDE", project: "HIDEP" }))).includes("No project"), "a project hidden from her");

  // A write without a target is refused and does nothing.
  const before = (await db.select().from(issues)).length;
  const bare = await error(() => run("create_task", { title: "Nowhere" }));
  assert(bare.includes("Name the workspace"), `bare write refused: ${bare}`);
  assert((await db.select().from(issues)).length === before, "the refused write made nothing");
  // A named write lands there, and only there.
  assert((await run("create_task", { title: "Here", workspace: "HOME" })).includes("HOMEP-"), "named write to this workspace");
  assert((await run("create_task", { title: "There", workspace: "AWAY", project: "AWAYP" })).includes("AWAYP-"), "named write elsewhere");
  assert((await error(() => run("create_task", { title: "x", workspace: "AWAY" }))).includes("project too"), "elsewhere needs a project");
  assert((await error(() => run("create_task", { title: "x", workspace: "SHUT", project: "SHUTP" }))).includes("have not joined"), "no write to unjoined");
  assert((await error(() => run("create_task", { title: "x", workspace: "HIDE", project: "HIDEP" }))).includes("No project"), "no write to a hidden project");
  await run("edit_doc", { id: doc.id, workspace: "AWAY", edits: [{ find: "needle", replace: "pin" }] });
  assert((await pagesLib.getPage("away", doc.id, "ann"))!.doc === "pin body", "a document edit elsewhere needs no project");

  // Writing elsewhere always asks, whatever the approval level; other cases follow that level.
  assert(await writesElsewhere(ctx, "create_task", { workspace: "AWAY" }), "elsewhere is flagged");
  assert(!(await writesElsewhere(ctx, "create_task", { workspace: "HOME" })), "here is not");
  assert(!(await writesElsewhere(ctx, "list_tasks", { workspace: "AWAY" })), "a read is not");

  console.log("check-agent-workspace-reach: ok");
}

void main();
