import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { aggregateInsights, buildInsightsCsv, insightExportName, resolveInsightRequest } from "@/lib/insights";
import { insightQuery } from "@/lib/insights.shared";
import { TacosError } from "@/lib/tacos-error";

/**
 * CSV export of the current report table. It resolves the same URL params and saved
 * view as the page, runs the same aggregation and visibility checks, then serializes
 * exactly `data.rows`, so the file cannot contain a task the viewer cannot see.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) {
    return new Response("Sign in required", { status: 401 });
  }
  try {
    await requireWorkspace(workspaceId);
  } catch (error) {
    const status = error instanceof TacosError ? error.status : 500;
    return new Response(status === 403 ? "Forbidden" : "Workspace not found", { status });
  }
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const now = new Date().toISOString();
  const resolved = await resolveInsightRequest(workspaceId, user.id, query, { now });
  const data = await aggregateInsights(workspaceId, user.id, resolved.config, {
    timeZone: resolved.timeZone,
    now,
  });
  // The BOM keeps Excel on Windows from mangling non-ASCII task titles.
  const csv = `\uFEFF${buildInsightsCsv(data)}`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${insightExportName(data)}"`,
      "Cache-Control": "no-store",
      // Keep the report URL usable as the export link without another lookup.
      "X-Insight-Query": insightQuery(resolved.config),
    },
  });
}
