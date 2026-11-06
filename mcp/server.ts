#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import { createMcpServer } from "./create-server";

const WORKSPACE_KEY = (process.env.TACOS_WORKSPACE_KEY ?? "HQ").toUpperCase();
const READ_ONLY = /^(1|true|yes)$/i.test(process.env.TACOS_MCP_READ_ONLY ?? "");
const TOOL_FILTER = process.env.TACOS_MCP_TOOLS
  ? process.env.TACOS_MCP_TOOLS.split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  : null;

async function getWorkspaceId(): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.key, WORKSPACE_KEY))
    .limit(1);
  if (!row) {
    throw new Error(
      `Workspace key "${WORKSPACE_KEY}" not found. Set TACOS_WORKSPACE_KEY env var to your workspace key.`
    );
  }
  return row.id;
}

async function main() {
  const workspaceId = await getWorkspaceId();
  const server = createMcpServer({
    workspaceId,
    actor: { kind: "agent", label: "mcp", via: "mcp" },
    readOnly: READ_ONLY,
    allowedProjectIds: null,
    toolFilter: TOOL_FILTER,
    viewerId: null,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[tacos-mcp] stdio server ready (workspace key: ${WORKSPACE_KEY}${READ_ONLY ? ", read-only" : ""}${TOOL_FILTER ? `, tools: ${TOOL_FILTER.join(",")}` : ""})`
  );
}

main().catch((err) => {
  console.error("[tacos-mcp] fatal:", err);
  process.exit(1);
});
