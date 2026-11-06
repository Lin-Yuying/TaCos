import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  requireApiKey,
} from "@/lib/api-auth";
import { dependencyPayload } from "@/lib/api-issues";
import { assertSeesIssue, removeDependency } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string; depId: string }> };

// `depId` is the blocking task's id or identifier, not a link id.
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id, depId } = await ctx.params;
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    await assertSeesIssue(key.workspaceId, depId, key.createdBy);
    await assertKeyIssueProject(key, depId);
    const detail = await removeDependency(
      key.workspaceId,
      id,
      depId,
      key.createdBy,
      apiActor(key)
    );
    return Response.json(dependencyPayload(detail));
  } catch (err) {
    return errorResponse(err);
  }
}
