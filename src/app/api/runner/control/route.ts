import { touchRunnerStatus, ownsRun, runCancelled, runnerUserFor } from "@/lib/runner/hub";

// Asked every two seconds while a run is going, so a Stop in the browser reaches the computer.
export async function GET(request: Request) {
  const userId = await runnerUserFor(request);
  if (!userId) return Response.json({ error: "Runner token is not valid" }, { status: 401 });
  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  if (!(await ownsRun(userId, runId))) return Response.json({ error: "Not your run" }, { status: 403 });
  await touchRunnerStatus(userId);
  return Response.json({ cancelled: runCancelled(runId) });
}
