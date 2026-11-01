import { requireWorkspace } from "@/lib/auth";
import { getAgentThread } from "@/lib/agent-threads";
import { answerAgentApproval, markTurnAutoApprove, type ApprovalDecision } from "@/lib/agent-sessions";
import { TacosError } from "@/lib/issues";

// The Browser's Allow / Deny card posts here. The pending write has already been paused
// in this process; answering it releases Codex to run the tool call (or not). Choosing
// "Allow for this turn" also stops the cards for the rest of that turn.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      workspaceId?: string;
      threadId?: string;
      requestId?: string;
      decision?: string;
    };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const threadId = typeof body.threadId === "string" ? body.threadId : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!workspaceId || !threadId || !requestId) {
      throw new TacosError("workspaceId, threadId and requestId are required", 400);
    }
    const wholeTurn = body.decision === "accept-turn";
    const decision: ApprovalDecision = body.decision === "accept" || wholeTurn ? "accept" : "decline";
    const access = await requireWorkspace(workspaceId);
    // Only someone who can read this conversation may answer its permission cards.
    await getAgentThread(workspaceId, access.user.id, threadId);
    // Marked before the wait is released: the next tool call can arrive immediately.
    const marked = wholeTurn && markTurnAutoApprove(threadId, access.user.id);
    if (!answerAgentApproval(requestId, decision)) {
      throw new TacosError("That request is no longer waiting for an answer", 404);
    }
    return Response.json({ ok: true, decision, turnApproved: Boolean(marked) });
  } catch (err) {
    const status = err instanceof TacosError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Could not answer the request";
    return Response.json({ error: message }, { status });
  }
}
