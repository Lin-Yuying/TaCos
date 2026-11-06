import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import { dependencyPayload } from "@/lib/api-issues";
import { addDependency, assertSeesIssue } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    if (typeof body.blockedBy !== "string" || !body.blockedBy.trim()) {
      return Response.json(
        { error: "blockedBy is required", hint: 'Send {"blockedBy": "CORE-3"}' },
        { status: 400 }
      );
    }
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    await assertSeesIssue(key.workspaceId, body.blockedBy, key.createdBy);
    await assertKeyIssueProject(key, body.blockedBy);
    const detail = await addDependency(
      key.workspaceId,
      id,
      body.blockedBy,
      key.createdBy,
      apiActor(key)
    );
    return Response.json(dependencyPayload(detail));
  } catch (err) {
    return errorResponse(err);
  }
}
