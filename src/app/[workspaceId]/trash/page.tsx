import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listTrashedIssues, listTrashedProjects } from "@/lib/issues";
import { TrashView } from "@/components/trash-view";

export default async function TrashPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  const [projects, issues] = await Promise.all([
    listTrashedProjects(workspaceId),
    listTrashedIssues(workspaceId),
  ]);
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-[14px] font-semibold">Trash</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          {projects.length + issues.length}
        </span>
      </header>
      <TrashView
        workspaceId={workspaceId}
        userId={user.id}
        projects={projects}
        issues={issues}
      />
    </>
  );
}
