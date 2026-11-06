import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import { assertSeesIssue, reviewIssue, type ReviewDecision } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

function parseDecision(value: unknown): ReviewDecision | null {
  if (value === "approved" || value === "approve") return "approve";
  if (value === "rejected" || value === "reject") return "reject";
  return null;
}

// Only a task waiting for review can change. The reviewer is the person the key
// belongs to; the activity event names the key.
export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    const decision = parseDecision(body.state ?? body.decision);
    if (!decision) {
      return Response.json(
        {
          error: "state must be approved or rejected",
          hint: 'Send {"state": "approved"} or {"state": "rejected"}',
        },
        { status: 400 }
      );
    }
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const review = await reviewIssue(
      key.workspaceId,
      id,
      key.createdBy,
      decision,
      apiActor(key)
    );
    return Response.json(review);
  } catch (err) {
    return errorResponse(err);
  }
}
