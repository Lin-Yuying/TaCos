import { waitForAgentApproval } from "@/lib/agent-sessions";
import { ownsRun, runTurnApproved, runnerUserFor } from "@/lib/runner/hub";

const PENDING_AFTER_MS = 240_000;

// A harness's own permission request (Codex). The card already reached the browser as an event;
// this waits for the person's answer.
export async function POST(request: Request) {
  const userId = await runnerUserFor(request);
  if (!userId) return Response.json({ error: "Runner token is not valid" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { runId?: string; requestId?: string } | null;
  if (!body?.runId || !body.requestId) {
    return Response.json({ error: "runId and requestId are required" }, { status: 400 });
  }
  if (!(await ownsRun(userId, body.runId))) return Response.json({ error: "Not your run" }, { status: 403 });
  // A fetch gives up on a silent server after five minutes, and a person may take longer.
  const expired = AbortSignal.timeout(PENDING_AFTER_MS);
  const decision = await waitForAgentApproval(body.requestId, { signal: AbortSignal.any([request.signal, expired]) });
  if (expired.aborted) return Response.json({ pending: true });
  return Response.json({ decision, turnApproved: runTurnApproved(body.runId) });
}
