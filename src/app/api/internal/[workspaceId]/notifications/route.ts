import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listNotifications, unreadNotificationCount } from "@/lib/issues";

export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const ws = await requireWorkspace(workspaceId);
    const [unread, items] = await Promise.all([
      unreadNotificationCount(workspaceId, ws.user.id),
      listNotifications(workspaceId, ws.user.id),
    ]);
    return Response.json({ unread, items });
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
}
