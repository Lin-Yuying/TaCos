"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowLeft, Check, Copy, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { setMemberRoleAction, removeMemberAction, rotateJoinCodeAction } from "@/app/auth-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { OtterMark, WorkspaceMark } from "@/components/icons";
import type { Member } from "@/lib/issues";

const NO_SUBSCRIBE = () => () => {};

function CopyButton({ text }: { text: string }) {
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
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-text"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
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
    const ok = window.confirm(`Remove ${member.displayName} from ${workspace.name}?`);
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
        <h1 className="text-[14px] font-semibold">Admin console</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          <ShieldCheck size={11} /> {workspace.name} admin
        </span>
        <Link
          href={homeUrl}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={13} />
          Back to workspace
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto px-10 pb-10 pt-6 lg:px-20 xl:px-32">
        <div className="space-y-8">
          {error && <div className="text-[12px] text-danger">{error}</div>}

          <section className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <WorkspaceMark icon={workspace.icon} className="h-10 w-10" />
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{workspace.name}</div>
                <div className="text-[11px] text-faint">
                  {members.length} {members.length === 1 ? "member" : "members"} · you can
                  manage the people in this workspace
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">Members ({members.length})</h2>
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
                      <div className="text-[13px]">
                        {member.displayName}
                        {isSelf && <span className="ml-1 text-[11px] text-faint">(you)</span>}
                      </div>
                      <div className="text-[11px] text-faint">@{member.username}</div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <select
                        value={member.role}
                        disabled={busy || isSelf}
                        onChange={(event) =>
                          void changeRole(member, event.target.value as "admin" | "member")
                        }
                        title={isSelf ? "You cannot change your own role" : "Workspace role"}
                        className="rounded-md border border-border bg-elevated px-1.5 py-1 text-[12px] text-muted disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void remove(member)}
                        disabled={busy || isSelf}
                        aria-label={`Remove ${member.displayName}`}
                        title={isSelf ? "You cannot remove yourself" : "Remove from workspace"}
                        className="rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger disabled:opacity-40 disabled:hover:text-faint"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              Removing someone drops their assignments here and their access to this
              workspace. A workspace always keeps at least one admin.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">Invite teammates</h2>
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-[12px] leading-relaxed text-muted">
                Share this join code — anyone can register at{" "}
                <code className="font-mono text-[11px]">{origin}/register</code> and join{" "}
                {workspace.name} with it.
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg px-2 py-1.5 font-mono text-[13px] text-text">
                  {code ?? "No active code"}
                </code>
                {code && <CopyButton text={code} />}
                <button
                  type="button"
                  onClick={() => void rotate()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Rotate
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface/60 p-4 text-[12px] leading-relaxed text-muted">
            This console covers {workspace.name} only. Site-wide accounts — creating users,
            resetting passwords, switching accounts — are handled by a site admin.
          </section>
        </div>
      </main>
    </div>
  );
}
