import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import {
  countIssuesByStatus,
  countUnseenDocEdits,
  getOverviewAccess,
  getProject,
  isFavoriteProject,
  listIssues,
  listMembers,
  listOverviewComments,
  listOverviewDocEdits,
  listOverviewGrants,
  listProjectMembers,
  listProjects,
  trashedIssueTitles,
  type OverviewComment,
  type OverviewDocEdit,
  type OverviewGrant,
} from "@/lib/issues";
import { ProjectWorkspace } from "@/components/project-workspace";
import { referencedIssueIds } from "@/lib/markdown";
import {
  listPageRefs,
  listProjectPageTree,
  pageEmbedSources,
  pageLookup,
} from "@/lib/pages";
import type { PageContext } from "@/components/markdown";
import { listProjectResources, type ProjectResource } from "@/lib/resources";
import type { ProjectTab } from "@/components/project-header";

// Both the project route and its legacy /issues sub-route render this, so the
// Overview/Tasks pills can switch in place instead of navigating.
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

  // When the owner turns off workspace-wide task visibility, a member outside this
  // project cannot open it — the same check the sidebar and lists use.
  const [visible, counts, members, projectMembers, issues, favorite, access, documents] =
    await Promise.all([
      listProjects(workspaceId, user.id),
      countIssuesByStatus(workspaceId, project.id, user.id),
      listMembers(workspaceId),
      listProjectMembers(workspaceId, project.id),
      listIssues(workspaceId, { projectId: project.id, viewerId: user.id }),
      isFavoriteProject(workspaceId, user.id, project.id),
      getOverviewAccess(workspaceId, project.id, user.id),
      listProjectPageTree(workspaceId, project.id, user.id),
    ]);
  if (!visible.some((candidate) => candidate.id === project.id)) {
    redirect(`/${workspaceId}`);
  }

  const [grants, comments, edits, unseenDocEdits, resources, trashedTitles, pageRefs, embeds]: [
    OverviewGrant[],
    OverviewComment[],
    OverviewDocEdit[],
    number,
    ProjectResource[],
    Record<string, string>,
    Awaited<ReturnType<typeof listPageRefs>>,
    Record<string, string>,
  ] = access.canView
    ? await Promise.all([
        listOverviewGrants(workspaceId, project.id),
        listOverviewComments(workspaceId, project.id),
        listOverviewDocEdits(workspaceId, project.id),
        countUnseenDocEdits(project.id, user.id),
        listProjectResources(workspaceId, project.id, user.id),
        trashedIssueTitles(workspaceId, referencedIssueIds(project.doc)),
        // Same context the docs pages build, so `[[…]]` and `![[…]]` typed into the
        // Overview resolve to the documents the reader may open.
        listPageRefs(workspaceId, user.id),
        pageEmbedSources(workspaceId, user.id, project.doc),
      ])
    : [[], [], [], 0, [], {}, [], {}];
  const pages: PageContext = {
    lookup: pageLookup(pageRefs),
    base: `/${workspaceId}/docs/`,
    embeds,
  };

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
      documents={documents}
      pages={pages}
      currentUserId={user.id}
      initialTab={access.canView ? initialTab : "issues"}
      initialFavorite={favorite}
      access={access}
      grants={grants}
      comments={comments}
      edits={edits}
      unseenDocEdits={unseenDocEdits}
      resources={resources}
      trashedTitles={trashedTitles}
    />
  );
}
