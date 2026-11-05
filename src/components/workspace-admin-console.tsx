"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, Copy, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { setMemberRoleAction, removeMemberAction, rotateJoinCodeAction } from "@/app/auth-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { OtterMark, WorkspaceMark } from "@/components/icons";
import type { Member } from "@/lib/issues";
import { interpolate, useT } from "@/components/i18n-context";

const NO_SUBSCRIBE = () => () => {};

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-caption text-muted transition-colors hover:text-text"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {t(copied ? "Copied" : "Copy")}
    </button>
  );
}

// Workspace-level counterpart to the site console: same page shape, but it only ever
// sees this workspace's members. Site-wide account controls (create/delete users,
// passwords, impersonation) stay in /admin for site admins.
export function WorkspaceAdminConsole({
  workspace,
  currentUser,
  members,
  joinCode,
  homeUrl,
}: {
  workspace: { id: string; name: string; icon: string | null };
  currentUser: { id: string; displayName: string };
  members: Member[];
  joinCode: string | null;
  homeUrl: string;
}) {
  const t = useT();
  const router = useRouter();
  const origin = useSyncExternalStore(NO_SUBSCRIBE, () => window.location.origin, () => "");
  const [code, setCode] = useState(joinCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changeRole(member: Member, role: "admin" | "member") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await setMemberRoleAction(workspace.id, member.id, role);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function remove(member: Member) {
    if (busy) return;
    const ok = window.confirm(
      t("Remove {name} from {workspace}?", { name: member.displayName, workspace: workspace.name })
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const result = await removeMemberAction(workspace.id, member.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function rotate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await rotateJoinCodeAction(workspace.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCode(result.data.code);
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="app-titlebar flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <OtterMark className="h-6 w-6" />
        <h1 className="text-body font-semibold">{t("Admin console")}</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
          <ShieldCheck size={11} /> {t("{workspace} admin", { workspace: workspace.name })}
        </span>
        <Link
          href={homeUrl}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={13} />
          {t("Back to workspace")}
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto px-10 pb-10 pt-6 lg:px-20 xl:px-32">
        <div className="space-y-8">
          {error && <div className="text-small text-danger">{t(error)}</div>}

          <section className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <WorkspaceMark icon={workspace.icon} className="h-10 w-10" />
              <div className="min-w-0">
                <div className="text-body font-medium">{workspace.name}</div>
                <div className="text-caption text-faint">
                  {t(
                    members.length === 1
                      ? "{count} member · you can manage the people in this workspace"
                      : "{count} members · you can manage the people in this workspace",
                    { count: members.length }
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-body font-semibold">{t("Members ({count})", { count: members.length })}</h2>
            <div className="divide-y divide-border rounded-lg border border-border">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                return (
                  <div key={member.id} className="flex items-center gap-3 px-4 py-2.5">
                    <AssigneeAvatar
                      displayName={member.displayName}
                      avatar={member.avatar}
                      size={24}
                    />
                    <div className="min-w-0">
                      <div className="text-body">
                        {member.displayName}
                        {isSelf && <span className="ml-1 text-caption text-faint">{t("(you)")}</span>}
                      </div>
                      <div className="text-caption text-faint">@{member.username}</div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <select
                        value={member.role}
                        disabled={busy || isSelf}
                        onChange={(event) =>
                          void changeRole(member, event.target.value as "admin" | "member")
                        }
                        title={t(isSelf ? "You cannot change your own role" : "Workspace role")}
                        className="rounded-md border border-border bg-elevated px-1.5 py-1 text-small text-muted disabled:opacity-50"
                      >
                        <option value="admin">{t("Admin")}</option>
                        <option value="member">{t("Member")}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void remove(member)}
                        disabled={busy || isSelf}
                        aria-label={t("Remove {name}", { name: member.displayName })}
                        title={t(isSelf ? "You cannot remove yourself" : "Remove from workspace")}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger disabled:opacity-40 disabled:hover:text-faint"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-small leading-relaxed text-faint">
              {t(
                "Removing someone drops their assignments here and their access to this workspace. A workspace always keeps at least one admin."
              )}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-body font-semibold">{t("Invite teammates")}</h2>
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-small leading-relaxed text-muted">
                {interpolate(
                  t("Share this join code — anyone can register at {url} and join {workspace} with it."),
                  {
                    url: <code className="font-mono text-caption">{origin}/register</code>,
                    workspace: workspace.name,
                  }
                )}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg px-2 py-1.5 font-mono text-body text-text">
                  {code ?? t("No active code")}
                </code>
                {code && <CopyButton text={code} />}
                <button
                  type="button"
                  onClick={() => void rotate()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
                >
                  <RefreshCw size={12} /> {t("Rotate")}
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface/60 p-4 text-small leading-relaxed text-muted">
            {t(
              "This console covers {workspace} only. Site-wide accounts — creating users, resetting passwords, switching accounts — are handled by a site admin.",
              { workspace: workspace.name }
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
