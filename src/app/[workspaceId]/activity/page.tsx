import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listMembers, listProjects } from "@/lib/issues";
import { listWorkspaceActivity, type ActivityObjectType, type ActivityScope } from "@/lib/activity";
import { ActivityView } from "@/components/activity-view";

const SCOPES: ActivityScope[] = ["all", "mine", "following"];
const TYPES: ActivityObjectType[] = ["task", "document", "project"];

export default async function ActivityPage({
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
  await requireWorkspace(workspaceId);

  const rawScope = typeof query.scope === "string" ? query.scope : "";
  const scope: ActivityScope = SCOPES.includes(rawScope as ActivityScope)
    ? (rawScope as ActivityScope)
    : "all";
  const rawType = typeof query.type === "string" ? query.type : "";
  const objectType = TYPES.includes(rawType as ActivityObjectType)
    ? (rawType as ActivityObjectType)
    : "";
  const [page, projects, members] = await Promise.all([
    listWorkspaceActivity(workspaceId, user.id, {
      scope,
      objectType: objectType || undefined,
      projectId: typeof query.project === "string" ? query.project : undefined,
      personId: typeof query.person === "string" ? query.person : undefined,
    }),
    listProjects(workspaceId, user.id),
    listMembers(workspaceId),
  ]);
  return (
    <>
      <ActivityView
        workspaceId={workspaceId}
        initialPage={page}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          color: project.color,
          icon: project.icon,
        }))}
        members={members}
        initialScope={scope}
        initialType={objectType}
        initialProject={typeof query.project === "string" ? query.project : ""}
        initialPerson={typeof query.person === "string" ? query.person : ""}
      />
    </>
  );
}
