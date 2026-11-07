import {
  assertKeyProjectId,
  errorResponse,
  requireApiKey,
} from "@/lib/api-auth";
import {
  assertSeesIssue,
  findTrashedIssueRow,
  getProject,
  restoreIssue,
  TacosError,
} from "@/lib/issues";
import { apiActor } from "@/lib/api-auth";

type Ctx = { params: Promise<{ id: string }> };

// Restores a task from the Trash. `{id}` accepts the id or the identifier it had
// before it was deleted.
export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const row = await findTrashedIssueRow(key.workspaceId, id);
    if (!row) throw new TacosError(`Issue "${id}" is not in the trash`, 404);
    const project = await getProject(key.workspaceId, row.projectId);
    assertKeyProjectId(key, row.projectId, project?.key ?? row.projectId);
    await assertSeesIssue(key.workspaceId, row.id, key.createdBy);
    const restored = await restoreIssue(key.workspaceId, row.id, apiActor(key));
    return Response.json({ restored });
  } catch (err) {
    return errorResponse(err);
  }
}
