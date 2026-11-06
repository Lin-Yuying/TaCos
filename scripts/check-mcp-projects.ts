/**
 * U-13a MCP surface: project tools, task-extensions tools, annotations, output
 * schemas, pagination and the project allowlist / person requirements.
 * Run: npx tsx scripts/check-mcp-projects.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CreateMcpServerOptions } from "../mcp/create-server";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-mcp-projects-"));
process.env.TACOS_SEED_DEMO = "0";

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
};

function resultText(result: unknown): string {
  const content = (result as ToolResult).content ?? [];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { blockers, events, projects, users, workspaceMembers, workspaces } = await import(
    "../src/db/schema"
  );
  const { and, eq } = await import("drizzle-orm");
  const { createIssue, deleteIssue } = await import("../src/lib/issues");
  const { createTaskField } = await import("../src/lib/task-fields");
  const { createMcpServer } = await import("../mcp/create-server");

  const db = getDb();
  const at = new Date().toISOString();
  await db.insert(users).values({
    id: "m-owner",
    username: "mowner",
    displayName: "M Owner",
    passwordHash: "x",
    createdAt: at,
  });
  await db.insert(workspaceMembers).values({
    workspaceId: "mcp-ws",
    userId: "m-owner",
    role: "admin",
    createdAt: at,
  });
  await db.insert(workspaces).values({
    id: "mcp-ws",
    name: "MCP Space",
    key: "MCP",
    createdBy: "m-owner",
    createdAt: at,
  });
  await db.insert(projects).values([
    { id: "m-pa", workspaceId: "mcp-ws", key: "MA", name: "Alpha", createdBy: "m-owner", createdAt: at },
    { id: "m-pb", workspaceId: "mcp-ws", key: "MB", name: "Beta", createdBy: "m-owner", createdAt: at },
  ] as never);
  await createTaskField("mcp-ws", "m-owner", {
    name: "Stage",
    type: "select",
    options: ["alpha", "beta"],
  });
  const owner = { kind: "user" as const, userId: "m-owner", displayName: "M Owner" };
  const agentSeed = { kind: "agent" as const, label: "seed", via: "mcp" as const, publishedBy: "m-owner" };
  const alphaOne = await createIssue("mcp-ws", { title: "Alpha one", project: "MA" }, owner);
  await createIssue("mcp-ws", { title: "Alpha two", project: "MA" }, owner);
  await createIssue("mcp-ws", { title: "Alpha three", project: "MA" }, owner);
  const betaTask = await createIssue("mcp-ws", { title: "Beta one", project: "MB" }, owner);
  const pending = await createIssue("mcp-ws", { title: "Needs review", project: "MA" }, agentSeed);

  const baseOptions: CreateMcpServerOptions = {
    workspaceId: "mcp-ws",
    actor: { kind: "agent", label: "api:check", via: "mcp" },
    readOnly: false,
    allowedProjectIds: null,
    toolFilter: null,
    userId: "m-owner",
  };

  async function connect(overrides: Partial<CreateMcpServerOptions> = {}) {
    const server = createMcpServer({ ...baseOptions, ...overrides });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "tacos-check-mcp-projects", version: "0.0.0" });
    await client.connect(clientTransport);
    return { client, server };
  }

  async function callOk(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    if (result.isError) throw new Error(`${name} failed: ${resultText(result)}`);
    if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
    // Tools without an outputSchema (writes) answer with JSON text only.
    const text = resultText(result);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`${name} returned non-JSON: ${text}`);
    }
  }

  async function callErr(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    return { isError: result.isError === true, text: resultText(result) };
  }

  const full = await connect();
  const toolList = (await full.client.listTools()).tools;
  const names = toolList.map((tool) => tool.name).sort();
  assert(
    names.join(",") ===
      "add_comment,add_dependency,claim_issue,create_issue,create_label,create_project,delete_issue,get_issue,get_project,list_issues,list_labels,list_members,list_project_tasks,list_projects,release_issue,remove_dependency,report_blocker,restore_issue,set_review_state,set_task_fields,update_issue,update_project",
    `all twenty-two tools register: ${names.join(",")}`
  );
  const getProjectTool = toolList.find((tool) => tool.name === "get_project");
  const listTasksTool = toolList.find((tool) => tool.name === "list_project_tasks");
  const createProjectTool = toolList.find((tool) => tool.name === "create_project");
  assert(getProjectTool?.annotations?.readOnlyHint === true, "get_project is annotated read-only");
  assert(listTasksTool?.annotations?.readOnlyHint === true, "list_project_tasks is annotated read-only");
  assert(listTasksTool?.outputSchema !== undefined && listTasksTool.outputSchema !== null, "list_project_tasks declares an output schema");
  assert(getProjectTool?.outputSchema !== undefined && getProjectTool.outputSchema !== null, "get_project declares an output schema");
  assert(createProjectTool?.annotations?.readOnlyHint === false, "create_project is annotated a write");
  assert(toolList.every((tool) => tool.annotations?.openWorldHint === false), "every tool is closed-world");

  // 1. Project create/get/update.
  const createdProject = await callOk(full.client, "create_project", {
    name: "Gamma",
    description: "Created by MCP",
  });
  assert(createdProject.createdBy === "m-owner", `the key's person leads the project: ${String(createdProject.createdBy)}`);
  assert(typeof createdProject.key === "string", "the project has a key");
  const projectKey = String(createdProject.key);
  const gotProject = await callOk(full.client, "get_project", { project: projectKey });
  assert(gotProject.name === "Gamma" && gotProject.key === projectKey, "get_project returns the project");
  assert(Array.isArray(gotProject.members) && (gotProject.members as unknown[]).length === 1, "the lead is listed as a member");
  assert((gotProject.members as Array<{ role: string }>)[0].role === "lead", "the creator is the lead");
  assert(!("doc" in gotProject), "the project Overview document is not exposed");
  const updatedProject = await callOk(full.client, "update_project", {
    project: projectKey,
    name: "Gamma renamed",
    description: "Renamed by MCP",
  });
  assert(updatedProject.name === "Gamma renamed" && updatedProject.key === projectKey, "update_project renames, keeps the key");
  const emptyUpdate = await callErr(full.client, "update_project", { project: projectKey });
  assert(emptyUpdate.isError && /at least one/.test(emptyUpdate.text), "an empty project update is refused");

  // 2. Project tasks paginate and follow list filters.
  const firstPage = await callOk(full.client, "list_project_tasks", { project: "MA", limit: 2, status: "all" });
  assert(firstPage.count === 2 && firstPage.total === 4, `first project page: ${String(firstPage.count)}/${String(firstPage.total)}`);
  assert(typeof firstPage.nextCursor === "string", "the project task page returns a cursor");
  const secondPage = await callOk(full.client, "list_project_tasks", {
    project: "MA",
    limit: 2,
    status: "all",
    cursor: String(firstPage.nextCursor),
  });
  assert(secondPage.count === 2, `second project page: ${String(secondPage.count)}`);
  assert((secondPage.issues as Array<{ projectId: string }>).every((issue) => issue.projectId === "m-pa"), "only this project's tasks");

  // 3. Custom fields through set_task_fields and get_issue.
  const setFields = await callOk(full.client, "set_task_fields", {
    id: alphaOne.issue.identifier,
    fields: { Stage: "beta" },
  });
  assert((setFields.fields as Record<string, string>).Stage === "beta", "set_task_fields stores the value");
  const issue = await callOk(full.client, "get_issue", { id: alphaOne.issue.identifier });
  assert((issue.fields as Record<string, string>).Stage === "beta", "get_issue returns custom fields");
  const badField = await callErr(full.client, "set_task_fields", {
    id: alphaOne.issue.identifier,
    fields: { Missing: "x" },
  });
  assert(badField.isError && /Unknown field/.test(badField.text), "an unknown field is refused");

  // 4. Dependencies.
  const linked = await callOk(full.client, "add_dependency", {
    id: alphaOne.issue.identifier,
    blockedBy: "MA-2",
  });
  assert((linked.dependencies as unknown[]).length === 1 && linked.blocked === true, "add_dependency links and blocks");
  const dependencyEvent = await db
    .select()
    .from(events)
    .where(and(eq(events.issueId, alphaOne.issue.id), eq(events.type, "dependency_added")));
  assert(dependencyEvent[0]?.agentActor === "api:check", "the dependency event names the MCP key");
  const unlinked = await callOk(full.client, "remove_dependency", {
    id: alphaOne.issue.identifier,
    blockedBy: "MA-2",
  });
  assert((unlinked.dependencies as unknown[]).length === 0 && unlinked.blocked === false, "remove_dependency unlinks");

  // 5. Claim and release act for the key's person.
  const claimed = await callOk(full.client, "claim_issue", { id: alphaOne.issue.identifier });
  assert(claimed.claimedBy === "m-owner", `claim is for the key's person: ${String(claimed.claimedBy)}`);
  const claimEvent = await db
    .select()
    .from(events)
    .where(and(eq(events.issueId, alphaOne.issue.id), eq(events.type, "claimed")));
  assert(claimEvent[0]?.agentActor === "api:check", "the claim event names the MCP key");
  const released = await callOk(full.client, "release_issue", { id: alphaOne.issue.identifier });
  assert(released.claimedBy === null, "release clears the claim");

  // 6. Review changes.
  const approved = await callOk(full.client, "set_review_state", {
    id: pending.issue.identifier,
    state: "approved",
  });
  assert(approved.reviewStatus === "approved" && approved.reviewedBy === "m-owner", "set_review_state approves as the key's person");
  const secondReview = await callErr(full.client, "set_review_state", {
    id: pending.issue.identifier,
    state: "rejected",
  });
  assert(secondReview.isError && /not waiting for review/.test(secondReview.text), "a reviewed task refuses another state");

  // 7. Blocker report.
  const reported = await callOk(full.client, "report_blocker", {
    id: alphaOne.issue.identifier,
    body: "Waiting on design",
  });
  assert(typeof reported.id === "string", "report_blocker returns its id");
  const [blockerRow] = await db
    .select()
    .from(blockers)
    .where(eq(blockers.issueId, alphaOne.issue.id));
  assert(blockerRow?.authorId === "m-owner", "the blocker is authored by the key's person");

  // 8. Restore from Trash.
  const deleted = await deleteIssue("mcp-ws", betaTask.issue.identifier);
  const restored = await callOk(full.client, "restore_issue", { id: deleted.identifier });
  assert((restored.restored as { identifier: string }).identifier === deleted.identifier, "restore_issue returns the task");
  const restoredIssue = await callOk(full.client, "get_issue", { id: deleted.identifier });
  assert(restoredIssue.identifier === deleted.identifier, "the restored task reads again");

  // 9. The project allowlist gates project and dependency access.
  const scoped = await connect({ allowedProjectIds: ["m-pa"] });
  const scopedNames = (await scoped.client.listTools()).tools.map((tool) => tool.name);
  assert(scopedNames.includes("create_project"), "a scoped server still lists the write tools");
  const scopedCreate = await callErr(scoped.client, "create_project", { name: "Outside" });
  assert(scopedCreate.isError && /allowlist/.test(scopedCreate.text), "a scoped server cannot create projects");
  const scopedGet = await callErr(scoped.client, "get_project", { project: "MB" });
  assert(scopedGet.isError && /allowlist/.test(scopedGet.text), "a scoped server cannot read another project");
  const scopedTasks = await callErr(scoped.client, "list_project_tasks", { project: "MB" });
  assert(scopedTasks.isError && /allowlist/.test(scopedTasks.text), "a scoped server cannot list another project's tasks");
  const scopedDependency = await callErr(scoped.client, "add_dependency", {
    id: "MA-1",
    blockedBy: "MB-1",
  });
  assert(scopedDependency.isError && /allowlist/.test(scopedDependency.text), "a scoped server cannot link another project's task");
  const scopedDefault = await callOk(scoped.client, "get_project", {});
  assert(scopedDefault.key === "MA", `a scoped server defaults to its allowed project: ${String(scopedDefault.key)}`);

  // 10. A read-only server registers only read tools.
  const readOnly = await connect({ readOnly: true });
  const readNames = (await readOnly.client.listTools()).tools.map((tool) => tool.name).sort();
  assert(
    readNames.join(",") === "get_issue,get_project,list_issues,list_labels,list_members,list_project_tasks,list_projects",
    `a read-only server serves only read tools: ${readNames.join(",")}`
  );

  // 11. Person-only tools refuse when the server has no signed-in person (stdio).
  const anon = await connect({ userId: null });
  for (const [name, args] of [
    ["claim_issue", { id: alphaOne.issue.identifier }],
    ["release_issue", { id: alphaOne.issue.identifier }],
    ["set_review_state", { id: alphaOne.issue.identifier, state: "approved" }],
    ["report_blocker", { id: alphaOne.issue.identifier, body: "stuck" }],
  ] as const) {
    const refused = await callErr(anon.client, name, args as Record<string, unknown>);
    assert(refused.isError && /signed-in person/.test(refused.text), `${name} needs a person: ${refused.text}`);
  }
  const orphan = await callOk(anon.client, "create_project", { name: "Orphan" });
  assert(orphan.createdBy === null, `a personless server creates a project with no lead: ${String(orphan.createdBy)}`);

  // 12. TACOS_MCP_TOOLS still narrows the set.
  const filtered = await connect({ toolFilter: ["get_project", "list_project_tasks"] });
  const filteredNames = (await filtered.client.listTools()).tools.map((tool) => tool.name).sort();
  assert(filteredNames.join(",") === "get_project,list_project_tasks", `tool filter: ${filteredNames.join(",")}`);

  await full.client.close();
  await scoped.client.close();
  await readOnly.client.close();
  await anon.client.close();
  await filtered.client.close();
  console.log(
    "check-mcp-projects: pass (22 tools, 12 new tools, annotations+output schemas, project CRUD, project tasks cursor, fields, dependencies, claim/release, review, blocker, restore, allowlist, read-only, person requirement, tool filter)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
