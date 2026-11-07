import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listProjects } from "@/lib/issues";
import { listPageTree } from "@/lib/pages";
import { StartScreen } from "@/components/start-screen";

// Shown when no tab is open; it is not itself a tab, so closing the last tab lands here.
export default function StartPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <StartContent params={params} />
    </Suspense>
  );
}

async function StartContent({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  const [projects, pages] = await Promise.all([
    listProjects(workspaceId, user.id),
    listPageTree(workspaceId, user.id),
  ]);
  return (
    <StartScreen
      workspaceId={workspaceId}
      projects={projects}
      pages={pages}
    />
  );
}
