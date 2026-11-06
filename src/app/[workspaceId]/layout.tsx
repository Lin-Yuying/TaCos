import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  landingWorkspaceId,
  linkSessionDevice,
  listUserWorkspaces,
  setLastWorkspace,
} from "@/lib/auth";
import { listFavoriteProjects, listMembers, listProjects, getJoinCode } from "@/lib/issues";
import { listFavoritePages, listPageTree } from "@/lib/pages";
import { UIProvider } from "@/components/ui-context";
import { RunnerBridge } from "@/components/runner-bridge";
import { isServerMode } from "@/lib/server-mode";
import { WorkspaceShell } from "@/components/workspace-shell";
import { NewIssueDialog } from "@/components/new-issue-dialog";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { CommandPalette } from "@/components/command-palette";
import { aiReady } from "@/lib/ai";
import { hasAgentThreads } from "@/lib/agent-threads";
import { getWorkspaceHarnessGate } from "@/lib/harness";
import { harnessViewFor } from "@/lib/model-keys";
import { resolveLocale } from "@/lib/locale";
import { I18nProvider } from "@/components/i18n-context";

// Auth-gated shell: every request must resolve the session before rendering.
// Blocking navigation is correct here, so opt out of instant-navigation checks.
export const instant = false;

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Sessions that pre-date device tracking get linked here, once middleware has
  // given this browser a device id.
  await linkSessionDevice(user.id);
  const workspaces = await listUserWorkspaces(user.id);
  if (workspaces.length === 0) redirect("/onboarding");
  if (!workspaces.some((ws) => ws.id === workspaceId)) {
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
    redirect(landing ? `/${landing}` : "/onboarding");
  }
  const active = workspaces.find((ws) => ws.id === workspaceId)!;
  // Remember the account's own place, so the next sign-in (after a switch or a logout)
  // resumes it instead of whatever workspace the list happened to put first.
  if (user.lastWorkspaceId !== active.id) {
    await setLastWorkspace(user.id, active.id);
  }
  // Server-sourced so router.refresh() after create/delete updates the sidebar list.
  const [projects, members, favorites, favoritePages, pages, aiEnabled, joinCode, harnessGate, locale, hasThreads] = await Promise.all([
    listProjects(workspaceId, user.id),
    listMembers(workspaceId),
    listFavoriteProjects(workspaceId, user.id),
    listFavoritePages(workspaceId, user.id),
    listPageTree(workspaceId, user.id),
    aiReady(workspaceId, user.id),
    getJoinCode(workspaceId),
    getWorkspaceHarnessGate(workspaceId, ...(await harnessViewFor(user.id))),
    resolveLocale(user),
    hasAgentThreads(workspaceId, user.id),
  ]);

  return (
    <I18nProvider locale={locale}>
      <UIProvider key={`${user.id}.${active.id}`} userId={user.id} workspaceId={active.id} aiReady={aiEnabled}>
        <WorkspaceShell
          workspace={{
            id: active.id,
            name: active.name,
            key: active.key,
            icon: active.icon,
            role: active.role,
            createdBy: active.createdBy,
          }}
          user={user}
          workspaces={workspaces}
          projects={projects}
          favorites={favorites}
          favoritePages={favoritePages}
          members={members}
          pages={pages}
          joinCode={joinCode}
          agentAllowed={harnessGate.agentAllowed || hasThreads}
        >
          {children}
        </WorkspaceShell>
        <NewIssueDialog workspaceId={active.id} />
        <NewProjectDialog workspaceId={active.id} workspaceName={active.name} />
        <CommandPalette workspaceId={active.id} />
        {isServerMode() && <RunnerBridge userId={user.id} />}
      </UIProvider>
    </I18nProvider>
  );
}
