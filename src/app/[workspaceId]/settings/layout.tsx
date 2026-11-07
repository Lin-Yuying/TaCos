import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listDeletedWorkspaces } from "@/lib/issues";
import { SettingsShell } from "@/components/settings-shell";

async function Shell({ params, children }: { params: Promise<{ workspaceId: string }>; children: ReactNode }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ws = await requireWorkspace(workspaceId);
  const isOwner = ws.workspace.createdBy === ws.user.id;
  // The danger page also lists this user's deleted workspaces, so a non-owner may still need it.
  const deleted = isOwner ? [] : await listDeletedWorkspaces(ws.user.id);
  return (
    <SettingsShell
      workspaceId={workspaceId}
      canTransfer={ws.role === "admin" || isOwner}
      showDanger={isOwner || deleted.length > 0}
      isInstanceAdmin={user.siteRole === "admin"}
    >
      {children}
    </SettingsShell>
  );
}

export default function SettingsLayout(props: { params: Promise<{ workspaceId: string }>; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell {...props} />
    </Suspense>
  );
}
