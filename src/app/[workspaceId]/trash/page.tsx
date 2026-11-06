import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { translator } from "@/lib/i18n";
import { resolveLocale } from "@/lib/locale";
import { listTrashedIssues, listTrashedProjects } from "@/lib/issues";
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
  const [projects, issues, docs] = await Promise.all([
    listTrashedProjects(workspaceId, user.id),
    listTrashedIssues(workspaceId),
    listTrashedPages(workspaceId, user.id),
  ]);
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-body font-semibold">{translator(await resolveLocale(user))("Trash")}</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
          {projects.length + issues.length + docs.length}
        </span>
      </header>
      <TrashView
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
