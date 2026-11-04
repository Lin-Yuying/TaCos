import { ownsRun, pushRunEvents, runCancelled, runnerUserFor } from "@/lib/runner/hub";
import type { RunEvents } from "@/lib/runner/protocol";

export async function POST(request: Request) {
  const userId = await runnerUserFor(request);
  if (!userId) return Response.json({ error: "Runner token is not valid" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as RunEvents | null;
  if (!body?.runId || !Array.isArray(body.events)) {
    return Response.json({ error: "runId and events are required" }, { status: 400 });
  }
  if (!(await ownsRun(userId, body.runId))) return Response.json({ error: "Not your run" }, { status: 403 });
  pushRunEvents(body.runId, body.events);
  return Response.json({ cancelled: runCancelled(body.runId) });
}
