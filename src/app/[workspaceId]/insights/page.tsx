import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listLabels, listMembers, listProjects } from "@/lib/issues";
import { aggregateInsights, resolveInsightTimeZone, zoneDayOf } from "@/lib/insights";
import {
  defaultInsightConfig,
  type InsightStatusFilter,
} from "@/lib/insights.shared";
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

  const read = (key: string): string | undefined =>
    typeof query[key] === "string" ? (query[key] as string) : undefined;
  const timeZone = resolveInsightTimeZone();
  const now = new Date().toISOString();
  const today = zoneDayOf(now, timeZone);
  const status = read("status");
  const [data, projects, members, labels] = await Promise.all([
    aggregateInsights(
      workspaceId,
      user.id,
      {
        from: read("from"),
        to: read("to"),
        projectId: read("project"),
        assigneeId: read("assignee"),
        label: read("label"),
        status: (["all", "active", "done", "canceled"] as string[]).includes(status ?? "")
          ? (status as InsightStatusFilter)
          : "all",
      },
      { timeZone, now }
    ),
    listProjects(workspaceId, user.id),
    listMembers(workspaceId),
    listLabels(workspaceId),
  ]);

  return (
    <InsightsView
      workspaceId={workspaceId}
      data={data}
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
      defaults={defaultInsightConfig(today)}
    />
  );
}
