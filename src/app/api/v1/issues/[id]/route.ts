import {
  apiActor,
  assertKeyIssueProject,
  assertKeyProjectId,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import { parseLabelNames, parsePriority, parseStatus } from "@/lib/api-input";
import { issueDetailPayload } from "@/lib/api-issues";
import {
  assertSeesIssue,
  deleteIssue,
  getIssueDetail,
  resolveAssigneeIds,
  TacosError,
  updateIssue,
} from "@/lib/issues";
import type { Recurrence, ReminderPreset } from "@/lib/constants";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const detail = await getIssueDetail(key.workspaceId, id, key.createdBy);
    if (!detail) throw new TacosError(`Issue "${id}" not found`, 404);
    assertKeyProjectId(key, detail.issue.projectId, detail.issue.projectKey);
    return Response.json(await issueDetailPayload(key.workspaceId, detail));
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
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
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
        dueDate:
          body.dueDate === undefined
            ? undefined
            : typeof body.dueDate === "string" && body.dueDate.trim() !== ""
              ? body.dueDate
              : null,
        estimate:
          body.estimate === undefined
            ? undefined
            : body.estimate === null || body.estimate === ""
              ? null
              : Number(body.estimate),
        reminder:
          body.reminder === undefined
            ? undefined
            : typeof body.reminder === "string" && body.reminder.trim() !== ""
              ? (body.reminder as ReminderPreset)
              : null,
        parent:
          body.parent === undefined
            ? undefined
            : typeof body.parent === "string"
              ? body.parent
              : null,
        recurrence:
          body.recurrence === undefined
            ? undefined
            : typeof body.recurrence === "string" && body.recurrence.trim() !== ""
              ? (body.recurrence as Recurrence)
              : null,
      },
      apiActor(key)
    );
    return Response.json(await issueDetailPayload(key.workspaceId, detail));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const deleted = await deleteIssue(key.workspaceId, id);
    return Response.json({
      deleted: { id: deleted.id, identifier: deleted.identifier, title: deleted.title },
      trashed: true,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
