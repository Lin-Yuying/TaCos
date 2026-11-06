import fs from "node:fs";
import path from "node:path";
import { isServerMode } from "@/lib/server-mode";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, listUserWorkspaces, requireWorkspace } from "@/lib/auth";
import {
  getJoinCode,
  getMembersSeeAllTasks,
  listApiKeys,
  listDeletedWorkspaces,
  listMembers,
  listLabelsWithCounts,
  listProjects,
} from "@/lib/issues";
import { getAiSettingsView } from "@/lib/ai";
import { getHarnessSettingsView } from "@/lib/harness";
import { getModelKeysView, harnessViewFor } from "@/lib/model-keys";
import { canManagePageTemplates, listPageTemplates } from "@/lib/page-templates";
import { SettingsView } from "@/components/settings-view";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
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
  const [members, projects, labels, keys, joinCode, allWorkspaces, deletedWorkspaces, seeAll, ai, harness, modelKeys, pageTemplates] =
    await Promise.all([
      listMembers(workspaceId),
      listProjects(workspaceId, user.id),
      listLabelsWithCounts(workspaceId),
      listApiKeys(workspaceId),
      getJoinCode(workspaceId),
      listUserWorkspaces(ws.user.id),
      listDeletedWorkspaces(ws.user.id),
      getMembersSeeAllTasks(workspaceId),
      getAiSettingsView(workspaceId),
      getHarnessSettingsView(workspaceId, ...(await harnessViewFor(ws.user.id))),
      getModelKeysView(ws.user.id),
      listPageTemplates(workspaceId),
    ]);
  // Where deleting this workspace lands you: the next team you belong to, or the
  // create/join screen when it was your last one.
  const next = allWorkspaces.find((other) => other.id !== workspaceId);
  const mcpServerPath = path.join(process.cwd(), "mcp", "server.ts");
  return (
    <SettingsView
      workspace={ws.workspace}
      role={ws.role}
      currentUser={ws.user}
      members={members}
      projects={projects}
      labels={labels}
      keys={keys}
      now={new Date().toISOString()}
      joinCode={joinCode}
      membersSeeAllTasks={seeAll}
      ai={ai}
      mcpServerPath={fs.existsSync(mcpServerPath) ? mcpServerPath : null}
      modelKeys={modelKeys}
      serverMode={isServerMode()}
      harness={harness}
      isOwner={ws.workspace.createdBy === ws.user.id}
      nextWorkspaceHref={next ? `/${next.id}` : "/onboarding"}
      deletedWorkspaces={deletedWorkspaces}
      pageTemplates={pageTemplates}
      canManagePageTemplates={canManagePageTemplates(workspaceId, ws.user.id)}
    />
  );
}
