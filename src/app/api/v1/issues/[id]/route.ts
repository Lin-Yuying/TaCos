import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { parseLabelNames, parsePriority, parseStatus } from "@/lib/api-input";
import {
  deleteIssue,
  getIssueDetail,
  PRIORITY_NAMES,
  TacosError,
  resolveAssigneeId,
  resolveAssigneeIds,
  updateIssue,
} from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

function flatDetail(detail: NonNullable<Awaited<ReturnType<typeof getIssueDetail>>>) {
  return {
    ...detail.issue,
    priorityLabel: PRIORITY_NAMES[detail.issue.priority],
    comments: detail.comments,
    events: detail.events,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const detail = await getIssueDetail(key.workspaceId, id);
    if (!detail) throw new TacosError(`Issue "${id}" not found`, 404);
    return Response.json(flatDetail(detail));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    let assigneeIds: string[] | undefined;
    if (Array.isArray(body.assignees)) {
      assigneeIds = await resolveAssigneeIds(
        key.workspaceId,
        body.assignees.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim() !== ""
        )
      );
    } else if (body.assignee !== undefined) {
      assigneeIds =
        typeof body.assignee === "string" && body.assignee.trim()
          ? await resolveAssigneeIds(key.workspaceId, [body.assignee])
          : [];
    }
    const detail = await updateIssue(
      key.workspaceId,
      id,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        status: parseStatus(body.status),
        priority: parsePriority(body.priority),
        assigneeIds,
        labelNames: parseLabelNames(body.labels),
      },
      { kind: "agent", label: `api:${key.name}`, via: "api" }
    );
    return Response.json(flatDetail(detail));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const deleted = await deleteIssue(key.workspaceId, id);
    return Response.json({
      deleted: { id: deleted.id, identifier: deleted.identifier, title: deleted.title },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
