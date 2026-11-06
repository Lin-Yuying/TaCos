/**
 * U-13b pages MCP surface: page tools, annotations, output schemas, cursor pagination,
 * page visibility, project allowlist, read-only filtering and the stdio person rule.
 * Run: npx tsx scripts/check-mcp-pages.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-mcp-pages-"));
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

const ALL_TOOLS =
  "add_comment,add_dependency,add_page_comment,claim_issue,create_issue,create_label,create_page,create_project,delete_issue,get_issue,get_page,get_project,list_issues,list_labels,list_members,list_page_comments,list_pages,list_project_tasks,list_projects,release_issue,remove_dependency,report_blocker,restore_issue,set_review_state,set_task_fields,update_issue,update_page,update_project";
const READ_TOOLS =
  "get_issue,get_page,get_project,list_issues,list_labels,list_members,list_page_comments,list_pages,list_project_tasks,list_projects";

async function main() {
  const { getDb } = await import("../src/db/client");
  const { pageComments, pageVersions, projects, users, workspaceMembers, workspaces } =
    await import("../src/db/schema");
  const { desc, eq } = await import("drizzle-orm");
  const lib = await import("../src/lib/pages");
  const { createMcpServer } = await import("../mcp/create-server");

  const db = getDb();
  const at = new Date().toISOString();
  for (const [id, role] of [
    ["m-owner", "admin"],
    ["m-member", "member"],
  ] as const) {
    await db.insert(users).values({
      id,
      username: id,
      displayName: id,
      passwordHash: "x",
      createdAt: at,
    });
    await db.insert(workspaceMembers).values({
      workspaceId: "mcp-pages-ws",
      userId: id,
      role,
      createdAt: at,
    });
  }
  await db.insert(workspaces).values({
    id: "mcp-pages-ws",
    name: "MCP Pages",
    key: "MCPP",
    createdBy: "m-owner",
    createdAt: at,
  });
  await db.insert(projects).values([
    { id: "m-pa", workspaceId: "mcp-pages-ws", key: "MA", name: "Alpha", createdBy: "m-owner", createdAt: at },
    { id: "m-pb", workspaceId: "mcp-pages-ws", key: "MB", name: "Beta", createdBy: "m-owner", createdAt: at },
  ] as never);

  const paShared = await lib.createPage("mcp-pages-ws", "m-owner", {
    title: "Alpha shared",
    doc: "Shared body",
    projectId: "m-pa",
  });
  await lib.setPageShared("mcp-pages-ws", paShared.id, "m-owner", true);
  const child = await lib.createPage("mcp-pages-ws", "m-owner", {
    title: "Alpha child",
    doc: "Child body",
    parentId: paShared.id,
  });
  const pbShared = await lib.createPage("mcp-pages-ws", "m-owner", {
    title: "Beta shared",
    doc: "Beta body",
    projectId: "m-pb",
  });
  await lib.setPageShared("mcp-pages-ws", pbShared.id, "m-owner", true);
  const workspaceShared = await lib.createPage("mcp-pages-ws", "m-owner", {
    title: "Workspace doc",
    doc: "Landing",
  });
  await lib.setPageShared("mcp-pages-ws", workspaceShared.id, "m-owner", true);
  const ownerPrivate = await lib.createPage("mcp-pages-ws", "m-owner", {
    title: "Owner private",
    doc: "Owner only",
    projectId: "m-pa",
  });
  const memberPrivate = await lib.createPage("mcp-pages-ws", "m-member", {
    title: "Member private",
    doc: "Member only",
    projectId: "m-pa",
  });

  const baseOptions: CreateMcpServerOptions = {
    workspaceId: "mcp-pages-ws",
    actor: { kind: "agent", label: "api:check", via: "mcp" },
    readOnly: false,
    allowedProjectIds: null,
    toolFilter: null,
    viewerId: "m-owner",
    userId: "m-owner",
  };

  async function connect(overrides: Partial<CreateMcpServerOptions> = {}) {
    const server = createMcpServer({ ...baseOptions, ...overrides });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "tacos-check-mcp-pages", version: "0.0.0" });
    await client.connect(clientTransport);
    return { client, server };
  }

  async function callOk(client: Client, name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    if (result.isError) throw new Error(`${name} failed: ${resultText(result)}`);
    if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
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
  assert(names.join(",") === ALL_TOOLS, `all twenty-eight tools register: ${names.join(",")}`);
  const listPagesTool = toolList.find((tool) => tool.name === "list_pages");
  const getPageTool = toolList.find((tool) => tool.name === "get_page");
  const listCommentsTool = toolList.find((tool) => tool.name === "list_page_comments");
  const createPageTool = toolList.find((tool) => tool.name === "create_page");
  const updatePageTool = toolList.find((tool) => tool.name === "update_page");
  const addPageCommentTool = toolList.find((tool) => tool.name === "add_page_comment");
  for (const tool of [listPagesTool, getPageTool, listCommentsTool]) {
    assert(tool?.annotations?.readOnlyHint === true, `${String(tool?.name)} is annotated read-only`);
    assert(
      tool?.outputSchema !== undefined && tool.outputSchema !== null,
      `${String(tool?.name)} declares an output schema`
    );
  }
  for (const tool of [createPageTool, updatePageTool, addPageCommentTool]) {
    assert(tool?.annotations?.readOnlyHint === false, `${String(tool?.name)} is annotated a write`);
  }
  assert(toolList.every((tool) => tool.annotations?.openWorldHint === false), "every tool is closed-world");

  // 1. list_pages follows page visibility and leaves bodies out.
  const listed = await callOk(full.client, "list_pages", {});
  const listedPages = listed.pages as Array<{ id: string; title: string; projectId: string | null }>;
  const listedTitles = listedPages.map((page) => page.title).sort();
  assert(listed.count === 5 && listed.total === 5, `the owner lists five visible pages: ${String(listed.count)}/${String(listed.total)}`);
  assert(
    listedTitles.join(",") === "Alpha child,Alpha shared,Beta shared,Owner private,Workspace doc",
    `shared pages plus the owner's own: ${listedTitles.join(",")}`
  );
  assert(!listedPages.some((page) => page.title === "Member private"), "another member's private page stays hidden");
  assert(!("doc" in listedPages[0]), "list_pages leaves the body out");

  // 2. Cursor pagination is stable and complete.
  const firstPage = await callOk(full.client, "list_pages", { limit: 2 });
  const firstRows = firstPage.pages as Array<{ id: string }>;
  assert(firstRows.length === 2 && firstPage.total === 5, "first page is two rows");
  assert(typeof firstPage.nextCursor === "string", "the first page returns a cursor");
  const secondPage = await callOk(full.client, "list_pages", {
    limit: 2,
    cursor: String(firstPage.nextCursor),
  });
  const secondRows = secondPage.pages as Array<{ id: string }>;
  assert(secondRows.length === 2, "the cursor returns the next page");
  assert(
    secondRows.every((row) => !firstRows.some((first) => first.id === row.id)),
    "pages do not repeat across cursors"
  );
  const thirdPage = await callOk(full.client, "list_pages", {
    limit: 2,
    cursor: String(secondPage.nextCursor),
  });
  assert((thirdPage.pages as unknown[]).length === 1, "the last page is the remainder");
  assert(thirdPage.nextCursor === null, "the last page has no cursor");
  const badCursor = await callErr(full.client, "list_pages", { cursor: "bad" });
  assert(badCursor.isError && /Invalid cursor/.test(badCursor.text), "an invalid cursor is refused");

  // 3. Project and title filters.
  const project = await callOk(full.client, "list_pages", { project: "MA" });
  const projectRows = project.pages as Array<{ projectId: string }>;
  assert(projectRows.length === 3 && projectRows.every((page) => page.projectId === "m-pa"), `project filter: ${projectRows.length}`);
  const searched = await callOk(full.client, "list_pages", { q: "ALPHA" });
  assert((searched.pages as unknown[]).length === 2, "title search is case-insensitive");
  const badProject = await callErr(full.client, "list_pages", { project: "NOPE" });
  assert(badProject.isError && /not found/.test(badProject.text), "an unknown project is refused");

  // 4. get_page returns the markdown body plus its author.
  const got = await callOk(full.client, "get_page", { id: paShared.id });
  assert(got.doc === "Shared body" && got.title === "Alpha shared", "get_page returns the body");
  assert((got.author as { id: string }).id === "m-owner", "get_page names the author");
  const gotPrivate = await callOk(full.client, "get_page", { id: ownerPrivate.id });
  assert(gotPrivate.doc === "Owner only", "the author reads a private page");
  const othersPrivate = await callErr(full.client, "get_page", { id: memberPrivate.id });
  assert(othersPrivate.isError && /not found/.test(othersPrivate.text), "another member's private page is not found");
  const missing = await callErr(full.client, "get_page", { id: "nope" });
  assert(missing.isError && /not found/.test(missing.text), "an unknown page is not found");

  // 5. create_page: a person, project/parent association, and mcp attribution.
  const created = await callOk(full.client, "create_page", {
    title: "MCP created",
    doc: "Made by MCP",
    project: "MA",
  });
  assert(created.createdBy === "m-owner", "the key's person owns the page");
  assert(created.projectId === "m-pa" && created.shared === false, "a new page is private and project-bound");
  const createdVersions = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, String(created.id)))
    .orderBy(desc(pageVersions.seq));
  assert(
    createdVersions.length === 1 && createdVersions[0].via === "mcp",
    `the creating write is attributed to mcp: ${createdVersions.map((version) => version.via).join(",")}`
  );
  const createdChild = await callOk(full.client, "create_page", {
    title: "MCP child",
    parent: paShared.id,
  });
  assert(
    createdChild.projectId === "m-pa" && createdChild.shared === true,
    "a subpage inherits its parent's project and sharing"
  );
  const workspacePage = await callOk(full.client, "create_page", { title: "MCP workspace doc" });
  assert(workspacePage.projectId === null, "a page without a project is a workspace page");

  // 6. update_page: body/title/icon, stale revision, mcp attribution.
  const updated = await callOk(full.client, "update_page", {
    id: paShared.id,
    title: "Alpha shared v2",
    doc: "Shared body v2",
    icon: "📄",
  });
  assert(updated.title === "Alpha shared v2" && updated.doc === "Shared body v2" && updated.icon === "📄", "update_page writes all three fields");
  const updatedVersions = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, paShared.id))
    .orderBy(desc(pageVersions.seq));
  assert(updatedVersions[0]?.via === "mcp", `the update is attributed to mcp: ${updatedVersions[0]?.via}`);
  const stale = await callErr(full.client, "update_page", {
    id: paShared.id,
    doc: "stale",
    baseRevision: 0,
  });
  assert(stale.isError && /changed/.test(stale.text), "a stale baseRevision is refused");
  const emptyUpdate = await callErr(full.client, "update_page", { id: paShared.id });
  assert(emptyUpdate.isError && /at least one/.test(emptyUpdate.text), "an empty update is refused");
  const hiddenUpdate = await callErr(full.client, "update_page", {
    id: memberPrivate.id,
    title: "Nope",
  });
  assert(hiddenUpdate.isError && /not found/.test(hiddenUpdate.text), "another member's private page cannot be updated");

  // 7. add_page_comment and list_page_comments.
  const added = await callOk(full.client, "add_page_comment", {
    id: paShared.id,
    body: "First MCP comment",
  });
  const addedComment = added.comment as { id: string; body: string; via: string; author: { id: string } };
  assert(addedComment.body === "First MCP comment", "the comment text is stored");
  assert(addedComment.author.id === "m-owner", "the comment is authored by the key's person");
  const [commentRow] = await db
    .select()
    .from(pageComments)
    .where(eq(pageComments.id, addedComment.id));
  assert(commentRow?.via === "mcp", `the comment is attributed to mcp: ${commentRow?.via}`);
  const reply = await callOk(full.client, "add_page_comment", {
    id: paShared.id,
    body: "A reply",
    parentId: addedComment.id,
  });
  assert((reply.comment as { parentId: string }).parentId === addedComment.id, "a reply keeps its parent");
  const comments = await callOk(full.client, "list_page_comments", { id: paShared.id });
  assert((comments.comments as unknown[]).length === 2, "both comments are listed");
  const firstComments = await callOk(full.client, "list_page_comments", { id: paShared.id, limit: 1 });
  assert((firstComments.comments as unknown[]).length === 1 && typeof firstComments.nextCursor === "string", "comments paginate");
  const nextComments = await callOk(full.client, "list_page_comments", {
    id: paShared.id,
    limit: 1,
    cursor: String(firstComments.nextCursor),
  });
  assert((nextComments.comments as unknown[]).length === 1, "the comment cursor returns the next page");
  const emptyComment = await callErr(full.client, "add_page_comment", { id: paShared.id, body: "  " });
  assert(emptyComment.isError, "an empty comment is refused");
  const hiddenComment = await callErr(full.client, "add_page_comment", {
    id: memberPrivate.id,
    body: "Nope",
  });
  assert(hiddenComment.isError && /not found/.test(hiddenComment.text), "another member's private page cannot be commented on");
  const hiddenComments = await callErr(full.client, "list_page_comments", { id: memberPrivate.id });
  assert(hiddenComments.isError && /not found/.test(hiddenComments.text), "another member's private comments stay hidden");

  // 8. A read-only server registers only read tools.
  const readOnly = await connect({ readOnly: true });
  const readNames = (await readOnly.client.listTools()).tools.map((tool) => tool.name).sort();
  assert(readNames.join(",") === READ_TOOLS, `a read-only server serves only read tools: ${readNames.join(",")}`);

  // 9. The project allowlist gates page reads and writes.
  const scoped = await connect({ allowedProjectIds: ["m-pa"] });
  const scopedList = await callOk(scoped.client, "list_pages", {});
  const scopedRows = scopedList.pages as Array<{ title: string; projectId: string | null }>;
  assert(
    scopedRows.every((page) => page.projectId === null || page.projectId === "m-pa"),
    `the allowlist filters the page list: ${scopedRows.map((page) => page.title).join(",")}`
  );
  assert(
    !scopedRows.some((page) => page.title === "Beta shared"),
    "a page in another project does not appear"
  );
  assert(
    scopedRows.some((page) => page.title === "Workspace doc"),
    "a workspace page without a project stays readable"
  );
  const scopedGet = await callErr(scoped.client, "get_page", { id: pbShared.id });
  assert(scopedGet.isError && /allowlist/.test(scopedGet.text), "a scoped server cannot read another project's page");
  const scopedUpdate = await callErr(scoped.client, "update_page", { id: pbShared.id, title: "Nope" });
  assert(scopedUpdate.isError && /allowlist/.test(scopedUpdate.text), "a scoped server cannot update another project's page");
  const scopedComment = await callErr(scoped.client, "add_page_comment", {
    id: pbShared.id,
    body: "Nope",
  });
  assert(scopedComment.isError && /allowlist/.test(scopedComment.text), "a scoped server cannot comment on another project's page");
  const scopedCreate = await callErr(scoped.client, "create_page", { title: "Outside", project: "MB" });
  assert(scopedCreate.isError && /allowlist/.test(scopedCreate.text), "a scoped server cannot create in another project");
  const scopedChild = await callErr(scoped.client, "create_page", {
    title: "Outside child",
    parent: pbShared.id,
  });
  assert(scopedChild.isError && /allowlist/.test(scopedChild.text), "a scoped server cannot create under another project's page");
  const scopedAllowedCreate = await callOk(scoped.client, "create_page", { title: "Inside", project: "MA" });
  assert(scopedAllowedCreate.projectId === "m-pa", "a scoped server creates inside its allowlist");

  // 10. With no viewer (stdio), page reads are trusted but writes need a person.
  const trusted = await connect({ viewerId: null, userId: null });
  const trustedList = await callOk(trusted.client, "list_pages", {});
  const trustedRows = trustedList.pages as Array<{ title: string }>;
  assert(trustedRows.length === 10, `the trusted stdio server reads every page: ${trustedRows.length}`);
  assert(trustedRows.some((page) => page.title === "Member private"), "the trusted server reads a member's private page");
  const trustedGet = await callOk(trusted.client, "get_page", { id: memberPrivate.id });
  assert(trustedGet.doc === "Member only", "the trusted server reads any page body");
  const trustedComments = await callOk(trusted.client, "list_page_comments", { id: memberPrivate.id });
  assert(Array.isArray(trustedComments.comments), "the trusted server lists a private page's comments");
  for (const [tool, args] of [
    ["create_page", { title: "No person" }],
    ["update_page", { id: paShared.id, title: "No person" }],
    ["add_page_comment", { id: paShared.id, body: "No person" }],
  ] as const) {
    const refused = await callErr(trusted.client, tool, args as Record<string, unknown>);
    assert(refused.isError && /signed-in person/.test(refused.text), `${tool} needs a person: ${refused.text}`);
  }

  // 11. TACOS_MCP_TOOLS still narrows the set.
  const filtered = await connect({ toolFilter: ["list_pages", "get_page"] });
  const filteredNames = (await filtered.client.listTools()).tools.map((tool) => tool.name).sort();
  assert(filteredNames.join(",") === "get_page,list_pages", `tool filter: ${filteredNames.join(",")}`);

  await full.client.close();
  await readOnly.client.close();
  await scoped.client.close();
  await trusted.client.close();
  await filtered.client.close();
  console.log(
    "check-mcp-pages: pass (28 tools, page annotations+output schemas, list/get/create/update, comments list+add+thread+cursor, private/shared visibility, project allowlist, read-only filter, trusted stdio reads, person-only writes, tool filter)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
