"use client";

import { useState } from "react";
import Link from "next/link";
import { loginAction, registerAction } from "@/app/auth-actions";
import { OtterMark } from "@/components/icons";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
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
      setError(result.error);
      return;
    }
    // Server-picked: the account's own last workspace, never the previous account's.
    window.location.href = result.data.next;
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="app-auth-titlebar" aria-hidden="true" />
      <div className="w-[360px] max-w-[92vw]">
        <div className="mb-6 flex items-center gap-3">
          <OtterMark className="h-10 w-10" />
          <span className="text-[15px] font-semibold tracking-tight">Tacos</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mb-6 mt-1 text-[13px] text-muted">
          {mode === "login"
            ? "Welcome back — your team's issues await."
            : "Open registration. Join an existing workspace with a code, or create your own."}
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Username</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 text-[13px] placeholder:text-faint focus:border-border-strong"
              placeholder="e.g. alex"
            />
          </label>
          {mode === "register" && (
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">Display name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 text-[13px] placeholder:text-faint focus:border-border-strong"
                placeholder="e.g. Alex Chen"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 text-[13px] placeholder:text-faint focus:border-border-strong"
              placeholder={mode === "register" ? "At least 8 characters" : ""}
            />
          </label>

          {error && <div className="text-[12px] text-danger">{error}</div>}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="w-full rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-center text-[13px] text-muted">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <Link href="/register" className="text-accent hover:underline">
                Register
              </Link>
            </>
          ) : (
            <>
              Already registered?{" "}
              <Link href="/login" className="text-accent hover:underline">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
