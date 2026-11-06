import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listMembers, listProjects, type Status } from "@/lib/issues";
import { ListHeader } from "@/components/list-header";
import { IssueLayout } from "@/components/issue-layout";
import { queryTaskView,type TaskQuery } from "@/lib/task-query";
import { defaultTaskView, getTaskView, type TaskViewSummary } from "@/lib/task-views";
import { EMPTY_VIEW } from "@/lib/task-view";

type View = "all" | "active" | "open" | "my" | "unassigned" | "agent" | Status;

export default async function WorkspaceIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <IssuesView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function IssuesView({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const label = typeof sp.label === "string" ? sp.label : "";
  const projectId = typeof sp.project === "string" ? sp.project : undefined;
  const assigneeParam = typeof sp.assignee === "string" ? sp.assignee : undefined;

  const projects = await listProjects(workspaceId, user.id);
  const [project] = projectId
    ? projects.filter((p) => p.id === projectId || p.key.toUpperCase() === projectId.toUpperCase())
    : [undefined];

  // ?assignee=<user id> comes from the sidebar's member list; me/none are shortcuts.
  const members = await listMembers(workspaceId);
  const assigneeMember =
    assigneeParam && assigneeParam !== "me" && assigneeParam !== "none"
      ? members.find((m) => m.id === assigneeParam)
      : undefined;

  const query:TaskQuery = {
    status:
      view === "active"
        ? "active"
        : view === "open"
          ? "open"
        : view === "todo" || view === "in_progress" || view === "done" || view === "canceled"
          ? (view as Status)
          : undefined,
    q: q || undefined,
    label: label || undefined,
    projectId: project?.id,
    assigneeId:
      assigneeParam === "me"
        ? user.id
        : assigneeParam === "none"
          ? null
          : (assigneeMember?.id ?? undefined),
    agent: view === "agent",
  };
  // ?viewId= opens a saved view; without one the scope default (if a manager chose
  // one) applies. Personal views keep their own saved definition from the menu.
  const requestedViewId = typeof sp.viewId === "string" ? sp.viewId : "";
  let activeView: TaskViewSummary | null = null;
  if (requestedViewId) {
    try {
      activeView = getTaskView(workspaceId, user.id, requestedViewId);
    } catch {
      activeView = null;
    }
  }
  if (!activeView) activeView = defaultTaskView(workspaceId, user.id, "workspace");
  const viewDefinition = activeView
    ? {
        filters: activeView.definition.filters,
        sort: activeView.definition.sort,
        display: activeView.definition.display,
      }
    : EMPTY_VIEW;
  const result=await queryTaskView(workspaceId,user.id,query,viewDefinition);
  const issues=result.items;

  const {fields,values}=result;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ListHeader
        view={view === "all" || view === "active" || view === "open" || view === "agent" ? view : (view as Status)}
        q={q}
        label={label}
        count={result.total}
        projectParam={project?.id ?? projectId}
        projectName={project?.name}
        assigneeParam={assigneeParam}
        assigneeName={assigneeParam === "me" ? user.displayName : assigneeMember?.displayName}
      />
      <IssueLayout
        key={activeView?.id ?? "no-view"}
        serverQuery={query}
        initialPage={result}
        issues={issues}
        workspaceId={workspaceId}
        currentUserId={user.id}
        fields={fields}
        values={values}
        manageFields
        scope="workspace"
        initialView={activeView}
      />
    </div>
  );
}
