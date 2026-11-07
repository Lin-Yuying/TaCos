import { queryTaskView } from "@/lib/task-query";
import { EMPTY_VIEW, type FieldValues } from "@/lib/task-view";
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
import { listFieldValues, listTaskFields } from "@/lib/task-fields";
import type { ProjectTab } from "@/components/project-header";
import { defaultTaskView, getTaskView, type TaskViewSummary } from "@/lib/task-views";
import { listProjectMilestones, type Milestone } from "@/lib/planning/milestones";

// Both the project route and its legacy /issues sub-route render this, so the
// Overview/Tasks pills can switch in place instead of navigating.
export async function ProjectPage({
  params,
  initialTab,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
  initialTab: ProjectTab;
  searchParams?: Promise<Record<string,string|string[]|undefined>>;
}) {
  await connection();
  const { workspaceId, projectId } = await params;
  const sp=await searchParams;
  const selected=sp?.tab;
  if(selected==="overview"||selected==="issues"||selected==="documents"||selected==="timeline")initialTab=selected;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);

  const project = await getProject(workspaceId, projectId, user.id);
  if (!project) redirect(`/${workspaceId}`);

  const access=await getOverviewAccess(workspaceId,project.id,user.id);
  if(!access.canView)initialTab="issues";

  const taskQuery={projectId:project.id,status:typeof sp?.status==="string"&&["todo","in_progress","done","canceled"].includes(sp.status)?sp.status as "todo":undefined,q:typeof sp?.q==="string"?sp.q:undefined};
  // ?viewId= or the project's default view decides the filters the list opens with.
  const requestedViewId = typeof sp?.viewId === "string" ? sp.viewId : "";
  let activeView: TaskViewSummary | null = null;
  if (requestedViewId) {
    try {
      activeView = getTaskView(workspaceId, user.id, requestedViewId);
      if (activeView.scope === "project" && activeView.projectId !== project.id) {
        activeView = null;
      }
    } catch {
      activeView = null;
    }
  }
  if (!activeView) activeView = defaultTaskView(workspaceId, user.id, "project", project.id);
  const viewDefinition = activeView
    ? {
        filters: activeView.definition.filters,
        sort: activeView.definition.sort,
        display: activeView.definition.display,
      }
    : EMPTY_VIEW;
  const taskPage=initialTab==="issues"?await queryTaskView(workspaceId,user.id,taskQuery,viewDefinition):undefined;
  // When the owner turns off workspace-wide task visibility, a member outside this
  // project cannot open it — the same check the sidebar and lists use.
  const [visible, counts, members, projectMembers, issues, favorite, documents] =
    await Promise.all([
      listProjects(workspaceId, user.id),
      countIssuesByStatus(workspaceId, project.id, user.id),
      listMembers(workspaceId),
      listProjectMembers(workspaceId, project.id),
      initialTab==="overview" ? listIssues(workspaceId, { projectId: project.id, viewerId: user.id,summary:true }) : initialTab==="timeline" ? listIssues(workspaceId, { projectId: project.id, viewerId: user.id, status: "all", summary: true, limit: 500 }) : Promise.resolve(taskPage?.items??[]),
      isFavoriteProject(workspaceId, user.id, project.id),
      listProjectPageTree(workspaceId, project.id, user.id),
    ]);
  if (!visible.some((candidate) => candidate.id === project.id)) {
    redirect(`/${workspaceId}`);
  }

  const [fields, fieldValues, milestones]: [Awaited<ReturnType<typeof listTaskFields>>, FieldValues, Milestone[]] = await Promise.all([
    initialTab==="issues" ? listTaskFields(workspaceId) : Promise.resolve([]),
    Promise.resolve(taskPage?.values??{}),
    initialTab==="timeline" ? listProjectMilestones(workspaceId, project.id) : Promise.resolve([]),
  ]);

  const [grants, comments, edits, unseenDocEdits, resources, trashedTitles, pageRefs, embeds]: [
    OverviewGrant[],
    OverviewComment[],
    OverviewDocEdit[],
    number,
    ProjectResource[],
    Record<string, string>,
    Awaited<ReturnType<typeof listPageRefs>>,
    Record<string, string>,
  ] = access.canView && initialTab==="overview"
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
      taskQuery={taskQuery}
      taskPage={taskPage}
      initialView={activeView}
      fields={fields}
      fieldValues={fieldValues}
      key={project.id}
      workspaceId={workspaceId}
      project={access.canView?project:{...project,doc:""}}
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
      milestones={milestones}
    />
  );
}
