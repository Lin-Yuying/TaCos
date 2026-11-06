/**
 * MCP Streamable HTTP endpoint and scoped keys end to end.
 * Drives POST /api/mcp with the real SDK client, in process.
 * Run: npx tsx scripts/check-mcp-http.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-mcp-http-"));

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { users, workspaces, workspaceMembers, projects, labels } = await import("../src/db/schema");
  const { createApiKey, createIssue } = await import("../src/lib/issues");
  const { POST } = await import("../src/app/api/mcp/route");
  const db = getDb();
  const at = new Date().toISOString();
  await db.insert(users).values({
    id: "http-user",
    username: "httpuser",
    displayName: "HTTP User",
    passwordHash: "x",
    createdAt: at,
  });
  await db.insert(workspaces).values({
    id: "http-ws",
    name: "HTTP Space",
    key: "HTTP",
    createdBy: "http-user",
    createdAt: at,
  });
  await db.insert(workspaceMembers).values({
    workspaceId: "http-ws",
    userId: "http-user",
    role: "admin",
    createdAt: at,
  });
  await db.insert(users).values({
    id: "http-outsider",
    username: "httpoutsider",
    displayName: "HTTP Outsider",
    passwordHash: "x",
    createdAt: at,
  });
  await db.insert(workspaceMembers).values({
    workspaceId: "http-ws",
    userId: "http-outsider",
    role: "member",
    createdAt: at,
  });
  const projectA = { id: "http-a", workspaceId: "http-ws", key: "HA", name: "Alpha", createdBy: "http-user", createdAt: at };
  const projectB = { id: "http-b", workspaceId: "http-ws", key: "HB", name: "Beta", createdBy: "http-user", createdAt: at };
  const projectC = { id: "http-c", workspaceId: "http-ws", key: "HC", name: "Hidden", createdBy: "http-outsider", createdAt: at };
  await db.insert(projects).values([projectA, projectB, projectC] as never);
  for (let index = 0; index < 3; index++) {
    await db.insert(labels).values({
      id: `http-label-${index}`,
      workspaceId: "http-ws",
      name: `Label ${index}`,
      color: "#5e6ad2",
      createdAt: at,
    });
  }
  for (const name of ["a", "B", "中"]) {
    await db.insert(labels).values({
      id: `http-label-${name}`,
      workspaceId: "http-ws",
      name,
      color: "#5e6ad2",
      createdAt: at,
    });
  }
  const actor = { kind: "user" as const, userId: "http-user", displayName: "HTTP User" };
  for (let index = 1; index <= 3; index++) {
    await createIssue("http-ws", { title: `Alpha ${index}`, project: "HA" }, actor);
  }
  await createIssue("http-ws", { title: "Beta 1", project: "HB" }, actor);
  const outsiderActor = { kind: "user" as const, userId: "http-outsider", displayName: "HTTP Outsider" };
  await createIssue("http-ws", { title: "Outsider only", project: "HC" }, outsiderActor);
  await db.update(workspaces).set({ membersSeeAllTasks: 0 }).where(eq(workspaces.id, "http-ws"));

  const writer = await createApiKey("http-ws", "http-writer", ["read", "write"], null, 90, "http-user");
  const reader = await createApiKey("http-ws", "http-reader", ["read"], null, 90, "http-user");
  const scoped = await createApiKey("http-ws", "http-alpha-only", ["read", "write"], [projectA.id], 90, "http-user");
  const thirtyDays = new Date(Date.now() + 30 * 86_400_000).toISOString();
  assert(writer.record.expiresAt !== null && writer.record.expiresAt > thirtyDays, "key has a 90-day expiry");

  function transportFor(key: string | null) {
    return new StreamableHTTPClientTransport(new URL("http://tacos.test/api/mcp"), {
      requestInit: key ? { headers: { Authorization: `Bearer ${key}` } } : undefined,
      fetch: async (url, init) => {
        const request = new Request(typeof url === "string" ? url : url.toString(), init);
        return POST(request);
      },
    });
  }

  async function connect(key: string) {
    const client = new Client({ name: "tacos-check-mcp-http", version: "0.0.0" });
    await client.connect(transportFor(key));
    return client;
  }

  const writeClient = await connect(writer.key);
  const tools = (await writeClient.listTools()).tools;
  const names = tools.map((tool) => tool.name).sort();
  assert(
    names.join(",") ===
      "add_comment,add_dependency,claim_issue,create_issue,create_label,create_project,delete_issue,get_issue,get_project,list_issues,list_labels,list_members,list_project_tasks,list_projects,release_issue,remove_dependency,report_blocker,restore_issue,set_review_state,set_task_fields,update_issue,update_project",
    `all twenty-two tools registered: ${names.join(",")}`
  );
  const listIssues = tools.find((tool) => tool.name === "list_issues");
  const deleteIssue = tools.find((tool) => tool.name === "delete_issue");
  const getProject = tools.find((tool) => tool.name === "get_project");
  const listProjectTasks = tools.find((tool) => tool.name === "list_project_tasks");
  assert(listIssues?.annotations?.readOnlyHint === true, "list_issues is annotated read-only");
  assert(deleteIssue?.annotations?.destructiveHint === true, "delete_issue is annotated destructive");
  assert(getProject?.annotations?.readOnlyHint === true, "get_project is annotated read-only");
  assert(listProjectTasks?.annotations?.readOnlyHint === true, "list_project_tasks is annotated read-only");
  assert(tools.every((tool) => tool.annotations?.openWorldHint === false), "every tool is closed-world");
  assert(
    listIssues?.outputSchema !== undefined && listIssues.outputSchema !== null,
    "list_issues declares an output schema"
  );
  assert(getProject?.outputSchema !== undefined && getProject.outputSchema !== null, "get_project declares an output schema");
  assert(listProjectTasks?.outputSchema !== undefined && listProjectTasks.outputSchema !== null, "list_project_tasks declares an output schema");

  const firstPage = await writeClient.callTool({ name: "list_issues", arguments: { limit: 2 } });
  const first = firstPage.structuredContent as { count: number; nextCursor: string | null; issues: Array<{ id: string }> };
  assert(first.count === 2, `first page has two issues: ${first.count}`);
  assert(typeof first.nextCursor === "string" && first.nextCursor.length > 0, "first page returns nextCursor");
  const secondPage = await writeClient.callTool({
    name: "list_issues",
    arguments: { limit: 2, cursor: first.nextCursor },
  });
  const second = secondPage.structuredContent as { issues: Array<{ id: string }> };
  const firstIds = new Set(first.issues.map((issue) => issue.id));
  assert(second.issues.every((issue) => !firstIds.has(issue.id)), "the cursor returns the next page");

  const seenLabels: string[] = [];
  let labelCursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const labelsPage = await writeClient.callTool({
      name: "list_labels",
      arguments: { limit: 1, ...(labelCursor ? { cursor: labelCursor } : {}) },
    });
    const body = labelsPage.structuredContent as { labels: Array<{ id: string }>; nextCursor: string | null };
    assert(body.labels.length === 1, `label page ${page} has one row`);
    seenLabels.push(body.labels[0].id);
    labelCursor = body.nextCursor;
    if (!labelCursor) break;
  }
  assert(!labelCursor, "label pagination terminates");
  assert(new Set(seenLabels).size === 6, `label pages cover mixed-case/Unicode labels: ${seenLabels.join(",")}`);

  const readClient = await connect(reader.key);
  const readNames = (await readClient.listTools()).tools.map((tool) => tool.name).sort();
  assert(
    readNames.join(",") === "get_issue,get_project,list_issues,list_labels,list_members,list_project_tasks,list_projects",
    `read-only key serves only read tools: ${readNames.join(",")}`
  );
  const denied = await readClient.callTool({
    name: "update_issue",
    arguments: { id: "HA-1", title: "nope" },
  });
  assert(denied.isError === true, "a read-only key cannot update");
  assert(/write/.test(toolText(denied)), `the rejection names the missing scope: ${toolText(denied)}`);

  const scopedClient = await connect(scoped.key);
  const scopedList = await scopedClient.callTool({ name: "list_issues", arguments: { limit: 50 } });
  const scopedIssues = (scopedList.structuredContent as { issues: Array<{ title: string }> }).issues;
  assert(
    scopedIssues.length === 3 && scopedIssues.every((issue) => !issue.title.startsWith("Beta")),
    `a project-scoped key sees only its project: ${scopedIssues.map((issue) => issue.title).join(",")}`
  );
  const outside = await scopedClient.callTool({ name: "get_issue", arguments: { id: "HB-1" } });
  assert(outside.isError === true, "a project-scoped key cannot read another project");
  assert(/allowlist/.test(toolText(outside)), `out-of-project read names the allowlist: ${toolText(outside)}`);
  const outsideWrite = await scopedClient.callTool({
    name: "create_issue",
    arguments: { title: "Elsewhere", project: "HB" },
  });
  assert(outsideWrite.isError === true, "a project-scoped key cannot create in another project");
  for (const [tool, args] of [
    ["update_issue", { id: "HB-1", title: "nope" }],
    ["delete_issue", { id: "HB-1" }],
    ["add_comment", { id: "HB-1", body: "nope" }],
  ] as const) {
    const result = await scopedClient.callTool({ name: tool, arguments: args });
    assert(result.isError === true, `a project-scoped key cannot ${tool} another project`);
  }

  const projectsPage = await writeClient.callTool({ name: "list_projects", arguments: { limit: 50 } });
  const projectResult = projectsPage.structuredContent as { projects: Array<{ key: string }> };
  assert(projectResult.projects.length === 3, "list_projects returns every visible project");

  // Task visibility off: a member's key must not see projects they cannot see in the UI.
  const outsiderKey = await createApiKey("http-ws", "http-outsider", ["read", "write"], null, 90, "http-outsider");
  const outsiderClient = await connect(outsiderKey.key);
  const outsiderProjects = await outsiderClient.callTool({ name: "list_projects", arguments: { limit: 50 } });
  const outsiderProjectRows = (outsiderProjects.structuredContent as { projects: Array<{ key: string }> }).projects;
  assert(outsiderProjectRows.length === 1 && outsiderProjectRows[0].key === "HC", `visibility filters projects: ${outsiderProjectRows.map((project) => project.key).join(",")}`);
  const outsiderIssues = await outsiderClient.callTool({ name: "list_issues", arguments: { limit: 50 } });
  const outsiderIssueRows = (outsiderIssues.structuredContent as { issues: Array<{ title: string }> }).issues;
  assert(outsiderIssueRows.length === 1 && outsiderIssueRows[0].title === "Outsider only", `visibility filters tasks: ${outsiderIssueRows.map((issue) => issue.title).join(",")}`);
  for (const [tool, args] of [
    ["get_issue", { id: "HA-1" }],
    ["update_issue", { id: "HA-1", title: "hidden" }],
    ["delete_issue", { id: "HA-1" }],
    ["add_comment", { id: "HA-1", body: "hidden" }],
    ["create_issue", { title: "hidden write", project: "HA" }],
  ] as const) {
    const result = await outsiderClient.callTool({ name: tool, arguments: args });
    assert(result.isError === true, `visibility blocks MCP ${tool}`);
  }
  await outsiderClient.close();

  // A JSON-RPC batch consumes one rate-limit token per tool call, not one per request.
  const batchKey = await createApiKey("http-ws", "http-batch", ["read", "write"], null, 90, "http-user");
  const batch = Array.from({ length: 61 }, (_, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "tools/call",
    params: { name: "create_issue", arguments: { title: `batch ${index}`, project: "HA" } },
  }));
  const batchResponse = await POST(
    new Request("http://tacos.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${batchKey.key}`,
      },
      body: JSON.stringify(batch),
    })
  );
  assert(batchResponse.status === 429, `batch rate limit is per tool call, got ${batchResponse.status}`);

  const unauthorized = await POST(
    new Request("http://tacos.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    })
  );
  assert(unauthorized.status === 401, `missing key is 401, got ${unauthorized.status}`);

  await writeClient.close();
  await readClient.close();
  await scopedClient.close();
  console.log(
    "check-mcp-http: pass (22 tools, annotations, output schema, cursor pagination, mixed-case labels, read-only rejection, project allowlist, task visibility, batch rate limit, 401)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
