import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, listUserWorkspaces, requireWorkspace } from "@/lib/auth";
import {
  getJoinCode,
  listApiKeys,
  listDeletedWorkspaces,
  listMembers,
  listProjects,
} from "@/lib/issues";
import { SettingsView } from "@/components/settings-view";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ws = await requireWorkspace(workspaceId);
  const [members, projects, keys, joinCode, allWorkspaces, deletedWorkspaces] = await Promise.all([
    listMembers(workspaceId),
    listProjects(workspaceId),
    listApiKeys(workspaceId),
    getJoinCode(workspaceId),
    listUserWorkspaces(ws.user.id),
    listDeletedWorkspaces(ws.user.id),
  ]);
  // Where deleting this workspace lands you: the next team you belong to, or the
  // create/join screen when it was your last one.
  const next = allWorkspaces.find((other) => other.id !== workspaceId);
  return (
    <SettingsView
      workspace={ws.workspace}
      role={ws.role}
      currentUser={ws.user}
      members={members}
      projects={projects}
      keys={keys}
      joinCode={joinCode}
      isOwner={ws.workspace.createdBy === ws.user.id}
      nextWorkspaceHref={next ? `/${next.id}` : "/onboarding"}
      deletedWorkspaces={deletedWorkspaces}
    />
  );
}
