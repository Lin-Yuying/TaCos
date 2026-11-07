import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listPageMetadata } from "@/lib/pages";
import { listUnresolvedPageLinks, pageLinkCounts } from "@/lib/page-links";
import { DocsIndex } from "@/components/docs-index";

export default function DocsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <DocsContent params={params} />
    </Suspense>
  );
}

async function DocsContent({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  const [pages, unresolvedLinks, backlinkCounts] = await Promise.all([
    listPageMetadata(workspaceId, user.id),
    listUnresolvedPageLinks(workspaceId, user.id),
    pageLinkCounts(workspaceId, user.id),
  ]);
  return (
    <DocsIndex
      workspaceId={workspaceId}
      pages={pages}
      unresolvedLinks={unresolvedLinks}
      backlinkCounts={backlinkCounts}
    />
  );
}
