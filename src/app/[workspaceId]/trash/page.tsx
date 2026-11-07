import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listDeletedWorkspaces, listTrashedIssues, listTrashedProjects } from "@/lib/issues";
import { listTrashedPages } from "@/lib/pages";
import { TrashView } from "@/components/trash-view";

export default async function TrashPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await requireWorkspace(workspaceId);
  const [projects, issues, docs, deletedWorkspaces] = await Promise.all([
    listTrashedProjects(workspaceId, user.id),
    listTrashedIssues(workspaceId),
    listTrashedPages(workspaceId, user.id),
    listDeletedWorkspaces(user.id),
  ]);
  return (
    <>
      <TrashView
        deletedWorkspaces={deletedWorkspaces}
        workspaceId={workspaceId}
        userId={user.id}
        isOwner={ctx.workspace.createdBy === user.id}
        projects={projects}
        issues={issues}
        docs={docs}
      />
    </>
  );
}
