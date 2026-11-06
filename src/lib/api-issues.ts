import { assertKeyProject } from "./api-auth";
import { parsePriority, parseStatus } from "./api-input";
import {
  listIssuesPage,
  PRIORITY_NAMES,
  resolveAssigneeId,
  type ApiKeyRecord,
  type IssueDetail,
  type Project,
  type Status,
} from "./issues";
import { listIssueFieldValues } from "./task-fields";

// The shared task-list response behind GET /api/v1/issues and
// GET /api/v1/projects/{id}/tasks: same filters, ordering, cursor and page headers.
// A project route owns the project, so a `project` query parameter is ignored there.
export async function issueListResponse(
  req: Request,
  key: ApiKeyRecord,
  fixedProject?: Project
): Promise<Response> {
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
  const projectParam = params.get("project");
  const project =
    fixedProject ?? (projectParam ? await assertKeyProject(key, projectParam) : undefined);

  const page = await listIssuesPage(key.workspaceId, {
    viewerId: key.createdBy,
    status,
    priority,
    q: params.get("q") ?? undefined,
    label: params.get("label") ?? undefined,
    projectId: project?.id,
    projectIds: key.projectIds ?? undefined,
    assigneeId,
    limit,
    cursor: params.get("cursor") ?? undefined,
  });
  return Response.json(
    page.items.map((issue) => ({ ...issue, priorityLabel: PRIORITY_NAMES[issue.priority] })),
    {
      headers: {
        "X-Total-Count": String(page.total),
        ...(page.nextCursor ? { "X-Next-Cursor": page.nextCursor } : {}),
      },
    }
  );
}

// The flat issue shape every REST task route returns, plus the custom field values
// keyed by field name.
export async function issueDetailPayload(workspaceId: string, detail: IssueDetail) {
  return {
    ...detail.issue,
    priorityLabel: PRIORITY_NAMES[detail.issue.priority],
    comments: detail.comments,
    events: detail.events,
    children: detail.children,
    dependencies: detail.dependencies,
    blocked: detail.blocked,
    fields: await listIssueFieldValues(workspaceId, detail.issue.id),
  };
}

// Dependency mutations return the new link state, not the whole activity timeline.
export function dependencyPayload(detail: IssueDetail) {
  return {
    id: detail.issue.id,
    identifier: detail.issue.identifier,
    dependencies: detail.dependencies,
    blocked: detail.blocked,
  };
}
