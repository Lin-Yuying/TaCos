"use client";
import { safeAction } from "@/lib/ui/safe-action";
import { useConfirmation } from "@/components/ui/confirmation";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, Copy, ShieldCheck } from "lucide-react";
import { setMemberRoleAction, removeMemberAction, rotateJoinCodeAction } from "@/app/auth-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { WorkspaceMark } from "@/components/icons";
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
      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 border border-border transition-colors bg-bg text-text hover:bg-active"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
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
  const {confirm,dialog}=useConfirmation();
  const router = useRouter();
  const origin = useSyncExternalStore(NO_SUBSCRIBE, () => window.location.origin, () => "");
  const [code, setCode] = useState(joinCode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function changeRole(member: Member, role: "admin" | "member") {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await safeAction(async()=>setMemberRoleAction(workspace.id, member.id, role));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function remove(member: Member) {
    if (busy) return;
    const ok = await confirm(
      t("Remove {name} from {workspace}?", { name: member.displayName, workspace: workspace.name }),
      { action: t("Remove") }
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const result = await safeAction(async()=>removeMemberAction(workspace.id, member.id));
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
    const result = await safeAction(async()=>rotateJoinCodeAction(workspace.id));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCode(result.data.code);
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col bg-bg">{dialog}
      <header className="app-titlebar flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <WorkspaceMark icon={workspace.icon} className="h-6 w-6" />
        <h1 className="text-lead font-semibold">{workspace.name}</h1>
        <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap gap-1 bg-elevated text-caption text-muted">
          <ShieldCheck size={11} /> {t("Workspace admin")}
        </span>
        <Link
          href={homeUrl}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={13} />
          {t("Back to workspace")}
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[880px] space-y-6 px-5 pb-10 pt-6">
          {error && <div className="text-small text-danger">{t(error)}</div>}

          <section className="space-y-3">
            <h2 className="text-body font-semibold">{t("Members ({count})", { count: members.length })}</h2>
            <div className="divide-y divide-border rounded-lg border border-border">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                return (
                  <div key={member.id} className="flex items-center gap-3 px-5 py-2">
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
                        className="h-[26px] rounded-[7px] px-2 border border-border bg-elevated text-small text-muted disabled:opacity-50"
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
                        className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors hover:text-danger disabled:opacity-40 disabled:hover:text-muted bg-bg text-text hover:bg-active"
                      >
                        {t("Remove")}
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
            <p className="text-small leading-relaxed text-faint">
              {interpolate(
                t("Share this join code — anyone can register at {url} and join {workspace} with it."),
                {
                  url: <code className="font-mono text-caption">{origin}/register</code>,
                  workspace: workspace.name,
                }
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                aria-label={t("Join code")}
                value={code ?? t("No active code")}
                className="h-[34px] rounded-lg px-2.5 min-w-[180px] flex-1 border border-border-strong bg-bg text-body text-text focus:outline-none"
              />
              {code && <CopyButton text={code} />}
              <button
                type="button"
                onClick={() => void rotate()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors disabled:opacity-50 bg-bg text-text hover:bg-active"
              >
                {t("Change join code")}
              </button>
            </div>
          </section>

          <section className="text-small leading-relaxed text-faint">
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
