import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listLabels, listMembers, listProjects } from "@/lib/issues";
import { aggregateInsights, resolveInsightRequest, resolveInsightTimeZone } from "@/lib/insights";
import { listInsightViews } from "@/lib/task-views";
import { InsightsView } from "@/components/insights/insights-view";

export default function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-body text-muted" data-testid="insights-page-loading">
          Loading…
        </div>
      }
    >
      <View params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function View({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { workspaceId } = await params;
  const query = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);

  const timeZone = resolveInsightTimeZone();
  const now = new Date().toISOString();
  const request = await resolveInsightRequest(workspaceId, user.id, query, { timeZone, now });
  const [data, projects, members, labels, savedViews] = await Promise.all([
    aggregateInsights(workspaceId, user.id, request.config, { timeZone: request.timeZone, now }),
    listProjects(workspaceId, user.id),
    listMembers(workspaceId),
    listLabels(workspaceId),
    Promise.resolve(listInsightViews(workspaceId, user.id)),
  ]);
  const viewNotice = request.notices.find((notice) => notice.kind === "view-unavailable");
  const dataWithNotices = viewNotice
    ? { ...data, notices: [viewNotice, ...data.notices] }
    : data;

  return (
    <InsightsView
      workspaceId={workspaceId}
      data={dataWithNotices}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
        icon: project.icon,
      }))}
      members={members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        avatar: member.avatar,
      }))}
      labels={labels.map((label) => ({ id: label.id, name: label.name, color: label.color }))}
      defaults={request.defaults}
      savedViews={savedViews.map((view) => ({ id: view.id, name: view.name }))}
      activeView={request.viewId ? { id: request.viewId, name: request.viewName ?? "" } : null}
    />
  );
}
