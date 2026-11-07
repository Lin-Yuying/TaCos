import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db/client";
import { cycles, workspaceMembers } from "@/db/schema";
import { cycleCalendar } from "@/lib/planning/cycles";

/**
 * U-03 optional calendar subscription: one .ics event per cycle, readable by the
 * signed-in member who can open that workspace. No feed token, no Google sync.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { cycleId } = await params;
  const db = getDb();
  const [cycle] = db
    .select({
      id: cycles.id,
      workspaceId: cycles.workspaceId,
      name: cycles.name,
      startsAt: cycles.startsAt,
      endsAt: cycles.endsAt,
    })
    .from(cycles)
    .where(eq(cycles.id, cycleId))
    .limit(1)
    .all();
  if (!cycle) return new Response("Cycle not found", { status: 404 });
  const [member] = db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, cycle.workspaceId), eq(workspaceMembers.userId, user.id))
    )
    .limit(1)
    .all();
  if (!member) return new Response("Cycle not found", { status: 404 });
  const filename = `${cycle.name.replaceAll(/[^a-zA-Z0-9-_]+/g, "-")}.ics`;
  return new Response(cycleCalendar(cycle), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
