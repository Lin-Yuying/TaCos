import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { hasLiveAgentTurn } from "@/lib/agent-sessions";
import { getSessionUser } from "@/lib/auth";

// The desktop app asks before it offers to restart for an update: restarting ends the turn.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ busy: false });
  const [run] = await getDb()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.userId, user.id), eq(agentRuns.status, "running")))
    .limit(1);
  return Response.json({ busy: Boolean(run) || hasLiveAgentTurn(user.id) });
}
