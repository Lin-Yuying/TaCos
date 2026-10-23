import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-muted">Loading…</div>}>
      <RegisterView />
    </Suspense>
  );
}

async function RegisterView() {
  await connection();
  const user = await getSessionUser();
  if (user) {
    const workspaces = await listUserWorkspaces(user.id);
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
    redirect(landing ? `/${landing}` : "/");
  }
  return <AuthForm mode="register" />;
}
