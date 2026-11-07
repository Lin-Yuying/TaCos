import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listIssues, listLabels, listProjects } from "@/lib/issues";
import {
  getCycleDetail,
  getCycleSettings,
  listCycles,
  planningMembers,
  syncCycleLifecycle,
} from "@/lib/planning/cycles";
import {
  buildRoadmap,
  listInitiatives,
  listWorkspaceMilestones,
  projectViewsForRoadmap,
} from "@/lib/planning/initiatives";
import { PlanningView, type PlanningTab } from "@/components/planning-view";

const TABS: PlanningTab[] = ["cycles", "roadmap", "initiatives"];

export default async function PlanningPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ListSkeleton />}>
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
  const ctx = await requireWorkspace(workspaceId);
  const rawTab = typeof query.tab === "string" ? query.tab : "cycles";
  const tab: PlanningTab = (TABS as string[]).includes(rawTab) ? (rawTab as PlanningTab) : "cycles";

  // Lazy lifecycle: create the configured upcoming cycles, close the ones whose dates
  // passed and roll unfinished work forward once. No background job.
  await syncCycleLifecycle(workspaceId, { actorId: user.id });

  const [settings, cycles, members, projects, labels] = await Promise.all([
    getCycleSettings(workspaceId),
    listCycles(workspaceId),
    planningMembers(workspaceId),
    listProjects(workspaceId, user.id),
    listLabels(workspaceId),
  ]);
  const requestedCycle = typeof query.cycle === "string" ? query.cycle : "";
  const selectedCycleId =
    (cycles.some((cycle) => cycle.id === requestedCycle) ? requestedCycle : "") ||
    cycles.find((cycle) => cycle.status === "active")?.id ||
    cycles.find((cycle) => cycle.status === "upcoming")?.id ||
    cycles.at(-1)?.id ||
    "";

  const [selectedCycle, candidates] = await Promise.all([
    tab === "cycles" && selectedCycleId
      ? getCycleDetail(workspaceId, selectedCycleId, user.id)
      : Promise.resolve(null),
    tab === "cycles"
      ? listIssues(workspaceId, {
          status: "active",
          cycleId: null,
          viewerId: user.id,
          summary: true,
          limit: 200,
        })
      : Promise.resolve([]),
  ]);

  let initiatives: Awaited<ReturnType<typeof listInitiatives>> = [];
  let projectViews: Awaited<ReturnType<typeof projectViewsForRoadmap>> = [];
  if (tab !== "cycles") {
    [initiatives, projectViews] = await Promise.all([
      listInitiatives(workspaceId, {}, user.id),
      projectViewsForRoadmap(workspaceId, user.id),
    ]);
  }
  const milestones =
    tab === "roadmap"
      ? await listWorkspaceMilestones(workspaceId, projectViews.map((project) => project.id))
      : [];
  const roadmap = tab === "roadmap" ? buildRoadmap(initiatives, projectViews, milestones) : [];

  return (
    <PlanningView
      workspaceId={workspaceId}
      tab={tab}
      isAdmin={ctx.role === "admin"}
      currentUserId={user.id}
      settings={settings}
      cycles={cycles}
      selectedCycle={selectedCycle}
      selectedCycleId={selectedCycleId}
      candidates={candidates}
      initiatives={initiatives}
      roadmap={roadmap}
      members={members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        avatar: member.avatar,
      }))}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        key: project.key,
        color: project.color,
        icon: project.icon,
      }))}
      labels={labels}
    />
  );
}
