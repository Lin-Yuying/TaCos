import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  requireApiKey,
} from "@/lib/api-auth";
import { assertSeesIssue, claimIssue, releaseIssue } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

// The key acts for the person who owns it: the claim is theirs, the event names the key.
export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const claim = await claimIssue(key.workspaceId, id, key.createdBy, apiActor(key));
    return Response.json(claim);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const claim = await releaseIssue(key.workspaceId, id, key.createdBy, apiActor(key));
    return Response.json(claim);
  } catch (err) {
    return errorResponse(err);
  }
}
