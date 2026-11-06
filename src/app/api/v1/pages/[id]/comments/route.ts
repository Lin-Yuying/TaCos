import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { visiblePageForKey } from "@/lib/api-pages";
import { addPageComment, listPageComments } from "@/lib/page-comments";
import { paginateList, pageLimit } from "@/lib/pagination";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const page = await visiblePageForKey(key, id);
    const comments = await listPageComments(key.workspaceId, page.id, key.createdBy);
    const params = new URL(req.url).searchParams;
    const requested = Number(params.get("limit"));
    const { page: items, nextCursor } = paginateList(
      comments,
      pageLimit(Number.isFinite(requested) && requested > 0 ? requested : undefined),
      params.get("cursor") ?? undefined,
      (comment) => ({ k: comment.createdAt, id: comment.id }),
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
    return Response.json(items, {
      headers: {
        "X-Total-Count": String(comments.length),
        ...(nextCursor ? { "X-Next-Cursor": nextCursor } : {}),
      },
    });
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
    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
      return Response.json({ error: "parentId must be a string or null" }, { status: 400 });
    }
    const page = await visiblePageForKey(key, id);
    const [comment] = await addPageComment(
      key.workspaceId,
      page.id,
      key.createdBy,
      {
        body: body.body,
        parentId:
          typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null,
      },
      { via: `api:${key.name}`, incremental: true }
    );
    return Response.json(
      { comment },
      { status: 201, headers: { Location: `/api/v1/pages/${page.id}/comments/${comment.id}` } }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
