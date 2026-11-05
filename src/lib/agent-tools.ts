import {
  addComment,
  claimIssue,
  createIssue,
  deleteIssue,
  getIssueDetail,
  getProject,
  listIssues,
  listProjects,
  normalizePriority,
  normalizeStatus,
  resolveAssigneeIds,
  TacosError,
  updateIssue,
  updateProject,
  type Priority,
  type Status,
} from "./issues";
import { listUserWorkspaces, type UserWorkspace } from "./auth";
import { applyDocEdits } from "./doc-edits";
import { searchWorkspace } from "./search";
import { listFieldValues, listTaskFields } from "./task-fields";
import { createPage, getPage, listPages, undoAgentEdit, updatePage } from "./pages";
import { PRIORITY_NAMES, STATUS_META } from "./constants";

// Tools the Agent can call through the TaCos MCP bridge. Delete tools always wait for
// a card, even when approval is Full (H-P3-19). Each call is scoped to the project the
// conversation is bound to.

export type AgentToolContext = {
  workspaceId: string;
  projectId: string;
  projectKey: string;
  userId: string;
  // conversation that runs the tool; stored as the source chat of new tasks
  threadId?: string;
};

export type AgentToolSpec = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  // Reads are cheap and harmless; writes show up in TaCos and need the permission card.
  write: boolean;
  // Delete tools always wait for a card, even when approval is Full (H-P3-19).
  delete?: boolean;
};

const PRIORITY_LIST = Object.values(PRIORITY_NAMES).join(", ");
const STATUS_HELP = (Object.keys(STATUS_META) as Status[])
  .map((status) => `${STATUS_META[status].label} (${status})`)
  .join(", ");

const READ_WORKSPACE = {
  type: "string",
  description: "Key or name of another workspace you joined. Leave it out for this conversation's workspace.",
};
const READ_PROJECT = { type: "string", description: "Key or name of a project in that workspace" };

const TOOLS: AgentToolSpec[] = [
  {
    name: "list_workspaces",
    description: "List the workspaces this person has joined. Only these can be read or written.",
    write: false,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_projects",
    description: "List the projects of a workspace that this person can see.",
    write: false,
    inputSchema: { type: "object", properties: { workspace: READ_WORKSPACE } },
  },
  {
    name: "search_workspace",
    description:
      "Search documents, tasks and comments this person can see, in this workspace, another joined workspace, or all of them.",
    write: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to find" },
        workspace: {
          type: "string",
          description: 'Key or name of a joined workspace, or "all". Leave it out for this conversation\'s workspace.',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tasks",
    description: `List tasks in this project, or in a project or workspace you name. Statuses: ${STATUS_HELP}.`,
    write: false,
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: 'todo, in_progress, done, canceled, "active", "open" (approved and unclaimed) or "all"',
        },
        q: { type: "string", description: "Free-text search across title, description and identifier" },
        limit: { type: "number", description: "Max results (default 30, max 100)" },
        workspace: READ_WORKSPACE,
        project: READ_PROJECT,
      },
    },
  },
  {
    name: "get_task",
    description: "Read one task by identifier (e.g. TEST-12) or id, including its comments and custom fields.",
    write: false,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task identifier or id" }, workspace: READ_WORKSPACE },
      required: ["id"],
    },
  },
  {
    name: "get_overview",
    description: "Read a project's Overview document (markdown) and its description. Defaults to this project.",
    write: false,
    inputSchema: { type: "object", properties: { workspace: READ_WORKSPACE, project: READ_PROJECT } },
  },
  {
    name: "create_task",
    description: "Create a task in this project.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short, imperative title" },
        description: { type: "string", description: "Markdown body; context, acceptance criteria or steps" },
        status: { type: "string", description: STATUS_HELP },
        priority: { type: "string", description: PRIORITY_LIST },
        dueDate: { type: "string", description: "YYYY-MM-DD" },
        assignees: {
          type: "array",
          items: { type: "string" },
          description: "Usernames of workspace members to assign",
        },
        labels: { type: "array", items: { type: "string" }, description: "Label names; new ones are created" },
        parent: {
          type: "string",
          description: "Identifier of the parent task. The subtask stays in that task's project.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_tasks",
    description:
      "Create several tasks in one call. Prefer this over repeating create_task when the person lists multiple items.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Tasks to create, in order (max 20)",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short, imperative title" },
              description: { type: "string", description: "Markdown body; context, acceptance criteria or steps" },
              status: { type: "string", description: STATUS_HELP },
              priority: { type: "string", description: PRIORITY_LIST },
              dueDate: { type: "string", description: "YYYY-MM-DD" },
              assignees: {
                type: "array",
                items: { type: "string" },
                description: "Usernames of workspace members to assign",
              },
              labels: {
                type: "array",
                items: { type: "string" },
                description: "Label names; new ones are created",
              },
              parent: {
                type: "string",
                description: "Identifier of the parent task. The subtask stays in that task's project.",
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_task",
    description: "Change a task in this project: title, description, status, priority, due date.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task identifier or id" },
        title: { type: "string" },
        description: { type: "string", description: "Full replacement markdown" },
        status: { type: "string", description: STATUS_HELP },
        priority: { type: "string", description: PRIORITY_LIST },
        dueDate: { type: "string", description: "YYYY-MM-DD, empty string clears it" },
        parent: {
          type: "string",
          description: "Identifier of the parent task. Empty string detaches this task.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "update_tasks",
    description:
      "Change several tasks in one call. Prefer this over repeating update_task when several tasks need edits.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          description: "Patches to apply, in order (max 20)",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Task identifier or id" },
              title: { type: "string" },
              description: { type: "string", description: "Full replacement markdown" },
              status: { type: "string", description: STATUS_HELP },
              priority: { type: "string", description: PRIORITY_LIST },
              dueDate: { type: "string", description: "YYYY-MM-DD, empty string clears it" },
              parent: {
                type: "string",
                description: "Identifier of the parent task. Empty string detaches this task.",
              },
            },
            required: ["id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "add_comment",
    description: "Comment on a task in this project.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task identifier or id" },
        body: { type: "string", description: "Markdown comment" },
      },
      required: ["id", "body"],
    },
  },
  {
    name: "claim_task",
    description:
      "Claim an approved, open task for the current user so they push it forward. A task that waits for review cannot be claimed.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task identifier or id" } },
      required: ["id"],
    },
  },
  {
    name: "update_overview",
    description:
      "Replace this project's Overview document with the full markdown you pass. Read it with get_overview first.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { markdown: { type: "string", description: "The complete new document" } },
      required: ["markdown"],
    },
  },
  {
    name: "get_doc",
    description:
      "Read a document from the workspace's Documents library, in full. Pass the id, or an exact title to look it up. Long documents come back whole because the Agent, not the inline editor, is the way to rewrite them.",
    write: false,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id from an earlier result" },
        title: { type: "string", description: "Exact document title, when the id is unknown" },
        workspace: READ_WORKSPACE,
      },
    },
  },
  {
    name: "create_doc",
    description: "Create a standalone document in this project's Documents list.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title" },
        markdown: { type: "string", description: "Document body" },
      },
      required: ["title"],
    },
  },
  {
    name: "edit_doc",
    description:
      "Change passages of a document and leave the rest exactly as it is. Prefer this to update_doc. Read it with get_doc first. Each find must match exactly one place in the current markdown; if any edit fails, nothing changes. An empty replace deletes the passage.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id from get_doc" },
        edits: {
          type: "array",
          description: "Applied in order",
          items: {
            type: "object",
            properties: {
              find: { type: "string", description: "Exact text to replace, long enough to match one place" },
              replace: { type: "string", description: "Text to put there" },
            },
            required: ["find", "replace"],
          },
        },
      },
      required: ["id", "edits"],
    },
  },
  {
    name: "undo_doc_edit",
    description:
      "Take back your latest change to a document, when nobody has changed the document since. Everything is kept in its version history.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_doc",
    description:
      "Replace a document's complete markdown, for rewriting most of it; use edit_doc for smaller changes. Read it with get_doc first and send the whole new body; this overwrites what is there.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document id from get_doc" },
        markdown: { type: "string", description: "The complete new document" },
      },
      required: ["id", "markdown"],
    },
  },
  {
    name: "delete_task",
    description:
      "Move a task to Trash. Always asks for a confirmation card, even when approval is Full.",
    write: true,
    delete: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task id or identifier (for example PROJ-12)" },
      },
      required: ["id"],
    },
  },
];

// Documents are found by id, so editing one needs no project.
const WORKSPACE_ONLY_WRITES = new Set(["edit_doc", "undo_doc_edit", "update_doc"]);

// A write always says where it goes, so nothing lands in a workspace by assumption, and the
// approval card shows the target.
function withWriteTarget(tool: AgentToolSpec): AgentToolSpec {
  if (!tool.write) return tool;
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        workspace: { type: "string", description: "Key or name of the workspace this write goes to. Required." },
        ...(WORKSPACE_ONLY_WRITES.has(tool.name)
          ? {}
          : {
              project: {
                type: "string",
                description: "Key or name of the project. Required when the workspace is not this conversation's.",
              },
            }),
      },
      required: [...(tool.inputSchema.required ?? []), "workspace"],
    },
  };
}

export const AGENT_TOOLS: AgentToolSpec[] = TOOLS.map(withWriteTarget);

const READ_TOOLS = new Set(AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name));
const DELETE_TOOLS = new Set(AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name));

export function isDeleteTool(name: string): boolean {
  return DELETE_TOOLS.has(name);
}


function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStatus(value: unknown): Status | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "active" || value === "all") return undefined;
  const status = normalizeStatus(value);
  if (!status) throw new TacosError(`Unknown status "${String(value)}". Use ${STATUS_HELP}.`);
  return status;
}

function asPriority(value: unknown): Priority | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const priority = normalizePriority(value as string | number);
  if (priority === null) {
    throw new TacosError(`Unknown priority "${String(value)}". Use ${PRIORITY_LIST}.`);
  }
  return priority;
}

// Every write names the task by identifier; a task outside the bound project is refused
// so a conversation about one project cannot reach into another.
async function requireProjectTask(ctx: AgentToolContext, idOrIdentifier: string) {
  const detail = await getIssueDetail(ctx.workspaceId, idOrIdentifier, ctx.userId);
  if (!detail) throw new TacosError(`Task "${idOrIdentifier}" not found`, 404);
  if (detail.issue.projectId !== ctx.projectId) {
    throw new TacosError(
      `Task ${detail.issue.identifier} belongs to another project; this conversation is bound to ${ctx.projectKey}.`,
      403
    );
  }
  return detail;
}

function taskSummary(issue: {
  identifier: string;
  title: string;
  status: string;
  priority: number;
  description?: string;
}) {
  return {
    identifier: issue.identifier,
    title: issue.title,
    status: STATUS_META[issue.status as Status]?.label ?? issue.status,
    priority: PRIORITY_NAMES[issue.priority as Priority] ?? "none",
    ...(issue.description ? { description: issue.description } : {}),
  };
}

const SEARCH_RESULT_LIMIT = 40;

const AGENT_ACTOR = { kind: "agent" as const, label: "codex", via: "mcp" as const };

// Tasks that an agent publishes name the person who ran it and wait for review (H-COLLAB-02).
function publishingActor(ctx: AgentToolContext) {
  return { ...AGENT_ACTOR, publishedBy: ctx.userId, sourceThreadId: ctx.threadId };
}

// One approval covers a whole batch, so a batch is capped rather than trusted.
const BATCH_LIMIT = 20;

type ToolArgs = Record<string, unknown>;

function batch(value: unknown, field: string): ToolArgs[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TacosError(`${field} must be a non-empty array`);
  }
  if (value.length > BATCH_LIMIT) {
    throw new TacosError(`${field} accepts at most ${BATCH_LIMIT} items per call`);
  }
  return value.map(asRecord);
}

// A batch reports per item: one bad title must not discard the rest of the work.
function batchReport(done: string[], failed: string[], verb: string): string {
  const lines: string[] = [done.length ? `${done.length} ${verb}:\n${done.join("\n")}` : `Nothing ${verb}.`];
  if (failed.length) lines.push(`${failed.length} failed:\n${failed.join("\n")}`);
  return lines.join("\n\n");
}

function failure(err: unknown): string {
  return err instanceof Error ? err.message : "The tool failed.";
}

async function createOne(ctx: AgentToolContext, args: ToolArgs): Promise<string> {
  const title = str(args.title);
  if (!title) throw new TacosError("Title is required");
  const usernames = Array.isArray(args.assignees)
    ? args.assignees.map((value) => String(value)).filter(Boolean)
    : [];
  const assigneeIds = usernames.length
    ? await resolveAssigneeIds(ctx.workspaceId, usernames)
    : [];
  const detail = await createIssue(
    ctx.workspaceId,
    {
      title,
      description: str(args.description) || undefined,
      status: asStatus(args.status) ?? "todo",
      priority: asPriority(args.priority) ?? 0,
      dueDate: str(args.dueDate) || null,
      assigneeIds,
      labelNames: Array.isArray(args.labels)
        ? args.labels.map((value) => String(value).trim()).filter(Boolean)
        : [],
      project: ctx.projectKey,
      parent: str(args.parent) || undefined,
    },
    publishingActor(ctx)
  );
  return `Created ${detail.issue.identifier} — ${detail.issue.title}`;
}

async function updateOne(ctx: AgentToolContext, args: ToolArgs): Promise<string> {
  const patch: Parameters<typeof updateIssue>[2] = {};
  if (args.title !== undefined) patch.title = str(args.title);
  if (args.description !== undefined) patch.description = String(args.description ?? "");
  const status = asStatus(args.status);
  if (status) patch.status = status;
  const priority = asPriority(args.priority);
  if (priority !== undefined) patch.priority = priority;
  if (args.dueDate !== undefined) patch.dueDate = str(args.dueDate) || null;
  if (args.parent !== undefined) patch.parent = str(args.parent) || null;
  if (Object.keys(patch).length === 0) throw new TacosError("Nothing to change");
  const { issue } = await requireProjectTask(ctx, str(args.id));
  const detail = await updateIssue(ctx.workspaceId, issue.identifier, patch, AGENT_ACTOR);
  return `Updated ${detail.issue.identifier} — ${detail.issue.title}`;
}

// Unjoined and nonexistent read the same, so a refusal says nothing about other people's workspaces.
async function joinedWorkspace(userId: string, wanted: string): Promise<UserWorkspace> {
  const joined = await listUserWorkspaces(userId);
  const lower = wanted.toLowerCase();
  const exact = joined.filter((workspace) => workspace.id === wanted || workspace.key.toLowerCase() === lower);
  const found = exact.length ? exact : joined.filter((workspace) => workspace.name.toLowerCase() === lower);
  if (found.length > 1) {
    throw new TacosError(`"${wanted}" matches several workspaces; use a key: ${found.map((w) => w.key).join(", ")}`, 409);
  }
  if (!found[0]) throw new TacosError(`You have not joined a workspace called "${wanted}"`, 404);
  return found[0];
}

async function namedProject(workspaceId: string, userId: string, wanted: string) {
  const lower = wanted.toLowerCase();
  const visible = await listProjects(workspaceId, userId);
  const project = visible.find(
    (row) => row.id === wanted || row.key.toLowerCase() === lower || row.name.toLowerCase() === lower
  );
  if (!project) throw new TacosError(`No project called "${wanted}" in that workspace`, 404);
  return project;
}

/** Where this call reads: this conversation's project, unless it names somewhere else. */
async function readScope(ctx: AgentToolContext, args: ToolArgs): Promise<AgentToolContext> {
  const workspace = str(args.workspace);
  const project = str(args.project);
  const workspaceId = workspace ? (await joinedWorkspace(ctx.userId, workspace)).id : ctx.workspaceId;
  if (project) {
    const found = await namedProject(workspaceId, ctx.userId, project);
    return { ...ctx, workspaceId, projectId: found.id, projectKey: found.key };
  }
  if (workspaceId === ctx.workspaceId) return ctx;
  return { ...ctx, workspaceId, projectId: "", projectKey: "" };
}

export const NO_WRITE_TARGET =
  "Name the workspace this write goes to, with workspace. list_workspaces shows the choices.";

export function namesWriteTarget(rawArgs: unknown): boolean {
  return Boolean(str(asRecord(rawArgs).workspace));
}

/** Where this write goes. It must name a workspace; a bare write is refused. */
async function writeScope(ctx: AgentToolContext, name: string, args: ToolArgs): Promise<AgentToolContext> {
  const workspace = str(args.workspace);
  if (!workspace) throw new TacosError(NO_WRITE_TARGET);
  const { id: workspaceId } = await joinedWorkspace(ctx.userId, workspace);
  const project = str(args.project);
  if (project) {
    const found = await namedProject(workspaceId, ctx.userId, project);
    return { ...ctx, workspaceId, projectId: found.id, projectKey: found.key };
  }
  if (workspaceId === ctx.workspaceId) return ctx;
  if (!WORKSPACE_ONLY_WRITES.has(name)) {
    throw new TacosError("Name the project too, with project: this is not the conversation's workspace.");
  }
  return { ...ctx, workspaceId, projectId: "", projectKey: "" };
}

/** True when a write names a workspace other than the conversation's. Those always ask first. */
export async function writesElsewhere(ctx: AgentToolContext, name: string, rawArgs: unknown): Promise<boolean> {
  const spec = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!spec?.write) return false;
  const workspace = str(asRecord(rawArgs).workspace);
  if (!workspace) return false;
  try {
    return (await joinedWorkspace(ctx.userId, workspace)).id !== ctx.workspaceId;
  } catch {
    return false; // The tool itself refuses this one and explains why.
  }
}

async function searchTool(ctx: AgentToolContext, args: ToolArgs) {
  const query = str(args.query);
  if (!query) throw new TacosError("Pass something to search for");
  const wanted = str(args.workspace);
  const targets =
    wanted.toLowerCase() === "all"
      ? await listUserWorkspaces(ctx.userId)
      : [
          wanted
            ? await joinedWorkspace(ctx.userId, wanted)
            : { id: ctx.workspaceId, key: "", name: "" },
        ];
  const results = [];
  for (const target of targets) {
    for (const hit of await searchWorkspace(target.id, ctx.userId, query)) {
      results.push({
        ...(target.key ? { workspace: target.key } : {}),
        kind: hit.kind,
        id: hit.openId,
        title: hit.title,
        ref: hit.ref,
        snippet: hit.snippet,
        updatedAt: hit.updatedAt,
      });
    }
  }
  return { count: results.length, results: results.slice(0, SEARCH_RESULT_LIMIT) };
}

export async function executeAgentTool(
  bound: AgentToolContext,
  name: string,
  rawArgs: unknown
): Promise<{ text: string; isError?: boolean }> {
  const args = asRecord(rawArgs);
  const spec = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!spec) throw new TacosError(`Unknown tool "${name}"`, 400);
  // Reads say where they look through their own scope; every write below uses the named target.
  const ctx = spec.write ? await writeScope(bound, name, args) : bound;

  switch (name) {
    case "list_workspaces": {
      const joined = await listUserWorkspaces(ctx.userId);
      return {
        text: JSON.stringify(
          joined.map((workspace) => ({
            key: workspace.key,
            name: workspace.name,
            current: workspace.id === ctx.workspaceId,
          })),
          null,
          2
        ),
      };
    }
    case "list_projects": {
      const scope = await readScope(ctx, args);
      const visible = await listProjects(scope.workspaceId, ctx.userId);
      return {
        text: JSON.stringify(
          visible.map((project) => ({
            key: project.key,
            name: project.name,
            description: project.description,
            current: project.id === ctx.projectId,
          })),
          null,
          2
        ),
      };
    }
    case "search_workspace":
      return { text: JSON.stringify(await searchTool(ctx, args), null, 2) };
    case "list_tasks": {
      const status = str(args.status);
      const scope = await readScope(ctx, args);
      const issues = await listIssues(scope.workspaceId, {
        projectId: scope.projectId || undefined,
        viewerId: ctx.userId,
        status: status === "active" || status === "open" || status === "all" ? status : asStatus(status) ?? "all",
        q: str(args.q) || undefined,
        limit: Math.min(100, Math.max(1, Number(args.limit) || 30)),
      });
      return {
        text: JSON.stringify(
          {
            project: scope.projectKey || "all",
            count: issues.length,
            tasks: issues.map((issue) => taskSummary(issue)),
          },
          null,
          2
        ),
      };
    }
    case "get_task": {
      // Reading follows the person's own visibility, not this conversation's project.
      const scope = await readScope(ctx, args);
      const id = str(args.id);
      if (!id) throw new TacosError("Task id is required");
      const detail = await getIssueDetail(scope.workspaceId, id, ctx.userId);
      if (!detail) throw new TacosError(`Task "${id}" not found`, 404);
      const { issue, comments } = detail;
      const fieldValues = (await listFieldValues([issue.id]))[issue.id] ?? {};
      const customFields = Object.fromEntries(
        (await listTaskFields(scope.workspaceId))
          .filter((field) => fieldValues[field.id])
          .map((field) => [field.name, fieldValues[field.id]])
      );
      return {
        text: JSON.stringify(
          {
            ...taskSummary(issue),
            assignees: issue.assignees.map((assignee) => assignee.displayName),
            labels: issue.labels.map((label) => label.name),
            dueDate: issue.dueDate,
            customFields,
            comments: comments.map((comment) => ({
              author: comment.author?.displayName ?? comment.agentAuthor ?? "agent",
              body: comment.body,
              createdAt: comment.createdAt,
            })),
          },
          null,
          2
        ),
      };
    }
    case "claim_task": {
      // The agent claims for the person who runs it; the claim is theirs, not the agent's.
      const { issue } = await requireProjectTask(ctx, str(args.id));
      await claimIssue(ctx.workspaceId, issue.id, ctx.userId);
      return { text: `Claimed ${issue.identifier} — ${issue.title} for you` };
    }
    case "get_overview": {
      const scope = await readScope(ctx, args);
      if (!scope.projectId) throw new TacosError("Name the project too, with project.");
      const project = await getProject(scope.workspaceId, scope.projectId);
      if (!project) throw new TacosError("Project not found", 404);
      return {
        text: JSON.stringify(
          { project: project.name, key: project.key, description: project.description, overview: project.doc },
          null,
          2
        ),
      };
    }
    case "get_doc": {
      const id = str(args.id);
      const title = str(args.title);
      if (!id && !title) throw new TacosError("Pass a document id or title");
      // Documents are a workspace-wide library, not project tasks, so the conversation's
      // project does not fence them; the person's own visibility rule does.
      const scope = await readScope(ctx, args);
      const all = await listPages(scope.workspaceId, ctx.userId);
      const matches = id
        ? all.filter((page) => page.id === id)
        : all.filter((page) => page.title.trim().toLowerCase() === title.toLowerCase());
      if (matches.length === 0) {
        throw new TacosError(id ? `Document "${id}" not found` : `No document titled "${title}"`, 404);
      }
      if (matches.length > 1) {
        return {
          text: JSON.stringify(
            {
              matches: matches.slice(0, 10).map((page) => ({
                id: page.id,
                title: page.title,
                projectId: page.projectId,
                characters: page.doc.length,
              })),
              note: "Several documents share that title — call get_doc again with one id.",
            },
            null,
            2
          ),
        };
      }
      const page = matches[0];
      return {
        text: JSON.stringify(
          {
            id: page.id,
            title: page.title,
            projectId: page.projectId,
            characters: page.doc.length,
            markdown: page.doc,
          },
          null,
          2
        ),
      };
    }
    case "create_task":
      return { text: await createOne(ctx, args) };
    case "create_tasks": {
      const items = batch(args.tasks, "tasks");
      const done: string[] = [];
      const failed: string[] = [];
      for (const item of items) {
        try {
          done.push(await createOne(ctx, item));
        } catch (err) {
          failed.push(`${str(item.title) || "(untitled)"}: ${failure(err)}`);
        }
      }
      return { text: batchReport(done, failed, "created") };
    }
    case "update_task":
      return { text: await updateOne(ctx, args) };
    case "update_tasks": {
      const items = batch(args.updates, "updates");
      const done: string[] = [];
      const failed: string[] = [];
      for (const item of items) {
        try {
          done.push(await updateOne(ctx, item));
        } catch (err) {
          failed.push(`${str(item.id) || "(no id)"}: ${failure(err)}`);
        }
      }
      return { text: batchReport(done, failed, "updated") };
    }
    case "add_comment": {
      const body = str(args.body);
      if (!body) throw new TacosError("Comment body is required");
      const { issue } = await requireProjectTask(ctx, str(args.id));
      await addComment(ctx.workspaceId, issue.identifier, body, AGENT_ACTOR);
      return { text: `Commented on ${issue.identifier}` };
    }
    case "update_overview": {
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (!markdown.trim()) throw new TacosError("The new overview is empty");
      // The requesting user's own Overview permission applies: an agent cannot grant
      // itself edit rights the person does not have.
      await updateProject(ctx.workspaceId, ctx.projectId, { doc: markdown }, ctx.userId);
      return { text: `Replaced the ${ctx.projectKey} overview (${markdown.length} characters)` };
    }
    case "create_doc": {
      const title = str(args.title);
      if (!title) throw new TacosError("Document title is required");
      const page = await createPage(ctx.workspaceId, ctx.userId, {
        projectId: ctx.projectId,
        title,
      });
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (markdown.trim()) {
        await updatePage(ctx.workspaceId, page.id, ctx.userId, { doc: markdown }, { via: "mcp" });
      }
      return { text: `Created document "${page.title}" in ${ctx.projectKey}` };
    }
    case "edit_doc": {
      const id = str(args.id);
      if (!id) throw new TacosError("Document id is required — call get_doc first");
      const page = await getPage(ctx.workspaceId, id, ctx.userId);
      if (!page) throw new TacosError(`Document "${id}" not found`, 404);
      const edits = (Array.isArray(args.edits) ? args.edits : []).map((raw) => {
        const edit = asRecord(raw);
        return {
          find: typeof edit.find === "string" ? edit.find : "",
          replace: typeof edit.replace === "string" ? edit.replace : "",
        };
      });
      const doc = applyDocEdits(page.doc, edits);
      // baseRevision refuses the write when someone saved after the edits were matched.
      await updatePage(ctx.workspaceId, id, ctx.userId, { doc, baseRevision: page.revision }, { via: "mcp" });
      return { text: `Edited "${page.title}": ${edits.length} passage(s) changed; the rest is as it was` };
    }
    case "undo_doc_edit": {
      const id = str(args.id);
      if (!id) throw new TacosError("Document id is required");
      const page = await undoAgentEdit(ctx.workspaceId, id, ctx.userId, { via: "mcp" });
      return { text: `Took back the latest edit to "${page.title}"` };
    }
    case "update_doc": {
      const id = str(args.id);
      if (!id) throw new TacosError("Document id is required — call get_doc first");
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (!markdown.trim()) throw new TacosError("The new document is empty");
      // updatePage applies the person's own page permissions to the agent's write.
      const page = await updatePage(ctx.workspaceId, id, ctx.userId, { doc: markdown }, { via: "mcp" });
      return { text: `Replaced document "${page.title}" (${markdown.length} characters)` };
    }
    case "delete_task": {
      const { issue } = await requireProjectTask(ctx, str(args.id));
      await deleteIssue(ctx.workspaceId, issue.identifier);
      return { text: `Moved ${issue.identifier} to Trash — ${issue.title}` };
    }
    default:
      throw new TacosError(`Unknown tool "${name}"`, 400);
  }
}

export function isReadOnlyTool(name: string): boolean {
  return READ_TOOLS.has(name);
}
