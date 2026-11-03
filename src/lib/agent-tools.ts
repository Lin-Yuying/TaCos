import {
  addComment,
  claimIssue,
  createIssue,
  deleteIssue,
  getIssueDetail,
  getProject,
  listIssues,
  normalizePriority,
  normalizeStatus,
  resolveAssigneeIds,
  TacosError,
  updateIssue,
  updateProject,
  type Priority,
  type Status,
} from "./issues";
import { createPage, listPages, updatePage } from "./pages";
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

export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: "list_tasks",
    description: `List tasks in this project. Statuses: ${STATUS_HELP}.`,
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
      },
    },
  },
  {
    name: "get_task",
    description: "Read one task by identifier (e.g. TEST-12) or id, including its comments.",
    write: false,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Task identifier or id" } },
      required: ["id"],
    },
  },
  {
    name: "get_overview",
    description: "Read this project's Overview document (markdown) and its description.",
    write: false,
    inputSchema: { type: "object", properties: {} },
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
    name: "update_doc",
    description:
      "Replace a document's complete markdown. Read it with get_doc first and send the whole new body; this overwrites what is there.",
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
  if (Object.keys(patch).length === 0) throw new TacosError("Nothing to change");
  const { issue } = await requireProjectTask(ctx, str(args.id));
  const detail = await updateIssue(ctx.workspaceId, issue.identifier, patch, AGENT_ACTOR);
  return `Updated ${detail.issue.identifier} — ${detail.issue.title}`;
}

export async function executeAgentTool(
  ctx: AgentToolContext,
  name: string,
  rawArgs: unknown
): Promise<{ text: string; isError?: boolean }> {
  const args = asRecord(rawArgs);
  const spec = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!spec) throw new TacosError(`Unknown tool "${name}"`, 400);

  switch (name) {
    case "list_tasks": {
      const status = str(args.status);
      const issues = await listIssues(ctx.workspaceId, {
        projectId: ctx.projectId,
        viewerId: ctx.userId,
        status: status === "active" || status === "open" || status === "all" ? status : asStatus(status) ?? "all",
        q: str(args.q) || undefined,
        limit: Math.min(100, Math.max(1, Number(args.limit) || 30)),
      });
      return {
        text: JSON.stringify(
          {
            project: ctx.projectKey,
            count: issues.length,
            tasks: issues.map((issue) => taskSummary(issue)),
          },
          null,
          2
        ),
      };
    }
    case "get_task": {
      const { issue, comments } = await requireProjectTask(ctx, str(args.id));
      return {
        text: JSON.stringify(
          {
            ...taskSummary(issue),
            assignees: issue.assignees.map((assignee) => assignee.displayName),
            labels: issue.labels.map((label) => label.name),
            dueDate: issue.dueDate,
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
      const project = await getProject(ctx.workspaceId, ctx.projectId);
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
      const all = await listPages(ctx.workspaceId, ctx.userId);
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
        await updatePage(ctx.workspaceId, page.id, ctx.userId, { doc: markdown });
      }
      return { text: `Created document "${page.title}" in ${ctx.projectKey}` };
    }
    case "update_doc": {
      const id = str(args.id);
      if (!id) throw new TacosError("Document id is required — call get_doc first");
      const markdown = typeof args.markdown === "string" ? args.markdown : "";
      if (!markdown.trim()) throw new TacosError("The new document is empty");
      // updatePage applies the person's own page permissions to the agent's write.
      const page = await updatePage(ctx.workspaceId, id, ctx.userId, { doc: markdown });
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
