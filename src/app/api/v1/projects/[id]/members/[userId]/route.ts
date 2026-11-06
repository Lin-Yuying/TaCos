import { assertKeyProject, errorResponse, requireApiKey } from "@/lib/api-auth";
import {
  assertSeesProject,
  listProjectMembers,
  removeProjectMember,
  resolveAssigneeId,
  TacosError,
} from "@/lib/issues";

type Ctx = { params: Promise<{ id: string; userId: string }> };

// The path segment accepts a member id, username or display name, like `assignee` does.
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id, userId } = await ctx.params;
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    const resolvedId = await resolveAssigneeId(key.workspaceId, userId);
    const member = (await listProjectMembers(key.workspaceId, project.id)).find(
      (entry) => entry.id === resolvedId
    );
    if (!member) {
      throw new TacosError(`"${userId}" is not a member of project "${project.key}"`, 404);
    }
    await removeProjectMember(key.workspaceId, project.id, member.id);
    return Response.json({ removed: member });
  } catch (err) {
    return errorResponse(err);
  }
}
