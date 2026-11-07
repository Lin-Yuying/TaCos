"use client";

import { useState } from "react";
import Link from "next/link";
import { joinWorkspaceAction, logoutAction } from "@/app/auth-actions";
import { OtterMark } from "@/components/icons";
import { useT } from "@/components/i18n-context";
import { GATE, GATE_CARD } from "@/lib/page-chrome";

export function JoinInvite({
  code,
  workspace,
  displayName,
}: {
  code: string;
  workspace: { id: string; name: string } | null;
  displayName: string;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await joinWorkspaceAction({ code });
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    window.location.href = `/${result.data.id}`;
  }

  // Signing out first: /login sends a signed-in visitor straight back to this invite.
  async function switchAccount() {
    if (busy) return;
    setBusy(true);
    await logoutAction();
    window.location.href = `/login?invite=${encodeURIComponent(code)}`;
  }

  return (
    <div className={GATE}>
      <div className={`${GATE_CARD} items-center text-center`}>
        <OtterMark className="h-10 w-10" />
        {workspace ? (
          <>
            <h1 className="text-title font-semibold">
              {t("Join {name}", { name: workspace.name })}
            </h1>
            <p className="text-body text-muted">
              {t("You are signed in as {name}. You were invited to this workspace.", { name: displayName })}
            </p>
            <button
              type="button"
              data-testid="join-invite"
              disabled={busy}
              onClick={() => void join()}
              className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? t("Joining…") : t("Join workspace")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void switchAccount()}
              className="text-small text-text underline disabled:opacity-60"
            >
              {t("Use a different account")}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-title font-semibold">{t("This invite link no longer works")}</h1>
            <p className="text-body text-muted">{t("Ask a workspace admin for a new link.")}</p>
            <Link href="/" className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white transition-colors hover:bg-accent-hover">
              {t("Go home")}
            </Link>
          </>
        )}
        {error && <p className="text-small text-danger">{error}</p>}
      </div>
    </div>
  );
}
