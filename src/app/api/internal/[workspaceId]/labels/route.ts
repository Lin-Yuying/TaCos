import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listLabels } from "@/lib/issues";

export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    await requireWorkspace(workspaceId);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(await listLabels(workspaceId));
}
