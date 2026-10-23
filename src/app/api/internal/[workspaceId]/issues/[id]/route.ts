import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { getIssueDetail, PRIORITY_NAMES } from "@/lib/issues";
import { TacosError } from "@/lib/issues";

type Ctx = { params: Promise<{ workspaceId: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { workspaceId, id } = await ctx.params;
  try {
    await requireWorkspace(workspaceId);
    const detail = await getIssueDetail(workspaceId, id);
    if (!detail) throw new TacosError("Not found", 404);
    return Response.json({
      ...detail.issue,
      priorityLabel: PRIORITY_NAMES[detail.issue.priority],
      comments: detail.comments,
      events: detail.events,
    });
  } catch (err) {
    if (err instanceof TacosError && err.status === 401) {
      const user = await getSessionUser();
      if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
    }
    if (err instanceof TacosError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
