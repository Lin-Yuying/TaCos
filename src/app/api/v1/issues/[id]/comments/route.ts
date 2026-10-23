import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { addComment, getIssueDetail, PRIORITY_NAMES, TacosError } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const detail = await getIssueDetail(key.workspaceId, id);
    if (!detail) throw new TacosError(`Issue "${id}" not found`, 404);
    return Response.json(detail.comments);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    if (typeof body.body !== "string" || !body.body.trim()) {
      return Response.json({ error: "body is required" }, { status: 400 });
    }
    const detail = await addComment(key.workspaceId, id, body.body, {
      kind: "agent",
      label: `api:${key.name}`,
      via: "api",
    });
    const comment = detail.comments[detail.comments.length - 1];
    return Response.json(
      {
        comment,
        issue: { ...detail.issue, priorityLabel: PRIORITY_NAMES[detail.issue.priority] },
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
