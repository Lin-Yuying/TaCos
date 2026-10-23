import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { BUILT_IN_ADMIN } from "@/db/client";
import { listSiteMembers } from "@/lib/admin";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";
import { AdminConsole } from "@/components/admin-console";

// The gate has to run before any HTML is sent, so members get a real redirect.
export const instant = false;

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-[13px] text-muted">
          Loading…
        </div>
      }
    >
      <AdminView />
    </Suspense>
  );
}

async function AdminView() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const workspaces = await listUserWorkspaces(user.id);
  const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
  const homeUrl = landing ? `/${landing}` : "/onboarding";
  if (user.siteRole !== "admin") redirect(homeUrl);

  return (
    <AdminConsole
      currentUser={{ id: user.id, username: user.username, displayName: user.displayName }}
      members={await listSiteMembers()}
      homeUrl={homeUrl}
      builtInAdminUsername={BUILT_IN_ADMIN}
    />
  );
}
