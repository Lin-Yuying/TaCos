import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listPages } from "@/lib/pages";
import { DocsIndex } from "@/components/docs-index";

export default function DocsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
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
  const pages = await listPages(workspaceId, user.id);
  return <DocsIndex workspaceId={workspaceId} userId={user.id} pages={pages} />;
}
