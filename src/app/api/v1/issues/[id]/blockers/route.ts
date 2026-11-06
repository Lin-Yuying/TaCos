import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import { assertSeesIssue, reportBlocker } from "@/lib/issues";

type Ctx = { params: Promise<{ id: string }> };

// The report is attributed to the key; its author is the person the key belongs to.
export async function POST(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    if (typeof body.body !== "string" || !body.body.trim()) {
      return Response.json(
        { error: "body is required", hint: "Say what is blocking this task" },
        { status: 400 }
      );
    }
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const blocker = await reportBlocker(key.workspaceId, id, body.body, apiActor(key), {
      reportedById: key.createdBy,
    });
    return Response.json(blocker, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
