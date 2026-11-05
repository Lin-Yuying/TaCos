"use client";

import { useState } from "react";
import Link from "next/link";
import { joinWorkspaceAction } from "@/app/auth-actions";
import { OtterMark } from "@/components/icons";
import { useT } from "@/components/i18n-context";

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

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[380px] max-w-[92vw]">
        <div className="mb-6 flex items-center gap-3">
          <OtterMark className="h-10 w-10" />
          <span className="text-lead font-semibold tracking-tight">TaCos</span>
        </div>
        {workspace ? (
          <>
            <h1 className="text-heading font-semibold tracking-tight">
              {t("Join {name}", { name: workspace.name })}
            </h1>
            <p className="mb-5 mt-1 text-body text-muted">
              {t("You are signed in as {name}. You were invited to this workspace.", { name: displayName })}
            </p>
            <button
              type="button"
              data-testid="join-invite"
              disabled={busy}
              onClick={() => void join()}
              className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white disabled:opacity-60"
            >
              {busy ? t("Joining…") : t("Join workspace")}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-heading font-semibold tracking-tight">{t("This invite link no longer works")}</h1>
            <p className="mb-5 mt-1 text-body text-muted">{t("Ask a workspace admin for a new link.")}</p>
            <Link href="/" className="text-body text-accent hover:underline">
              {t("Go home")}
            </Link>
          </>
        )}
        {error && <p className="mt-3 text-small text-danger">{error}</p>}
      </div>
    </div>
  );
}
