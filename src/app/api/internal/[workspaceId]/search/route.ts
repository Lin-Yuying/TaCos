import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listIssues } from "@/lib/issues";

export async function GET(req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    await requireWorkspace(workspaceId);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json([]);
  const issues = await listIssues(workspaceId, { q, limit: 20 });
  return Response.json(issues);
}
