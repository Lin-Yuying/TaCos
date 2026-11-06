import {
  assertKeyProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import {
  assertSeesProject,
  countIssuesByStatus,
  listProjectMembers,
  trashProject,
  updateProject,
  type Project,
} from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

// The project Overview document (`doc`) belongs to the documents surface, not to
// project metadata, so it is never returned or written here.
function projectMeta(project: Project & { doc?: string }): Project {
  const { doc, ...rest } = project;
  void doc;
  return rest;
}

async function projectPayload(workspaceId: string, project: Project, viewerId: string) {
  const [members, taskCounts] = await Promise.all([
    listProjectMembers(workspaceId, project.id),
    countIssuesByStatus(workspaceId, project.id, viewerId),
  ]);
  return { ...project, members, memberCount: members.length, taskCounts };
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    return Response.json(
      await projectPayload(key.workspaceId, projectMeta(project), key.createdBy)
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    for (const field of ["name", "description", "color"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return Response.json({ error: `${field} must be a string` }, { status: 400 });
      }
    }
    if (body.icon !== undefined && body.icon !== null && typeof body.icon !== "string") {
      return Response.json({ error: "icon must be a string or null" }, { status: 400 });
    }
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.color === undefined &&
      body.icon === undefined
    ) {
      return Response.json(
        { error: "No project fields to update", hint: "Send name, description, color or icon." },
        { status: 400 }
      );
    }
    const updated = await updateProject(
      key.workspaceId,
      project.id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        color: typeof body.color === "string" ? body.color : undefined,
        icon: body.icon === undefined ? undefined : typeof body.icon === "string" ? body.icon : null,
      },
      key.createdBy
    );
    return Response.json(await projectPayload(key.workspaceId, updated, key.createdBy));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    await trashProject(key.workspaceId, project.id, key.createdBy);
    return Response.json({
      deleted: { id: project.id, key: project.key, name: project.name },
      trashed: true,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
