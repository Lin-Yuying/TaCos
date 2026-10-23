import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import {
  countIssuesByStatus,
  getProject,
  isFavoriteProject,
  listIssues,
  listMembers,
  listProjectMembers,
} from "@/lib/issues";
import { ProjectWorkspace } from "@/components/project-workspace";
import type { ProjectTab } from "@/components/project-header";

// Both the project route and its legacy /issues sub-route render this, so the
// Overview/Issues pills can switch in place instead of navigating.
export async function ProjectPage({
  params,
  initialTab,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
  initialTab: ProjectTab;
}) {
  await connection();
  const { workspaceId, projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);

  const project = await getProject(workspaceId, projectId);
  if (!project) redirect(`/${workspaceId}`);

  const [counts, members, projectMembers, issues, favorite] = await Promise.all([
    countIssuesByStatus(workspaceId, project.id),
    listMembers(workspaceId),
    listProjectMembers(workspaceId, project.id),
    listIssues(workspaceId, { projectId: project.id }),
    isFavoriteProject(workspaceId, user.id, project.id),
  ]);

  return (
    // Keyed by project: the tab, the star and the filters are per-project state, and
    // jumping between projects in the sidebar would otherwise carry them over.
    <ProjectWorkspace
      key={project.id}
      workspaceId={workspaceId}
      project={project}
      counts={counts}
      members={projectMembers}
      workspaceMembers={members}
      issues={issues}
      initialTab={initialTab}
      initialFavorite={favorite}
    />
  );
}
