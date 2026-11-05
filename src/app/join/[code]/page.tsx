import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, listUserWorkspaces } from "@/lib/auth";
import { describeInvite } from "@/lib/issues";
import { JoinInvite } from "@/components/join-invite";
import { I18nProvider } from "@/components/i18n-context";
import { resolveLocale } from "@/lib/locale";

// H-COLLAB-12: the invite link. A signed-out visitor goes to register first and comes
// back here. Joining needs a click, so a link preview cannot add anyone.
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-body text-muted">Loading…</div>}>
      <JoinView params={params} />
    </Suspense>
  );
}

async function JoinView({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/register?invite=${encodeURIComponent(code)}`);
  const invite = await describeInvite(code);
  if (invite) {
    const mine = await listUserWorkspaces(user.id);
    if (mine.some((w) => w.id === invite.id)) redirect(`/${invite.id}`);
  }
  return (
    <I18nProvider locale={await resolveLocale(user)}>
      <JoinInvite code={code} workspace={invite} displayName={user.displayName} />
    </I18nProvider>
  );
}
