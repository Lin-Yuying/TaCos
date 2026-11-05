import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { I18nProvider } from "@/components/i18n-context";
import { resolveLocale } from "@/lib/locale";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-body text-muted">Loading…</div>}>
      <LoginView searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const raw = (await searchParams).invite;
  const invite = typeof raw === "string" && /^[A-Za-z0-9-]{4,40}$/.test(raw) ? raw : undefined;
  const user = await getSessionUser();
  if (user && invite) redirect(`/join/${invite}`);
  if (user) {
    const workspaces = await listUserWorkspaces(user.id);
    const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
    redirect(landing ? `/${landing}` : "/");
  }
  return (
    <I18nProvider locale={await resolveLocale()}>
      <AuthForm mode="login" invite={invite} />
    </I18nProvider>
  );
}
