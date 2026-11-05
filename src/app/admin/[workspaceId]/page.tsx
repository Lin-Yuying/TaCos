import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  landingWorkspaceId,
  listUserWorkspaces,
} from "@/lib/auth";
import { getJoinCode, listMembers } from "@/lib/issues";
import { WorkspaceAdminConsole } from "@/components/workspace-admin-console";
import { I18nProvider } from "@/components/i18n-context";
import { resolveLocale } from "@/lib/locale";

// Same blocking gate as /admin: non-members and plain members leave before HTML ships.
export const instant = false;

export default function WorkspaceAdminPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-body text-muted">
          Loading…
        </div>
      }
    >
      <WorkspaceAdminView params={params} />
    </Suspense>
  );
}

async function WorkspaceAdminView({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspaces = await listUserWorkspaces(user.id);
  const active = workspaces.find((ws) => ws.id === workspaceId);
  if (!active) {
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
    redirect(landing ? `/${landing}` : "/onboarding");
  }
  if (active.role !== "admin") redirect(`/${workspaceId}`);

  const [members, joinCode] = await Promise.all([
    listMembers(workspaceId),
    getJoinCode(workspaceId),
  ]);

  return (
    <I18nProvider locale={await resolveLocale(user)}>
      <WorkspaceAdminConsole
        workspace={{ id: active.id, name: active.name, icon: active.icon }}
        currentUser={{ id: user.id, displayName: user.displayName }}
        members={members}
        joinCode={joinCode}
        homeUrl={`/${workspaceId}`}
      />
    </I18nProvider>
  );
}
