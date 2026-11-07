import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { version as packageVersion } from "../package.json";
import { z } from "zod";
import {
  addComment,
  addDependency,
  assertSeesIssue,
  assertSeesProject,
  claimIssue,
  countIssuesByStatus,
  createIssue,
  createLabel,
  createProject,
  deleteIssue,
  findIssueRow,
  findTrashedIssueRow,
  getIssueDetail,
  getProject,
  listIssuesPage,
  listLabels,
  listMembers,
  listProjectMembers,
  listProjects,
  normalizePriority,
  normalizeStatus,
  PRIORITY_NAMES,
  releaseIssue,
  removeDependency,
  reportBlocker,
  resolveAssigneeId,
  resolveAssigneeIds,
  restoreIssue,
  reviewIssue,
  updateIssue,
  updateProject,
  type Priority,
  type Project,
  type ReminderPreset,
  type Status,
} from "../src/lib/issues";
import { listIssueFieldValues, setTaskFieldValuesByName } from "../src/lib/task-fields";
import type { Recurrence } from "../src/lib/constants";
import { addPageComment, listPageComments } from "../src/lib/page-comments";
import {
  createPage,
  getPage,
  getPageUnfiltered,
  listAllPageSummaries,
  listPageSummaries,
  pageAuthor,
  updatePage,
  type DocPage,
} from "../src/lib/pages";
import { pageLimit, paginateList, paginateListDesc } from "../src/lib/pagination";

export type McpActor = { kind: "agent"; label: string; via: "api" | "mcp" };

export type CreateMcpServerOptions = {
  workspaceId: string;
  actor: McpActor;
  // A read-scoped API key (or TACOS_MCP_READ_ONLY=1) registers only read tools.
  readOnly: boolean;
  // null means every project in the workspace.
  allowedProjectIds: string[] | null;
  // The key creator; applies the workspace task-visibility rule. Null = trusted stdio.
  viewerId: string | null;
  // TACOS_MCP_TOOLS: when set, only these tool names register.
  toolFilter: string[] | null;
  // The person behind an API key. The local stdio server has no person, so tools
  // that must act as someone (claim, review, blockers, project ownership) refuse.
  userId: string | null;
};

export const MCP_READ_TOOL_NAMES = [
  "list_issues",
  "get_issue",
  "list_labels",
  "list_projects",
  "list_members",
  "get_project",
  "list_project_tasks",
  "list_pages",
  "get_page",
  "list_page_comments",
] as const;

export const MCP_WRITE_TOOL_NAMES = [
  "create_issue",
  "update_issue",
  "delete_issue",
  "add_comment",
  "create_label",
  "create_project",
  "update_project",
  "set_task_fields",
  "add_dependency",
  "remove_dependency",
  "claim_issue",
  "release_issue",
  "set_review_state",
  "report_blocker",
  "restore_issue",
  "create_page",
  "update_page",
  "add_page_comment",
] as const;

const STATUS_HELP =
  "todo, in_progress, done, canceled (aliases like 'in progress', 'completed', 'cancelled' also work)";
const PRIORITY_HELP = "none (0), low (1), medium (2), high (3), urgent (4)";

function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function guard(fn: () => Promise<ReturnType<typeof ok>>) {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
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
  if (priority === null) throw new Error(`Invalid priority "${value}". Valid priorities: ${PRIORITY_HELP}`);
  return priority;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const createAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const updateAnnotations = { ...createAnnotations, idempotentHint: true };
const deleteAnnotations = { ...createAnnotations, destructiveHint: true };

const itemSchema = z.record(z.string(), z.unknown());

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const { workspaceId, actor, readOnly, allowedProjectIds, toolFilter, viewerId, userId } = options;
  const server = new McpServer({ name: "tacos", version: packageVersion });

  function enabled(name: string): boolean {
    if (toolFilter !== null && !toolFilter.includes(name)) return false;
    if (readOnly && !(MCP_READ_TOOL_NAMES as readonly string[]).includes(name)) return false;
    return true;
  }

  function projectAllowedError(projectKey: string): Error {
    return new Error(
      `Project "${projectKey}" is outside this MCP server's project allowlist.`
    );
  }

  async function resolveProject(project?: string) {
    const projects = await listProjects(workspaceId, viewerId ?? undefined);
    const allowed =
      allowedProjectIds === null
        ? projects
        : projects.filter((entry) => allowedProjectIds.includes(entry.id));
    if (!project) {
      if (allowed.length === 0) {
        throw new Error("This workspace has no projects yet — create one in the web UI first.");
      }
      return allowed[0];
    }
    const found = await getProject(workspaceId, project, viewerId ?? undefined);
    if (!found) throw new Error(`Project "${project}" not found`);
    if (allowedProjectIds !== null && !allowedProjectIds.includes(found.id)) {
      throw projectAllowedError(found.key);
    }
    return found;
  }

  // A task route names the task, so the allowlist is checked before any write. A missing
  // task is left to the business call, which owns that error message.
  async function assertIssueAllowed(idOrIdentifier: string): Promise<void> {
    if (viewerId) await assertSeesIssue(workspaceId, idOrIdentifier, viewerId);
    if (allowedProjectIds === null) return;
    const row = await findIssueRow(workspaceId, idOrIdentifier);
    if (!row) return;
    if (!allowedProjectIds.includes(row.projectId)) {
      const project = await getProject(workspaceId, row.projectId, viewerId ?? undefined);
      throw projectAllowedError(project?.key ?? row.projectId);
    }
  }

  // Some actions belong to a person (a claim, a review, a blocker, a project lead).
  // The HTTP endpoint knows the key's person; the stdio server does not.
  function requirePerson(tool: string): string {
    if (userId) return userId;
    throw new Error(
      `${tool} needs a signed-in person. Use /api/mcp with an API key that belongs to a workspace member, or the web UI.`
    );
  }

  // A scoped server can work inside its allowlist; a new project would be outside it.
  function assertCanCreateProject(): void {
    if (allowedProjectIds === null) return;
    throw new Error(
      "This MCP server is limited to a project allowlist and cannot create projects. Use a server with all projects, or create the project in the web UI."
    );
  }

  function stripDoc(project: Project & { doc?: string }): Project {
    const { doc, ...meta } = project;
    void doc;
    return meta;
  }

  async function projectPayload(project: Project) {
    const [members, taskCounts] = await Promise.all([
      listProjectMembers(workspaceId, project.id),
      countIssuesByStatus(workspaceId, project.id),
    ]);
    return { ...project, members, memberCount: members.length, taskCounts };
  }

  // A page in a project follows the server's allowlist; a workspace page (no project)
  // belongs to no restricted project.
  async function assertPageAllowed(page: Pick<DocPage, "projectId">): Promise<void> {
    if (allowedProjectIds === null || !page.projectId) return;
    if (allowedProjectIds.includes(page.projectId)) return;
    const project = await getProject(workspaceId, page.projectId, viewerId ?? undefined);
    throw projectAllowedError(project?.key ?? page.projectId);
  }

  // The HTTP server reads pages as the key's person; stdio has no person and, like its
  // issue tools, reads every page in the workspace.
  async function readablePage(id: string): Promise<DocPage> {
    const page = viewerId
      ? await getPage(workspaceId, id, viewerId)
      : await getPageUnfiltered(workspaceId, id);
    if (!page) throw new Error(`Page "${id}" not found`);
    await assertPageAllowed(page);
    return page;
  }

  async function visiblePageSummaries(filter: { parentId?: string; projectId?: string; q?: string }) {
    const pages = viewerId
      ? await listPageSummaries(workspaceId, viewerId, filter)
      : await listAllPageSummaries(workspaceId, filter);
    return allowedProjectIds === null
      ? pages
      : pages.filter(
          (page) => page.projectId === null || allowedProjectIds.includes(page.projectId)
        );
  }

  async function pagePayload(page: DocPage) {
    return { ...page, author: await pageAuthor(page.createdBy) };
  }

  if (enabled("list_issues")) {
    server.registerTool(
      "list_issues",
      {
        title: "List issues",
        description:
          "List issues, newest activity first, grouped by status. Filter by status, priority, project, assignee, text query, or label. Pass the previous nextCursor to read the next page.",
        inputSchema: {
          status: z.string().optional().describe(`Filter by status: ${STATUS_HELP}, or "active" (todo + in_progress), or "all"`),
          priority: z.union([z.string(), z.number()]).optional().describe(`Filter by priority: ${PRIORITY_HELP}`),
          project: z.string().optional().describe("Project key, e.g. CORE"),
          assignee: z.string().optional().describe('Filter by assignee: username, "me" is not supported (agents have no account), or "none" for unassigned'),
          q: z.string().optional().describe("Free-text search across title, description, and identifier"),
          label: z.string().optional().describe("Filter by label name"),
          limit: z.number().optional().describe("Max results (default 100, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          count: z.number(),
          total: z.number(),
          issues: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ status, priority, project, assignee, q, label, limit, cursor }) =>
        guard(async () => {
          const resolved = project ? await resolveProject(project) : undefined;
          let assigneeId: string | null | undefined;
          if (assignee === "none") {
            assigneeId = null;
          } else if (assignee) {
            assigneeId = await resolveAssigneeId(workspaceId, assignee);
          }
          const page = await listIssuesPage(workspaceId, {
            status: status === "active" || status === "all" ? status : parseStatus(status),
            priority: parsePriority(priority),
            q,
            label,
            projectId: resolved?.id,
            projectIds: allowedProjectIds ?? undefined,
            viewerId: viewerId ?? undefined,
            assigneeId,
            limit: limit !== undefined ? pageLimit(limit, 100) : undefined,
            cursor,
          });
          return ok({
            count: page.items.length,
            total: page.total,
            issues: page.items.map((issue) => ({
              ...issue,
              priorityLabel: PRIORITY_NAMES[issue.priority],
            })),
            nextCursor: page.nextCursor,
          });
        })
    );
  }

  if (enabled("get_issue")) {
    server.registerTool(
      "get_issue",
      {
        title: "Get issue",
        description: "Get one issue with its labels, assignee, comments, and full activity timeline.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
        },
        outputSchema: z.looseObject({
          id: z.string(),
          identifier: z.string(),
          title: z.string(),
          status: z.string(),
          priority: z.number(),
          projectId: z.string(),
          comments: z.array(itemSchema),
          events: z.array(itemSchema),
          fields: z.record(z.string(), z.string()),
        }),
        annotations: readAnnotations,
      },
      async ({ id }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          const detail = await getIssueDetail(workspaceId, id, viewerId ?? undefined);
          if (!detail) throw new Error(`Issue "${id}" not found`);
          return ok({
            ...detail.issue,
            priorityLabel: PRIORITY_NAMES[detail.issue.priority],
            comments: detail.comments,
            events: detail.events,
            fields: await listIssueFieldValues(workspaceId, detail.issue.id),
          });
        })
    );
  }

  if (enabled("create_issue")) {
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
          dueDate: z.string().optional().describe("Due date as YYYY-MM-DD"),
          reminder: z
            .enum(["12h", "1d", "3d", "5d", "7d"])
            .optional()
            .describe("How long before the due date to remind"),
          recurrence: z
            .enum(["daily", "weekly", "monthly"])
            .optional()
            .describe("Open the next occurrence when this task is marked done"),
          parent: z
            .string()
            .optional()
            .describe("Identifier of the parent task. The subtask stays in that task's project."),
        },
        annotations: createAnnotations,
      },
      async ({ title, description, project, status, priority, assignee, assignees, labels, dueDate, reminder, recurrence, parent }) =>
        guard(async () => {
          const resolved = await resolveProject(project);
          const assigneeValues = assignees ?? (assignee ? [assignee] : []);
          const detail = await createIssue(
            workspaceId,
            {
              title,
              description,
              project: resolved.key,
              status: parseStatus(status) ?? "todo",
              priority: parsePriority(priority) ?? 0,
              assigneeIds: await resolveAssigneeIds(workspaceId, assigneeValues),
              labelNames: labels,
              dueDate,
              reminder,
              recurrence: recurrence ?? null,
              parent,
            },
            actor
          );
          return ok({ ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] });
        })
    );
  }

  if (enabled("update_issue")) {
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
          dueDate: z
            .string()
            .optional()
            .describe("Due date as YYYY-MM-DD; empty string clears it"),
          reminder: z
            .string()
            .optional()
            .describe("How long before the due date to remind: 12h, 1d, 3d, 5d, 7d; empty string clears it"),
          recurrence: z
            .string()
            .optional()
            .describe("daily, weekly or monthly; empty string clears it"),
          parent: z
            .string()
            .optional()
            .describe("Identifier of the parent task. Empty string detaches this task."),
        },
        annotations: updateAnnotations,
      },
      async ({ id, title, description, status, priority, assignee, assignees, labels, dueDate, reminder, recurrence, parent }) =>
        guard(async () => {
          await assertIssueAllowed(id);
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
              dueDate:
                dueDate === undefined ? undefined : dueDate === "" ? null : dueDate,
              reminder:
                reminder === undefined
                  ? undefined
                  : reminder === ""
                    ? null
                    : (reminder as ReminderPreset),
              recurrence:
                recurrence === undefined
                  ? undefined
                  : recurrence === ""
                    ? null
                    : (recurrence as Recurrence),
              parent,
            },
            actor
          );
          return ok({ ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] });
        })
    );
  }

  if (enabled("delete_issue")) {
    server.registerTool(
      "delete_issue",
      {
        title: "Delete issue",
        description: "Permanently delete an issue along with its comments and history.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
        },
        annotations: deleteAnnotations,
      },
      async ({ id }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          return ok({ deleted: (await deleteIssue(workspaceId, id, actor)).identifier });
        })
    );
  }

  if (enabled("add_comment")) {
    server.registerTool(
      "add_comment",
      {
        title: "Add comment",
        description: "Post a comment on an issue, e.g. to report progress or results. Shows in the web UI timeline attributed to the MCP agent.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          body: z.string().describe("Comment text"),
        },
        annotations: createAnnotations,
      },
      async ({ id, body }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          const detail = await addComment(workspaceId, id, body, actor);
          return ok({
            comment: detail.comments[detail.comments.length - 1],
            issue: detail.issue,
          });
        })
    );
  }

  if (enabled("list_labels")) {
    server.registerTool(
      "list_labels",
      {
        title: "List labels",
        description: "List issue labels in the workspace, one page at a time.",
        inputSchema: {
          limit: z.number().optional().describe("Max results (default 50, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          labels: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ limit, cursor }) =>
        guard(async () => {
          const labels = await listLabels(workspaceId);
          const { page, nextCursor } = paginateList(
            labels,
            pageLimit(limit),
            cursor,
            (label) => ({ k: label.name, id: label.id }),
            (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)
          );
          return ok({ labels: page, nextCursor });
        })
    );
  }

  if (enabled("create_label")) {
    server.registerTool(
      "create_label",
      {
        title: "Create label",
        description: "Create a new label with a hex color like #5e6ad2 (picked automatically when omitted).",
        inputSchema: {
          name: z.string(),
          color: z.string().optional().describe("Hex color like #eb5757"),
        },
        annotations: createAnnotations,
      },
      async ({ name, color }) =>
        guard(async () => ok({ ...(await createLabel(workspaceId, { name, color })) }))
    );
  }

  if (enabled("list_projects")) {
    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description: "List projects in the workspace with their keys (used as issue identifier prefixes), one page at a time.",
        inputSchema: {
          limit: z.number().optional().describe("Max results (default 50, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          projects: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ limit, cursor }) =>
        guard(async () => {
          const projects = await listProjects(workspaceId, viewerId ?? undefined);
          const allowed =
            allowedProjectIds === null
              ? projects
              : projects.filter((project) => allowedProjectIds.includes(project.id));
          const { page, nextCursor } = paginateList(
            allowed,
            pageLimit(limit),
            cursor,
            (project) => ({ k: project.key, id: project.id }),
            (a, b) => compareText(a.key, b.key) || compareText(a.id, b.id)
          );
          return ok({ projects: page, nextCursor });
        })
    );
  }

  if (enabled("list_members")) {
    server.registerTool(
      "list_members",
      {
        title: "List members",
        description: "List workspace members — useful for looking up usernames to assign issues, one page at a time.",
        inputSchema: {
          limit: z.number().optional().describe("Max results (default 50, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          members: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ limit, cursor }) =>
        guard(async () => {
          const members = await listMembers(workspaceId);
          const { page, nextCursor } = paginateList(
            members,
            pageLimit(limit),
            cursor,
            (member) => ({ k: member.username, id: member.id }),
            (a, b) => compareText(a.username, b.username) || compareText(a.id, b.id)
          );
          return ok({ members: page, nextCursor });
        })
    );
  }

  if (enabled("get_project")) {
    server.registerTool(
      "get_project",
      {
        title: "Get project",
        description:
          "Get one project with its members and task counts. Defaults to the first project this server may use.",
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe("Project key (e.g. CORE) or id; defaults to the first available project"),
        },
        outputSchema: z.looseObject({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          description: z.string(),
          members: z.array(itemSchema),
          memberCount: z.number(),
          taskCounts: itemSchema,
        }),
        annotations: readAnnotations,
      },
      async ({ project }) =>
        guard(async () => {
          const resolved = await resolveProject(project);
          return ok(await projectPayload(stripDoc(resolved)));
        })
    );
  }

  if (enabled("list_project_tasks")) {
    server.registerTool(
      "list_project_tasks",
      {
        title: "List project tasks",
        description:
          "List one project's tasks with the same filters as list_issues. Pass the previous nextCursor to read the next page.",
        inputSchema: {
          project: z
            .string()
            .optional()
            .describe("Project key (e.g. CORE) or id; defaults to the first available project"),
          status: z
            .string()
            .optional()
            .describe(`Filter by status: ${STATUS_HELP}, or "active" (todo + in_progress), or "all"`),
          priority: z.union([z.string(), z.number()]).optional().describe(`Filter by priority: ${PRIORITY_HELP}`),
          assignee: z.string().optional().describe('Assignee username, or "none" for unassigned'),
          q: z.string().optional().describe("Free-text search across title, description, and identifier"),
          label: z.string().optional().describe("Filter by label name"),
          limit: z.number().optional().describe("Max results (default 100, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          project: z.string(),
          count: z.number(),
          total: z.number(),
          issues: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ project, status, priority, assignee, q, label, limit, cursor }) =>
        guard(async () => {
          const resolved = await resolveProject(project);
          let assigneeId: string | null | undefined;
          if (assignee === "none") {
            assigneeId = null;
          } else if (assignee) {
            assigneeId = await resolveAssigneeId(workspaceId, assignee);
          }
          const page = await listIssuesPage(workspaceId, {
            status: status === "active" || status === "all" ? status : parseStatus(status),
            priority: parsePriority(priority),
            q,
            label,
            projectId: resolved.id,
            projectIds: allowedProjectIds ?? undefined,
            viewerId: viewerId ?? undefined,
            assigneeId,
            limit: limit !== undefined ? pageLimit(limit, 100) : undefined,
            cursor,
          });
          return ok({
            project: resolved.key,
            count: page.items.length,
            total: page.total,
            issues: page.items.map((issue) => ({
              ...issue,
              priorityLabel: PRIORITY_NAMES[issue.priority],
            })),
            nextCursor: page.nextCursor,
          });
        })
    );
  }

  if (enabled("create_project")) {
    server.registerTool(
      "create_project",
      {
        title: "Create project",
        description:
          "Create a project; its key becomes the prefix for task identifiers. Needs an all-projects server.",
        inputSchema: {
          name: z.string().describe("Short project name, e.g. Mobile app"),
          description: z.string().optional().describe("One-line summary shown under the title"),
        },
        annotations: createAnnotations,
      },
      async ({ name, description }) =>
        guard(async () => {
          assertCanCreateProject();
          const project = await createProject({
            workspaceId,
            name,
            description,
            createdBy: userId,
          });
          return ok({ ...project });
        })
    );
  }

  if (enabled("update_project")) {
    server.registerTool(
      "update_project",
      {
        title: "Update project",
        description: "Rename a project or change its description, color or icon.",
        inputSchema: {
          project: z.string().describe("Project key (e.g. CORE) or id"),
          name: z.string().optional().describe("New project name"),
          description: z.string().optional().describe("One-line summary"),
          color: z.string().optional().describe("Palette color, e.g. #8b5cf6"),
          icon: z.string().nullable().optional().describe("A single emoji, or null to clear it"),
        },
        annotations: updateAnnotations,
      },
      async ({ project, name, description, color, icon }) =>
        guard(async () => {
          const resolved = await resolveProject(project);
          if (name === undefined && description === undefined && color === undefined && icon === undefined) {
            throw new Error("Send at least one of name, description, color or icon.");
          }
          const updated = await updateProject(
            workspaceId,
            resolved.id,
            { name, description, color, icon },
            userId ?? undefined
          );
          return ok({ ...updated });
        })
    );
  }

  if (enabled("set_task_fields")) {
    server.registerTool(
      "set_task_fields",
      {
        title: "Set task fields",
        description:
          "Set custom task field values from a name/id-keyed object. Values are raw strings (checkbox \"1\"); null clears one.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          fields: z
            .record(z.string(), z.union([z.string(), z.null()]))
            .describe('Field name or id → value, e.g. {"Stage": "beta"}; null clears'),
        },
        annotations: updateAnnotations,
      },
      async ({ id, fields }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          const row = await findIssueRow(workspaceId, id);
          if (!row) throw new Error(`Issue "${id}" not found`);
          const values = await setTaskFieldValuesByName(
            workspaceId,
            row.id,
            fields,
            userId ?? undefined,
            actor
          );
          return ok({ id: row.id, identifier: row.identifier, fields: values });
        })
    );
  }

  if (enabled("add_dependency")) {
    server.registerTool(
      "add_dependency",
      {
        title: "Add dependency",
        description:
          "Make a task wait for another task. Refuses a self-link or a loop.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          blockedBy: z.string().describe("The task that must finish first, e.g. CORE-3"),
        },
        annotations: updateAnnotations,
      },
      async ({ id, blockedBy }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          await assertIssueAllowed(blockedBy);
          const detail = await addDependency(workspaceId, id, blockedBy, userId ?? undefined, actor);
          return ok({
            id: detail.issue.id,
            identifier: detail.issue.identifier,
            dependencies: detail.dependencies,
            blocked: detail.blocked,
          });
        })
    );
  }

  if (enabled("remove_dependency")) {
    server.registerTool(
      "remove_dependency",
      {
        title: "Remove dependency",
        description: "Remove a task that this task was waiting for.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          blockedBy: z.string().describe("The task to stop waiting for, e.g. CORE-3"),
        },
        annotations: updateAnnotations,
      },
      async ({ id, blockedBy }) =>
        guard(async () => {
          await assertIssueAllowed(id);
          await assertIssueAllowed(blockedBy);
          const detail = await removeDependency(workspaceId, id, blockedBy, userId ?? undefined, actor);
          return ok({
            id: detail.issue.id,
            identifier: detail.issue.identifier,
            dependencies: detail.dependencies,
            blocked: detail.blocked,
          });
        })
    );
  }

  if (enabled("claim_issue")) {
    server.registerTool(
      "claim_issue",
      {
        title: "Claim issue",
        description:
          "Claim an approved, open task for the person behind the API key. A task waiting for review or already claimed is refused.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
        },
        annotations: createAnnotations,
      },
      async ({ id }) =>
        guard(async () => {
          const person = requirePerson("claim_issue");
          await assertIssueAllowed(id);
          return ok(await claimIssue(workspaceId, id, person, actor));
        })
    );
  }

  if (enabled("release_issue")) {
    server.registerTool(
      "release_issue",
      {
        title: "Release issue",
        description: "Release a claim held by the person behind the API key.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
        },
        annotations: createAnnotations,
      },
      async ({ id }) =>
        guard(async () => {
          const person = requirePerson("release_issue");
          await assertIssueAllowed(id);
          return ok(await releaseIssue(workspaceId, id, person, actor));
        })
    );
  }

  if (enabled("set_review_state")) {
    server.registerTool(
      "set_review_state",
      {
        title: "Set review state",
        description:
          "Approve or reject a task that waits for review, as the person behind the API key. Other tasks are refused.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          state: z.enum(["approved", "rejected"]).describe("Approve or reject the task"),
        },
        annotations: createAnnotations,
      },
      async ({ id, state }) =>
        guard(async () => {
          const person = requirePerson("set_review_state");
          await assertIssueAllowed(id);
          return ok(
            await reviewIssue(
              workspaceId,
              id,
              person,
              state === "approved" ? "approve" : "reject",
              actor
            )
          );
        })
    );
  }

  if (enabled("report_blocker")) {
    server.registerTool(
      "report_blocker",
      {
        title: "Report blocker",
        description:
          "Report that a task is stuck. The assignees are notified; the report is attributed to the API key.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
          body: z.string().describe("What is blocking this task"),
        },
        annotations: createAnnotations,
      },
      async ({ id, body }) =>
        guard(async () => {
          const person = requirePerson("report_blocker");
          await assertIssueAllowed(id);
          return ok(await reportBlocker(workspaceId, id, body, actor, { reportedById: person }));
        })
    );
  }

  if (enabled("restore_issue")) {
    server.registerTool(
      "restore_issue",
      {
        title: "Restore issue",
        description: "Restore a task from the Trash.",
        inputSchema: {
          id: z.string().describe("Issue id or identifier, e.g. CORE-7"),
        },
        annotations: createAnnotations,
      },
      async ({ id }) =>
        guard(async () => {
          const row = await findTrashedIssueRow(workspaceId, id);
          if (!row) throw new Error(`Issue "${id}" is not in the trash`);
          if (viewerId) await assertSeesIssue(workspaceId, row.id, viewerId);
          if (allowedProjectIds !== null && !allowedProjectIds.includes(row.projectId)) {
            const project = await getProject(workspaceId, row.projectId);
            throw projectAllowedError(project?.key ?? row.projectId);
          }
          return ok({ restored: await restoreIssue(workspaceId, row.id, actor) });
        })
    );
  }

  if (enabled("list_pages")) {
    server.registerTool(
      "list_pages",
      {
        title: "List pages",
        description:
          "List workspace documents (markdown pages), newest edit first, without their bodies. Filter by project, parent page or title text. Pass the previous nextCursor to read the next page.",
        inputSchema: {
          project: z.string().optional().describe("Project key (e.g. CORE) or id"),
          parent: z.string().optional().describe("Parent page id; lists its direct children"),
          q: z.string().optional().describe("Filter by text in the page title"),
          limit: z.number().optional().describe("Max results (default 50, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          count: z.number(),
          total: z.number(),
          pages: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ project, parent, q, limit, cursor }) =>
        guard(async () => {
          const resolved = project ? await resolveProject(project) : undefined;
          const pages = await visiblePageSummaries({
            projectId: resolved?.id,
            parentId: parent,
            q,
          });
          const { page, nextCursor } = paginateListDesc(
            pages,
            pageLimit(limit),
            cursor,
            (item) => ({ k: item.updatedAt, id: item.id }),
            (a, b) => compareText(b.updatedAt, a.updatedAt) || compareText(a.id, b.id)
          );
          return ok({ count: page.length, total: pages.length, pages: page, nextCursor });
        })
    );
  }

  if (enabled("get_page")) {
    server.registerTool(
      "get_page",
      {
        title: "Get page",
        description: "Get one document's markdown body and metadata by page id.",
        inputSchema: {
          id: z.string().describe("Page id"),
        },
        outputSchema: z.looseObject({
          id: z.string(),
          title: z.string(),
          doc: z.string(),
          parentId: z.string().nullable(),
          projectId: z.string().nullable(),
          shared: z.boolean(),
          revision: z.number(),
          createdAt: z.string(),
          updatedAt: z.string(),
          author: itemSchema.nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ id }) =>
        guard(async () => ok(await pagePayload(await readablePage(id))))
    );
  }

  if (enabled("list_page_comments")) {
    server.registerTool(
      "list_page_comments",
      {
        title: "List page comments",
        description: "List a document's comments, oldest first, one page at a time.",
        inputSchema: {
          id: z.string().describe("Page id"),
          limit: z.number().optional().describe("Max results (default 50, max 200)"),
          cursor: z.string().optional().describe("Opaque cursor from the previous call's nextCursor"),
        },
        outputSchema: z.looseObject({
          comments: z.array(itemSchema),
          nextCursor: z.string().nullable(),
        }),
        annotations: readAnnotations,
      },
      async ({ id, limit, cursor }) =>
        guard(async () => {
          const page = await readablePage(id);
          // A trusted stdio server has no person; the page author can always read it.
          const comments = await listPageComments(
            workspaceId,
            page.id,
            viewerId ?? page.createdBy
          );
          const result = paginateList(
            comments,
            pageLimit(limit),
            cursor,
            (comment) => ({ k: comment.createdAt, id: comment.id }),
            (a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id)
          );
          return ok({ comments: result.page, nextCursor: result.nextCursor });
        })
    );
  }

  if (enabled("create_page")) {
    server.registerTool(
      "create_page",
      {
        title: "Create page",
        description:
          "Create a private markdown document owned by the key's person, optionally inside a project or under a parent page. Sharing stays in the web UI.",
        inputSchema: {
          title: z.string().describe("Page title, e.g. Meeting notes"),
          doc: z.string().optional().describe("Markdown body"),
          project: z.string().optional().describe("Project key (e.g. CORE) or id"),
          parent: z.string().optional().describe("Parent page id; the page inherits its project"),
        },
        annotations: createAnnotations,
      },
      async ({ title, doc, project, parent }) =>
        guard(async () => {
          const person = requirePerson("create_page");
          const parentPage = parent ? await readablePage(parent) : undefined;
          const resolved = project ? await resolveProject(project) : undefined;
          const page = await createPage(
            workspaceId,
            person,
            {
              title,
              doc,
              projectId: resolved?.id ?? null,
              parentId: parentPage?.id ?? null,
            },
            { via: "mcp" }
          );
          return ok(await pagePayload(page));
        })
    );
  }

  if (enabled("update_page")) {
    server.registerTool(
      "update_page",
      {
        title: "Update page",
        description:
          "Change a document's title, markdown body or icon. Pass baseRevision from get_page to refuse a save someone else already replaced.",
        inputSchema: {
          id: z.string().describe("Page id"),
          title: z.string().optional(),
          doc: z.string().optional().describe("Full replacement markdown body"),
          icon: z.string().nullable().optional().describe("A single emoji, or null to clear it"),
          baseRevision: z
            .number()
            .optional()
            .describe("The revision this body edit started from; a stale value is refused"),
        },
        annotations: updateAnnotations,
      },
      async ({ id, title, doc, icon, baseRevision }) =>
        guard(async () => {
          const person = requirePerson("update_page");
          if (title === undefined && doc === undefined && icon === undefined) {
            throw new Error("Send at least one of title, doc or icon.");
          }
          const page = await readablePage(id);
          const updated = await updatePage(
            workspaceId,
            page.id,
            person,
            { title, doc, icon, baseRevision },
            { via: "mcp" }
          );
          return ok(await pagePayload(updated));
        })
    );
  }

  if (enabled("add_page_comment")) {
    server.registerTool(
      "add_page_comment",
      {
        title: "Add page comment",
        description:
          "Post a comment on a document, optionally replying to another comment. The page author and mentioned members are notified.",
        inputSchema: {
          id: z.string().describe("Page id"),
          body: z.string().describe("Comment text"),
          parentId: z.string().optional().describe("Comment id being replied to"),
        },
        annotations: createAnnotations,
      },
      async ({ id, body, parentId }) =>
        guard(async () => {
          const person = requirePerson("add_page_comment");
          const page = await readablePage(id);
          const [comment] = await addPageComment(
            workspaceId,
            page.id,
            person,
            { body, parentId: parentId ?? null },
            { via: "mcp", incremental: true }
          );
          return ok({ pageId: page.id, comment });
        })
    );
  }

  return server;
}
