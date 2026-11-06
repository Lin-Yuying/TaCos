import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function textOf(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const first = content?.find((c) => c.type === "text");
  if (first) { try { return JSON.parse(first.text); } catch { throw new Error(first.text); } }
  return null;
}

async function main() {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"tacos-mcp-smoke-"));
  const transportFor = (extraEnv: Record<string,string> = {}) => new StdioClientTransport({
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string,string] => entry[1] !== undefined)),
      TACOS_DATA_DIR: dataDir,
      TACOS_SEED_DEMO: "1",
      ...extraEnv,
    },
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"],
  });
  const client = new Client({ name: "tacos-smoke-test", version: "0.0.0" });
  await client.connect(transportFor());

  const tools = await client.listTools();
  console.log(
    "TOOLS:",
    tools.tools.map((t) => t.name).join(", ")
  );

  const members = await client.callTool({ name: "list_members", arguments: {} });
  const memberList = textOf(members).members;
  console.log("MEMBERS:", memberList.map((m: any) => m.username).join(", "));
  const alex = memberList.find((m: any) => m.username === "alex");
  const sam = memberList.find((m: any) => m.username === "sam");
  if (!alex || !sam) throw new Error("Demo members missing");

  const projects = await client.callTool({ name: "list_projects", arguments: {} });
  console.log("PROJECTS:", textOf(projects).projects.map((p: any) => p.key).join(", "));

  const created = await client.callTool({
    name: "create_issue",
    arguments: {
      title: "MCP smoke test issue",
      project: "CORE",
      priority: "high",
      assignees: ["alex", "sam"],
      labels: ["Agent"],
    },
  });
  const createdIssue = textOf(created);
  console.log("CREATED:", createdIssue.identifier, "-", createdIssue.title);
  if (createdIssue.identifier?.startsWith("CORE-") !== true) throw new Error("Wrong identifier prefix");
  const createdAssignees = (createdIssue.assignees ?? []).map((a: any) => a.username).sort();
  if (createdAssignees.join(",") !== "alex,sam") throw new Error(`Assignees not set: ${createdAssignees}`);

  const updated = await client.callTool({
    name: "update_issue",
    arguments: { id: createdIssue.identifier, status: "in progress", assignee: "" },
  });
  const updatedIssue = textOf(updated);
  console.log("UPDATED status ->", updatedIssue.status, "| assignees ->", updatedIssue.assignees.length);
  if (updatedIssue.status !== "in_progress") throw new Error("Status not updated");
  if (updatedIssue.assignees.length !== 0) throw new Error("Assignees not cleared");

  const commented = await client.callTool({
    name: "add_comment",
    arguments: { id: createdIssue.identifier, body: "Smoke test comment from MCP client." },
  });
  const commentResult = textOf(commented);
  console.log("COMMENTED by:", commentResult.comment.agentAuthor);
  if (commentResult.comment.agentAuthor !== "mcp") throw new Error("Comment not attributed to mcp");

  const fetched = await client.callTool({
    name: "get_issue",
    arguments: { id: createdIssue.identifier },
  });
  const fetchedIssue = textOf(fetched);
  console.log(
    "FETCHED:",
    fetchedIssue.identifier,
    "with",
    fetchedIssue.comments.length,
    "comments,",
    fetchedIssue.events.length,
    "events"
  );

  const deleted = await client.callTool({
    name: "delete_issue",
    arguments: { id: createdIssue.identifier },
  });
  console.log("DELETED:", textOf(deleted).deleted);

  const listed = await client.callTool({
    name: "list_issues",
    arguments: { q: "smoke test" },
  });
  const listResult = textOf(listed);
  if (listResult.count !== 0) throw new Error("Deleted issue still listed!");
  console.log("LIST after delete:", listResult.count, "matches (expected 0)");

  void alex;

  const labelsPage = await client.callTool({
    name: "list_labels",
    arguments: { limit: 2 },
  });
  const firstLabels = textOf(labelsPage);
  if (firstLabels.labels.length !== 2 || !firstLabels.nextCursor) {
    throw new Error(`list_labels should paginate, got ${JSON.stringify(firstLabels)}`);
  }
  const nextLabels = textOf(
    await client.callTool({
      name: "list_labels",
      arguments: { limit: 2, cursor: firstLabels.nextCursor },
    })
  );
  if (nextLabels.labels.some((label: { id: string }) => label.id === firstLabels.labels[0].id)) {
    throw new Error("list_labels cursor did not advance");
  }
  console.log("PAGINATED labels:", firstLabels.labels.length, "+", nextLabels.labels.length);
  await client.close();

  // TACOS_MCP_READ_ONLY hides every write tool and rejects write calls.
  const readOnly = new Client({ name: "tacos-smoke-read-only", version: "0.0.0" });
  await readOnly.connect(transportFor({ TACOS_MCP_READ_ONLY: "1" }));
  const readOnlyNames = (await readOnly.listTools()).tools.map((tool) => tool.name).sort();
  if (
    readOnlyNames.join(",") !==
    "get_issue,get_page,get_project,list_issues,list_labels,list_members,list_page_comments,list_pages,list_project_tasks,list_projects"
  ) {
    throw new Error(`read-only tools: ${readOnlyNames.join(",")}`);
  }
  const rejected = await readOnly.callTool({ name: "create_issue", arguments: { title: "nope" } });
  if (rejected.isError !== true) throw new Error("read-only server accepted a write");
  console.log("READ-ONLY:", readOnlyNames.join(", "));
  await readOnly.close();

  // TACOS_MCP_TOOLS registers only the named tools.
  const filtered = new Client({ name: "tacos-smoke-filtered", version: "0.0.0" });
  await filtered.connect(transportFor({ TACOS_MCP_TOOLS: "list_labels,list_members" }));
  const filteredNames = (await filtered.listTools()).tools.map((tool) => tool.name).sort();
  if (filteredNames.join(",") !== "list_labels,list_members") {
    throw new Error(`filtered tools: ${filteredNames.join(",")}`);
  }
  console.log("TOOL FILTER:", filteredNames.join(", "));
  await filtered.close();

  console.log("SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
