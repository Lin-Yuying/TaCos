#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import {
  addComment,
  createIssue,
  createLabel,
  deleteIssue,
  getIssueDetail,
  listIssues,
  listLabels,
  listMembers,
  listProjects,
  normalizePriority,
  normalizeStatus,
  PRIORITY_NAMES,
  resolveAssigneeId,
  resolveAssigneeIds,
  updateIssue,
  type Priority,
  type Status,
} from "../src/lib/issues";

const WORKSPACE_KEY = (process.env.TACOS_WORKSPACE_KEY ?? "HQ").toUpperCase();

const server = new McpServer({ name: "tacos", version: "0.2.0" });

const AGENT = { kind: "agent" as const, label: "mcp", via: "mcp" as const };

const STATUS_HELP =
  "todo, in_progress, done, canceled (aliases like 'in progress', 'completed', 'cancelled' also work)";
const PRIORITY_HELP = "none (0), low (1), medium (2), high (3), urgent (4)";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function guard(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

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

function parseStatus(value?: string): Status | undefined {
  if (value === undefined) return undefined;
  const status = normalizeStatus(value);
  if (!status) throw new Error(`Invalid status "${value}". Valid statuses: ${STATUS_HELP}`);
  return status;
}

function parsePriority(value?: string | number): Priority | undefined {
  if (value === undefined) return undefined;
  const priority = normalizePriority(value);
  if (priority === null)
    throw new Error(`Invalid priority "${value}". Valid priorities: ${PRIORITY_HELP}`);
  return priority;
}

async function resolveProject(workspaceId: string, project?: string): Promise<string> {
  if (!project) {
    const projects = await listProjects(workspaceId);
    if (projects.length === 0)
      throw new Error("This workspace has no projects yet — create one in the web UI first.");
    return projects[0].key;
  }
  return project;
}

server.registerTool(
  "list_issues",
  {
    title: "List issues",
    description: "List issues, newest activity first, grouped by status. Filter by status, priority, project, assignee, text query, or label.",
    inputSchema: {
      status: z.string().optional().describe(`Filter by status: ${STATUS_HELP}, or "active" (todo + in_progress), or "all"`),
      priority: z.union([z.string(), z.number()]).optional().describe(`Filter by priority: ${PRIORITY_HELP}`),
      project: z.string().optional().describe("Project key, e.g. CORE"),
      assignee: z.string().optional().describe('Filter by assignee: username, "me" is not supported (agents have no account), or "none" for unassigned'),
      q: z.string().optional().describe("Free-text search across title, description, and identifier"),
      label: z.string().optional().describe("Filter by label name"),
      limit: z.number().optional().describe("Max results (default 100, max 200)"),
    },
  },
  async ({ status, priority, project, assignee, q, label, limit }) =>
    guard(async () => {
      const workspaceId = await getWorkspaceId();
      let assigneeId: string | null | undefined;
      if (assignee === "none") {
        assigneeId = null;
      } else if (assignee) {
        assigneeId = await resolveAssigneeId(workspaceId, assignee);
      }
      const issues = await listIssues(workspaceId, {
        status: status === "active" || status === "all" ? status : parseStatus(status),
        priority: parsePriority(priority),
        q,
        label,
        projectId: project,
        assigneeId,
        limit: limit ? Math.min(Math.max(limit, 1), 200) : undefined,
      });
      return {
        count: issues.length,
        issues: issues.map((issue) => ({
          ...issue,
          priorityLabel: PRIORITY_NAMES[issue.priority],
        })),
      };
    })
);

server.registerTool(
  "get_issue",
  {
    title: "Get issue",
    description: "Get one issue with its labels, assignee, comments, and full activity timeline.",
    inputSchema: {
      id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
    },
  },
  async ({ id }) =>
    guard(async () => {
      const workspaceId = await getWorkspaceId();
      const detail = await getIssueDetail(workspaceId, id);
      if (!detail) throw new Error(`Issue "${id}" not found`);
      return {
        ...detail.issue,
        priorityLabel: PRIORITY_NAMES[detail.issue.priority],
        comments: detail.comments,
        events: detail.events,
      };
    })
);

server.registerTool(
  "create_issue",
  {
    title: "Create issue",
    description: "Create a new issue in a project. Labels that do not exist yet are created automatically.",
    inputSchema: {
      title: z.string().describe("Short, imperative summary"),
      description: z.string().optional().describe("Longer description (plain text or markdown)"),
      project: z.string().optional().describe("Project key (defaults to the first project), e.g. CORE"),
      status: z.string().optional().describe(`Initial status, default "todo". Valid: ${STATUS_HELP}`),
      priority: z.union([z.string(), z.number()]).optional().describe(`Valid: ${PRIORITY_HELP}`),
      assignee: z.string().optional().describe("Single assignee username or display name, e.g. alex"),
      assignees: z
        .array(z.string())
        .optional()
        .describe("Assign several people at once; takes precedence over assignee"),
      labels: z.array(z.string()).optional().describe("Label names to attach"),
    },
  },
  async ({ title, description, project, status, priority, assignee, assignees, labels }) =>
    guard(async () => {
      const workspaceId = await getWorkspaceId();
      const assigneeValues = assignees ?? (assignee ? [assignee] : []);
      const detail = await createIssue(
        workspaceId,
        {
          title,
          description,
          project: await resolveProject(workspaceId, project),
          status: parseStatus(status) ?? "todo",
          priority: parsePriority(priority) ?? 0,
          assigneeIds: await resolveAssigneeIds(workspaceId, assigneeValues),
          labelNames: labels,
        },
        AGENT
      );
      return { ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] };
    })
);

server.registerTool(
  "update_issue",
  {
    title: "Update issue",
    description: "Update an issue's title, description, status, priority, assignees, or labels (pass the full list of label names).",
    inputSchema: {
      id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.string().optional().describe(`Valid: ${STATUS_HELP}`),
      priority: z.union([z.string(), z.number()]).optional().describe(`Valid: ${PRIORITY_HELP}`),
      assignee: z.string().optional().describe("Single assignee username or display name; empty string to unassign"),
      assignees: z
        .array(z.string())
        .optional()
        .describe("Full replacement list of assignees; empty array to unassign"),
      labels: z.array(z.string()).optional().describe("Full replacement list of label names"),
    },
  },
  async ({ id, title, description, status, priority, assignee, assignees, labels }) =>
    guard(async () => {
      const workspaceId = await getWorkspaceId();
      let assigneeIds: string[] | undefined;
      if (assignees !== undefined) {
        assigneeIds = await resolveAssigneeIds(
          workspaceId,
          assignees.filter((value) => value.trim() !== "")
        );
      } else if (assignee !== undefined) {
        assigneeIds =
          assignee === "" ? [] : await resolveAssigneeIds(workspaceId, [assignee]);
      }
      const detail = await updateIssue(
        workspaceId,
        id,
        {
          title,
          description,
          status: parseStatus(status),
          priority: parsePriority(priority),
          assigneeIds,
          labelNames: labels,
        },
        AGENT
      );
      return { ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] };
    })
);

server.registerTool(
  "delete_issue",
  {
    title: "Delete issue",
    description: "Permanently delete an issue along with its comments and history.",
    inputSchema: {
      id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
    },
  },
  async ({ id }) =>
    guard(async () => ({
      deleted: (await deleteIssue(await getWorkspaceId(), id)).identifier,
    }))
);

server.registerTool(
  "add_comment",
  {
    title: "Add comment",
    description: "Post a comment on an issue, e.g. to report progress or results. Shows in the web UI timeline attributed to the MCP agent.",
    inputSchema: {
      id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
      body: z.string().describe("Comment text"),
    },
  },
  async ({ id, body }) =>
    guard(async () => {
      const detail = await addComment(await getWorkspaceId(), id, body, AGENT);
      return {
        comment: detail.comments[detail.comments.length - 1],
        issue: detail.issue,
      };
    })
);

server.registerTool(
  "list_labels",
  {
    title: "List labels",
    description: "List all issue labels in the workspace.",
    inputSchema: {},
  },
  async () => guard(async () => ({ labels: await listLabels(await getWorkspaceId()) }))
);

server.registerTool(
  "create_label",
  {
    title: "Create label",
    description: "Create a new label with a hex color like #5e6ad2 (picked automatically when omitted).",
    inputSchema: {
      name: z.string(),
      color: z.string().optional().describe("Hex color like #eb5757"),
    },
  },
  async ({ name, color }) =>
    guard(async () => createLabel(await getWorkspaceId(), { name, color }))
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "List all projects in the workspace with their keys (used as issue identifier prefixes).",
    inputSchema: {},
  },
  async () => guard(async () => ({ projects: await listProjects(await getWorkspaceId()) }))
);

server.registerTool(
  "list_members",
  {
    title: "List members",
    description: "List workspace members — useful for looking up usernames to assign issues.",
    inputSchema: {},
  },
  async () => guard(async () => ({ members: await listMembers(await getWorkspaceId()) }))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[tacos-mcp] stdio server ready (workspace key: ${WORKSPACE_KEY})`);
}

main().catch((err) => {
  console.error("[tacos-mcp] fatal:", err);
  process.exit(1);
});
