import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";
import { listDeletedWorkspaces, listWorkspaceDeletionNotices } from "@/lib/issues";
import { OnboardingForm } from "@/components/onboarding-form";

export default function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-muted">Loading…</div>}>
      <OnboardingView searchParams={searchParams} />
    </Suspense>
  );
}

async function OnboardingView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const adding = (await searchParams).add != null;
  const workspaces = await listUserWorkspaces(user.id);
  const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
  if (!adding && landing) redirect(`/${landing}`);
  // The owner lands here right after deleting their last workspace — the recycle
  // bin has to be reachable from this screen or the 30 days are useless.
  const [deletedWorkspaces, deletionNotices] = await Promise.all([
    listDeletedWorkspaces(user.id),
    listWorkspaceDeletionNotices(user.id),
  ]);
  return (
    <OnboardingForm
      displayName={user.displayName}
      hasWorkspaces={workspaces.length > 0}
      siteAdmin={user.siteRole === "admin"}
      homeUrl={user.siteRole === "admin" ? "/admin" : landing ? `/${landing}` : undefined}
      workspaceUrl={landing ? `/${landing}` : undefined}
      user={user}
      deletedWorkspaces={deletedWorkspaces}
      deletionNotices={deletionNotices}
    />
  );
}
