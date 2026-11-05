import { Suspense } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import {
  getPage,
  listChildPages,
  listPageRefs,
  pageAuthor,
  isPageFavorite,
  pageAncestors,
  pageEmbedSources,
  pageLevel,
  pageLookup,
} from "@/lib/pages";
import { DocPageView } from "@/components/doc-page";

export default function DocPageRoute({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <DocContent params={params} />
    </Suspense>
  );
}

async function DocContent({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>;
}) {
  await connection();
  const { workspaceId, pageId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);

  const page = await getPage(workspaceId, pageId, user.id);
  if (!page) notFound();

  const [subpages, refs, embeds, author, level, ancestors, favorite] = await Promise.all([
    listChildPages(workspaceId, page.id, user.id),
    listPageRefs(workspaceId, user.id),
    pageEmbedSources(workspaceId, user.id, page.doc),
    pageAuthor(page.createdBy),
    pageLevel(page, user.id),
      pageAncestors(workspaceId, page, user.id),
      isPageFavorite(page.id, user.id),
  ]);

  return (
    <DocPageView
      key={page.id}
      workspaceId={workspaceId}
      page={page}
      author={author}
      level={level ?? "view"}
      ancestors={ancestors}
      favorite={favorite}
      isOwner={page.createdBy === user.id}
      viewerId={user.id}
      subpages={subpages}
      ctx={{ lookup: pageLookup(refs), base: `/${workspaceId}/docs/`, embeds }}
      refs={refs}
    />
  );
}
