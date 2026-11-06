import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { search } from "@/lib/search";
import { isSearchGroup, isSearchSort, type SearchFilters } from "@/lib/search-query";
import { STATUS_ORDER, type Status } from "@/lib/constants";

function dateParam(value: string | null): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isNaN(Date.parse(value))
    ? value
    : undefined;
}

function statusParam(value: string | null): Status | undefined {
  return value && (STATUS_ORDER as readonly string[]).includes(value)
    ? (value as Status)
    : undefined;
}

export async function GET(req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    await requireWorkspace(workspaceId);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (!q) {
    return Response.json({ hits: [], total: 0, counts: {}, tookMs: 0, group: "all", query: "" });
  }
  const filters: SearchFilters = {
    projectId: params.get("project")?.trim() || undefined,
    assignee: params.get("assignee")?.trim() || undefined,
    status: statusParam(params.get("status")),
    createdFrom: dateParam(params.get("createdFrom")),
    createdTo: dateParam(params.get("createdTo")),
    updatedFrom: dateParam(params.get("updatedFrom")),
    updatedTo: dateParam(params.get("updatedTo")),
  };
  const rawLimit = Number(params.get("limit") ?? 20);
  const rawOffset = Number(params.get("offset") ?? 0);
  const rawPer = Number(params.get("per"));
  const group = params.get("kind");
  const sort = params.get("sort");
  try {
    const result = await search(workspaceId, user.id, q, {
      group: isSearchGroup(group) ? group : "all",
      sort: isSearchSort(sort) ? sort : "relevance",
      filters,
      limit: Number.isFinite(rawLimit) ? rawLimit : 20,
      offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
      perKindLimit: Number.isFinite(rawPer) && rawPer > 0 ? rawPer : undefined,
      includeCounts: params.get("counts") !== "0",
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Search failed. Retry." }, { status: 500 });
  }
}
