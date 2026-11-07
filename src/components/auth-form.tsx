"use client";

import { useState } from "react";
import Link from "next/link";
import { loginAction, registerAction } from "@/app/auth-actions";
import { OtterMark } from "@/components/icons";
import { useT } from "@/components/i18n-context";
import { GATE, GATE_CARD, GATE_INPUT } from "@/lib/page-chrome";

// invite: H-COLLAB-12 join code from an invite link; after sign-in the user goes back
// to /join/<code>.
export function AuthForm({ mode, invite }: { mode: "login" | "register"; invite?: string }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result =
      mode === "login"
        ? await loginAction({ username, password })
        : await registerAction({ username, displayName, password });
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    // Server-picked: the account's own last workspace, never the previous account's.
    window.location.href = invite ? `/join/${encodeURIComponent(invite)}` : result.data.next;
  }

  return (
    <div className={GATE}>
      <div className="app-auth-titlebar" aria-hidden="true" />
      <div className={GATE_CARD}>
        <div className="flex items-center gap-2">
          <OtterMark className="h-7 w-7" />
          <span className="text-body font-semibold">TaCos</span>
        </div>
        <h1 className="text-title font-semibold">
          {mode === "login" ? t("Sign in") : t("Create your account")}
        </h1>
        {mode === "register" && (
          <p className="text-body text-muted">
            {t("Open registration. Join an existing workspace with a code, or create your own.")}
          </p>
        )}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-small font-medium text-muted">{t("Username")}</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className={GATE_INPUT}
              placeholder={t("e.g. alex")}
            />
          </label>
          {mode === "register" && (
            <label className="block">
              <span className="mb-1 block text-small font-medium text-muted">{t("Display name")}</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={GATE_INPUT}
                placeholder={t("e.g. Alex Chen")}
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-small font-medium text-muted">{t("Password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={GATE_INPUT}
              placeholder={mode === "register" ? t("At least 8 characters") : ""}
            />
          </label>

          {error && <div className="text-small text-danger">{t(error)}</div>}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {mode === "login" ? t("Sign in") : t("Create account")}
          </button>
        </form>

        <div className="text-center text-small text-muted">
          {mode === "login" ? (
            <>
              {t("No account yet?")}{" "}
              <Link href={invite ? `/register?invite=${encodeURIComponent(invite)}` : "/register"} className="text-accent hover:underline">
                {t("Register")}
              </Link>
            </>
          ) : (
            <>
              {t("Already registered?")}{" "}
              <Link href={invite ? `/login?invite=${encodeURIComponent(invite)}` : "/login"} className="text-accent hover:underline">
                {t("Sign in")}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
