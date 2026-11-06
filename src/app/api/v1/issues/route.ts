import { apiActor, assertKeyProject, errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { parseLabelNames, parsePriority, parseStatus } from "@/lib/api-input";
import { issueListResponse } from "@/lib/api-issues";
import {
  assertSeesProject,
  createIssue,
  listProjects,
  PRIORITY_NAMES,
  resolveAssigneeIds,
  type Priority,
  type ReminderPreset,
} from "@/lib/issues";
import type { Recurrence } from "@/lib/constants";

export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    return await issueListResponse(req, key);
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
    const allowlist = key.projectIds;
    const allowedProjects =
      allowlist === null ? projects : projects.filter((project) => allowlist.includes(project.id));
    const projectParam =
      typeof body.project === "string" && body.project.trim()
        ? body.project.trim()
        : allowedProjects[0]?.key;
    if (!projectParam) {
      return Response.json(
        { error: "No project specified and workspace has no projects", hint: "Create a project first (web UI → Settings → Projects) or pass \"project\": \"KEY\"" },
        { status: 400 }
      );
    }
    const project = await assertKeyProject(key, projectParam);

    // "assignees" takes several names; the old singular field still works.
    const assigneeValues = Array.isArray(body.assignees)
      ? body.assignees.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
        )
      : typeof body.assignee === "string" && body.assignee.trim()
        ? [body.assignee]
        : [];
    if (typeof body.project === "string") await assertSeesProject(key.workspaceId, body.project, key.createdBy);
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
        dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
        reminder:
          typeof body.reminder === "string" ? (body.reminder as ReminderPreset) : null,
        recurrence:
          typeof body.recurrence === "string" ? (body.recurrence as Recurrence) : null,
        project: project.key,
        parent: typeof body.parent === "string" ? body.parent : null,
      },
      apiActor(key)
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
