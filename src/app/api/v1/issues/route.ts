import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { parseLabelNames, parsePriority, parseStatus } from "@/lib/api-input";
import {
  createIssue,
  listIssues,
  listProjects,
  PRIORITY_NAMES,
  resolveAssigneeId,
  resolveAssigneeIds,
  type Priority,
  type Status,
} from "@/lib/issues";

export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    const params = new URL(req.url).searchParams;
    const statusParam = params.get("status");
    let status: Status | "active" | "all" | undefined;
    if (statusParam === "active" || statusParam === "all") {
      status = statusParam;
    } else if (statusParam) {
      status = parseStatus(statusParam);
    }
    const priorityParam = params.get("priority");
    const priority = priorityParam ? parsePriority(priorityParam) : undefined;
    const assigneeParam = params.get("assignee");
    let assigneeId: string | null | undefined;
    if (assigneeParam === "none") {
      assigneeId = null;
    } else if (assigneeParam) {
      assigneeId = await resolveAssigneeId(key.workspaceId, assigneeParam);
    }
    const limitParam = params.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 200) : 100;

    const issues = await listIssues(key.workspaceId, {
      status,
      priority,
      q: params.get("q") ?? undefined,
      label: params.get("label") ?? undefined,
      projectId: params.get("project") ?? undefined,
      assigneeId,
      limit,
    });
    return Response.json(
      issues.map((issue) => ({ ...issue, priorityLabel: PRIORITY_NAMES[issue.priority] }))
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const key = await requireApiKey(req);
    const body = await readJsonBody(req);
    if (typeof body.title !== "string" || !body.title.trim()) {
      return Response.json(
        { error: "title is required", hint: "Provide a short, imperative summary" },
        { status: 400 }
      );
    }
    const projects = await listProjects(key.workspaceId);
    const projectParam =
      typeof body.project === "string" && body.project.trim()
        ? body.project.trim()
        : projects[0]?.key;
    if (!projectParam) {
      return Response.json(
        { error: "No project specified and workspace has no projects", hint: "Create a project first (web UI → Settings → Projects) or pass \"project\": \"KEY\"" },
        { status: 400 }
      );
    }

    // "assignees" takes several names; the old singular field still works.
    const assigneeValues = Array.isArray(body.assignees)
      ? body.assignees.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
        )
      : typeof body.assignee === "string" && body.assignee.trim()
        ? [body.assignee]
        : [];
    const detail = await createIssue(
      key.workspaceId,
      {
        title: body.title,
        description: typeof body.description === "string" ? body.description : "",
        status:
          body.status === undefined || body.status === null ? "todo" : parseStatus(body.status),
        priority: parsePriority(body.priority) ?? (0 as Priority),
        assigneeIds: await resolveAssigneeIds(key.workspaceId, assigneeValues),
        labelNames: parseLabelNames(body.labels),
        project: projectParam,
      },
      { kind: "agent", label: `api:${key.name}`, via: "api" }
    );
    return Response.json(
      { ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] },
      {
        status: 201,
        headers: { Location: `/api/v1/issues/${detail.issue.identifier}` },
      }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
