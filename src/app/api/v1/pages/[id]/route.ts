import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { pageApiPayload, visiblePageForKey } from "@/lib/api-pages";
import { deletePage, updatePage } from "@/lib/pages";

type Ctx = { params: Promise<{ id: string }> };

// {id} is the page id; pages have no human identifier like a task's CORE-7.
export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const page = await visiblePageForKey(key, id);
    return Response.json(await pageApiPayload(page, key.createdBy));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    for (const field of ["title", "doc"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return Response.json({ error: `${field} must be a string` }, { status: 400 });
      }
    }
    if (body.icon !== undefined && body.icon !== null && typeof body.icon !== "string") {
      return Response.json({ error: "icon must be a string or null" }, { status: 400 });
    }
    if (body.baseRevision !== undefined && typeof body.baseRevision !== "number") {
      return Response.json({ error: "baseRevision must be a number" }, { status: 400 });
    }
    if (body.title === undefined && body.doc === undefined && body.icon === undefined) {
      return Response.json(
        { error: "No page fields to update", hint: "Send title, doc or icon." },
        { status: 400 }
      );
    }
    const page = await visiblePageForKey(key, id);
    const updated = await updatePage(
      key.workspaceId,
      page.id,
      key.createdBy,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        doc: typeof body.doc === "string" ? body.doc : undefined,
        icon: body.icon === undefined ? undefined : typeof body.icon === "string" ? body.icon : null,
        baseRevision: typeof body.baseRevision === "number" ? body.baseRevision : undefined,
      },
      { via: `api:${key.name}` }
    );
    return Response.json(await pageApiPayload(updated, key.createdBy));
  } catch (err) {
    return errorResponse(err);
  }
}

// The same reversible Trash the web UI uses; the page and its subtree can be restored.
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const page = await visiblePageForKey(key, id);
    await deletePage(key.workspaceId, page.id, key.createdBy);
    return Response.json({
      deleted: { id: page.id, title: page.title, parentId: page.parentId, projectId: page.projectId },
      trashed: true,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
