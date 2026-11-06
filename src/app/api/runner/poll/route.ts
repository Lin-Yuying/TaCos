import { claimRun, recordRunnerStatus, runnerUserFor } from "@/lib/runner/hub";
import type { RunnerCapabilities } from "@/lib/runner/protocol";

// Outbound from the member's computer: the server never connects to it.
export async function POST(request: Request) {
  const userId = await runnerUserFor(request);
  if (!userId) return Response.json({ error: "Runner token is not valid" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { capabilities?: RunnerCapabilities;slots?:number } | null;
  if (!body?.capabilities) return Response.json({ error: "Capabilities are required" }, { status: 400 });
  await recordRunnerStatus(userId, body.capabilities);
  const run = await claimRun(userId, request.signal,body.slots);
  return Response.json({ run });
}
