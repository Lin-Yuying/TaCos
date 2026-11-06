"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { UserMenu, type UserInfo } from "@/components/user-menu";
import { WorkspaceTrashList } from "@/components/workspace-trash-list";
import { createWorkspaceAction, joinWorkspaceAction } from "@/app/auth-actions";
import { markWorkspaceNoticeReadAction } from "@/app/workspace-misc-actions";
import type { DeletedWorkspace, WorkspaceDeletionNotice } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

export function OnboardingForm({
  displayName,
  hasWorkspaces = false,
  siteAdmin = false,
  homeUrl,
  workspaceUrl,
  user,
  deletedWorkspaces = [],
  deletionNotices = [],
}: {
  displayName: string;
  hasWorkspaces?: boolean;
  siteAdmin?: boolean;
  homeUrl?: string;
  workspaceUrl?: string;
  user: UserInfo;
  deletedWorkspaces?: DeletedWorkspace[];
  deletionNotices?: WorkspaceDeletionNotice[];
}) {
  const t = useT();
  const router = useRouter();
  const [notices, setNotices] = useState(deletionNotices);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [wsName, setWsName] = useState("");
  const [wsKey, setWsKey] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await createWorkspaceAction({ name: wsName, key: wsKey });
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    router.push(`/${result.data.id}`);
    router.refresh();
  }

  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await joinWorkspaceAction({ code: joinCode });
    setBusy(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    router.push(`/${result.data.id}`);
    router.refresh();
  }

  function dismissNotice(id: string) {
    setNotices((prev) => prev.filter((notice) => notice.id !== id));
    void markWorkspaceNoticeReadAction(id);
  }

  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="app-auth-titlebar" aria-hidden="true" />
      <div className="app-auth-menu absolute right-4 top-3">
        <UserMenu user={user} workspaceUrl={workspaceUrl} />
      </div>
      <div className="w-[400px] max-w-[92vw]">
        <div className="mb-5 flex items-center gap-3 text-small">
          <span className="text-faint">
            {t("Wrong account? Switch back from the avatar menu at the top right.")}
          </span>
          {siteAdmin && homeUrl !== "/admin" && (
            <Link
              href="/admin"
              className="ml-auto inline-flex items-center gap-1 text-muted transition-colors hover:text-text"
            >
              <ShieldCheck size={13} /> {t("Admin console")}
            </Link>
          )}
        </div>
        <h1 className="text-heading font-semibold tracking-tight">
          {hasWorkspaces ? t("Add a workspace") : t("Welcome, {name}", { name: displayName })}
        </h1>
        <p className="mb-6 mt-1 text-body text-muted">
          {hasWorkspaces
            ? t("Create another workspace, or join a teammate's with a code.")
            : t("Create a workspace for your team, or join an existing one with a code from a teammate.")}
        </p>

        {notices.length > 0 && (
          <div className="mb-4 space-y-2">
            {notices.map((notice) => (
              <div
                key={notice.id}
                className="flex items-start gap-2 rounded-lg border border-border bg-elevated/50 px-3 py-2 text-small leading-relaxed text-muted"
              >
                <span className="min-w-0 flex-1">
                  {notice.data?.workspaceName
                    ? t("{name} deleted the workspace “{workspace}”", {
                        name: notice.data.ownerName ?? t("The owner"),
                        workspace: notice.data.workspaceName,
                      })
                    : notice.body}
                </span>
                <button
                  type="button"
                  onClick={() => dismissNotice(notice.id)}
                  className="shrink-0 text-caption text-faint transition-colors hover:text-text"
                >
                  {t("Dismiss")}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4 flex rounded-lg border border-border p-1">
          {(["create", "join"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setTab(option);
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 text-body font-medium transition-colors ${
                tab === option ? "bg-elevated text-text" : "text-muted hover:text-text"
              }`}
            >
              {option === "create" ? t("Create workspace") : t("Join with code")}
            </button>
          ))}
        </div>

        {tab === "create" ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-small font-medium text-muted">{t("Workspace name")}</span>
              <input
                autoFocus
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 text-body placeholder:text-faint focus:border-border-strong"
                placeholder={t("e.g. Acme Inc")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-small font-medium text-muted">
                {t("Workspace key (issue prefix)")}
              </span>
              <input
                value={wsKey}
                onChange={(e) => setWsKey(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 font-mono text-body placeholder:text-faint focus:border-border-strong"
                placeholder={t("e.g. ACME")}
              />
              <span className="mt-1 block text-caption text-faint">
                2-10 letters/digits. Projects get their own prefixes; this reserves the workspace default.
              </span>
            </label>
            {error && <div className="text-small text-danger">{t(error)}</div>}
            <button
              type="submit"
              disabled={busy || !wsName.trim() || !wsKey.trim()}
              className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Create workspace")}
            </button>
          </form>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-small font-medium text-muted">{t("Join code")}</span>
              <input
                autoFocus
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-2 font-mono text-body placeholder:text-faint focus:border-border-strong"
                placeholder="TACOS-XXXXXXXX"
              />
              <span className="mt-1 block text-caption text-faint">
                {t("Any workspace admin can find the code in Settings → Members.")}
              </span>
            </label>
            {error && <div className="text-small text-danger">{t(error)}</div>}
            <button
              type="submit"
              disabled={busy || !joinCode.trim()}
              className="w-full rounded-md bg-accent px-3 py-2 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Join workspace")}
            </button>
          </form>
        )}

        {hasWorkspaces && (
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-4 w-full rounded-md px-3 py-2 text-body text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            {t("Back")}
          </button>
        )}

        {deletedWorkspaces.length > 0 && (
          <div className="mt-8 text-left">
            <WorkspaceTrashList items={deletedWorkspaces} />
          </div>
        )}
      </div>
    </div>
  );
}
