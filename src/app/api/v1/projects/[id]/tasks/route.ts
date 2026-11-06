import { assertKeyProject, errorResponse, requireApiKey } from "@/lib/api-auth";
import { issueListResponse } from "@/lib/api-issues";
import { assertSeesProject } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

// Same filters and page headers as GET /api/v1/issues, pinned to this project.
export async function GET(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const project = await assertKeyProject(key, id);
    await assertSeesProject(key.workspaceId, project.id, key.createdBy);
    return await issueListResponse(req, key, project);
  } catch (err) {
    return errorResponse(err);
  }
}
