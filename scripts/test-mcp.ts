import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function textOf(result: unknown): any {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  const first = content?.find((c) => c.type === "text");
  return first ? JSON.parse(first.text) : null;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"],
  });
  const client = new Client({ name: "tacos-smoke-test", version: "0.0.0" });
  await client.connect(transport);

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
  await client.close();
  console.log("SMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
