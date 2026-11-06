import { assertKeyProject, errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { filterPagesForKey, pageApiPayload, visiblePageForKey } from "@/lib/api-pages";
import { paginateListDesc, pageLimit } from "@/lib/pagination";
import { createPage, listPageSummaries } from "@/lib/pages";

// Pages are listed without their bodies; GET /api/v1/pages/{id} returns the markdown.
export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    const params = new URL(req.url).searchParams;
    const projectParam = params.get("project");
    const project = projectParam ? await assertKeyProject(key, projectParam) : undefined;
    const summaries = await listPageSummaries(key.workspaceId, key.createdBy, {
      projectId: project?.id,
      parentId: params.get("parentId") ?? undefined,
      q: params.get("q") ?? undefined,
    });
    const allowed = filterPagesForKey(key, summaries);
    const requested = Number(params.get("limit"));
    const { page, nextCursor } = paginateListDesc(
      allowed,
      pageLimit(Number.isFinite(requested) && requested > 0 ? requested : undefined),
      params.get("cursor") ?? undefined,
      (item) => ({ k: item.updatedAt, id: item.id }),
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
    );
    return Response.json(page, {
      headers: {
        "X-Total-Count": String(allowed.length),
        ...(nextCursor ? { "X-Next-Cursor": nextCursor } : {}),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const key = await requireApiKey(req);
    const body = await readJsonBody(req);
    for (const field of ["title", "doc", "project"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return Response.json({ error: `${field} must be a string` }, { status: 400 });
      }
    }
    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
      return Response.json({ error: "parentId must be a string or null" }, { status: 400 });
    }
    const project =
      typeof body.project === "string" && body.project.trim()
        ? await assertKeyProject(key, body.project)
        : undefined;
    const parentId =
      typeof body.parentId === "string" && body.parentId.trim() ? body.parentId.trim() : null;
    // The business layer checks the parent's edit permission; reading it here also puts
    // an inherited project through the key's allowlist before anything is written.
    if (parentId) await visiblePageForKey(key, parentId);
    const page = await createPage(
      key.workspaceId,
      key.createdBy,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        doc: typeof body.doc === "string" ? body.doc : undefined,
        projectId: project?.id ?? null,
        parentId,
      },
      { via: `api:${key.name}` }
    );
    return Response.json(await pageApiPayload(page, key.createdBy), {
      status: 201,
      headers: { Location: `/api/v1/pages/${page.id}` },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
