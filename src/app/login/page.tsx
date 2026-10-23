import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-muted">Loading…</div>}>
      <LoginView />
    </Suspense>
  );
}

async function LoginView() {
  await connection();
  const user = await getSessionUser();
  if (user) {
    const workspaces = await listUserWorkspaces(user.id);
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
    redirect(landing ? `/${landing}` : "/");
  }
  return <AuthForm mode="login" />;
}
