import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { TacosError } from "@/lib/issues";
import {
  getPage,
  listChildPages,
  listPageRefs,
  pageAuthor,
  pageEmbedSources,
  pageLevel,
  pageLookup,
} from "@/lib/pages";

type Ctx = { params: Promise<{ workspaceId: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { workspaceId, id } = await ctx.params;
  try {
    const { user } = await requireWorkspace(workspaceId);
    const page = await getPage(workspaceId, id, user.id);
    if (!page) throw new TacosError("Not found", 404);

    const [subpages, refs, embeds, author, level] = await Promise.all([
      listChildPages(workspaceId, page.id, user.id),
      listPageRefs(workspaceId, user.id),
      pageEmbedSources(workspaceId, user.id, page.doc),
      pageAuthor(page.createdBy),
      pageLevel(page, user.id),
    ]);

    return Response.json({
      page,
      author,
      level: level ?? "view",
      isOwner: page.createdBy === user.id,
      viewerId: user.id,
      subpages,
      refs,
      ctx: { lookup: pageLookup(refs), base: `/${workspaceId}/docs/`, embeds },
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
