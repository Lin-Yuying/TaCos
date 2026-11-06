import {
  assertKeyProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import {
  addProjectMember,
  assertSeesProject,
  listProjectMembers,
  resolveAssigneeId,
  TacosError,
} from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    return Response.json(await listProjectMembers(key.workspaceId, project.id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    const value =
      typeof body.userId === "string" && body.userId.trim()
        ? body.userId
        : typeof body.username === "string" && body.username.trim()
          ? body.username
          : null;
    if (!value) {
      return Response.json(
        { error: "userId or username is required", hint: 'Send {"username": "sam"} or {"userId": "…"}' },
        { status: 400 }
      );
    }
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    const userId = await resolveAssigneeId(key.workspaceId, value);
    await addProjectMember(key.workspaceId, project.id, userId);
    const member = (await listProjectMembers(key.workspaceId, project.id)).find(
      (entry) => entry.id === userId
    );
    if (!member) throw new TacosError("Member not found after adding", 500);
    return Response.json(member, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
