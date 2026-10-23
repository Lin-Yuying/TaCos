"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, KeyRound, LogIn, Pencil, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import {
  adminCreateMemberAction,
  adminDeleteMemberAction,
  adminRenameMemberAction,
  adminResetPasswordAction,
  adminSetSiteRoleAction,
  switchUserAction,
} from "@/app/admin-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { OtterMark } from "@/components/icons";
import type { SiteMember } from "@/lib/admin";
import { formatDate } from "@/lib/format";

const inputClass =
  "w-full rounded-md border border-border bg-bg px-2 py-1 text-[13px] text-text outline-none transition-colors focus:border-border-strong";
const buttonClass =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text";

export function AdminConsole({
  currentUser,
  members,
  homeUrl,
  builtInAdminUsername,
}: {
  currentUser: { id: string; username: string; displayName: string };
  members: SiteMember[];
  homeUrl: string;
  builtInAdminUsername: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string; field: "password" | "name" } | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", password: "" });

  function start(member: SiteMember, field: "password" | "name") {
    setError(null);
    setNotice(null);
    setEditing({ id: member.id, field });
    setDraft(field === "name" ? member.displayName : "");
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    const result =
      editing.field === "password"
        ? await adminResetPasswordAction(editing.id, draft)
        : await adminRenameMemberAction(editing.id, draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(editing.field === "password" ? "Password reset." : "Name updated.");
    setEditing(null);
    setDraft("");
    router.refresh();
  }

  async function createMember() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await adminCreateMemberAction(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${result.data.username} created — sign in with the password you just set.`);
    setForm({ username: "", displayName: "", password: "" });
    router.refresh();
  }

  async function openAs(userId: string) {
    const result = await switchUserAction(userId);
    if (result.ok) window.location.href = result.data.url;
    else setError(result.error);
  }

  async function remove(member: SiteMember) {
    const ok = window.confirm(
      `Delete ${member.displayName} (@${member.username})?\n\n` +
        "Their issues stay but become unassigned, and their comments stay without an author."
    );
    if (!ok) return;
    const result = await adminDeleteMemberAction(member.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${result.data.username} deleted.`);
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="app-titlebar flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <OtterMark className="h-6 w-6" />
        <h1 className="text-[14px] font-semibold">Admin console</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          <ShieldCheck size={11} /> site admin
        </span>
        <Link
          href={homeUrl}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={13} />
          {homeUrl === "/onboarding" ? "Create / join a workspace" : "Back to issues"}
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          {(notice || error) && (
            <div className={`text-[12px] ${error ? "text-danger" : "text-muted"}`}>
              {error ?? notice}
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">Members ({members.length})</h2>
            <div className="divide-y divide-border rounded-lg border border-border">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                const isBuiltIn = member.username === builtInAdminUsername;
                const rowEditing = editing?.id === member.id ? editing : null;
                return (
                  <div key={member.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
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
                        <div className="text-[11px] text-faint">
                          @{member.username} · {member.workspaceCount}{" "}
                          {member.workspaceCount === 1 ? "workspace" : "workspaces"} · joined{" "}
                          {formatDate(member.createdAt)}
                        </div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <select
                          value={member.siteRole}
                          disabled={isBuiltIn || isSelf}
                          onChange={(e) => {
                            void adminSetSiteRoleAction(
                              member.id,
                              e.target.value as "admin" | "member"
                            ).then((result) => {
                              if (!result.ok) setError(result.error);
                              else router.refresh();
                            });
                          }}
                          className="rounded-md border border-border bg-elevated px-1.5 py-1 text-[12px] text-muted disabled:opacity-50"
                          title={
                            isBuiltIn
                              ? "The built-in superuser always keeps site admin"
                              : isSelf
                                ? "You cannot change your own site role"
                                : "Site role"
                          }
                        >
                          <option value="admin">Site admin</option>
                          <option value="member">Member</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => start(member, "name")}
                          className={buttonClass}
                          title="Rename this member"
                        >
                          <Pencil size={12} /> Name
                        </button>
                        <button
                          type="button"
                          onClick={() => start(member, "password")}
                          className={buttonClass}
                          title="Set a new password"
                        >
                          <KeyRound size={12} /> Password
                        </button>
                        <button
                          type="button"
                          onClick={() => void openAs(member.id)}
                          className={buttonClass}
                          title="Start a session as this member"
                        >
                          <LogIn size={12} /> Open as
                        </button>
                        {!isSelf && !isBuiltIn && (
                          <button
                            type="button"
                            onClick={() => void remove(member)}
                            className="rounded-md p-1.5 text-faint transition-colors hover:bg-elevated hover:text-danger"
                            title={`Delete ${member.displayName}`}
                            aria-label={`Delete ${member.displayName}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {rowEditing && (
                      <div className="mt-2 flex items-center gap-2 pl-9">
                        <input
                          autoFocus
                          type="text"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder={
                            rowEditing.field === "password"
                              ? "new password, at least 8 characters"
                              : "display name"
                          }
                          className={`${inputClass} max-w-[320px]`}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void save()}
                          className={`${buttonClass} shrink-0 disabled:opacity-50`}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="shrink-0 rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:text-text"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              Site admins can manage every account on this server and switch into any of them from
              the avatar menu. Per-workspace roles are still handled in workspace settings.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">Add a member</h2>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface/60 p-4">
              <label className="min-w-[150px] flex-1 space-y-1">
                <span className="text-[11px] text-faint">Username</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="jordan"
                  className={inputClass}
                />
              </label>
              <label className="min-w-[150px] flex-1 space-y-1">
                <span className="text-[11px] text-faint">Display name</span>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Jordan Reyes"
                  className={inputClass}
                />
              </label>
              <label className="min-w-[170px] flex-1 space-y-1">
                <span className="text-[11px] text-faint">Password</span>
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="at least 8 characters"
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                disabled={busy || !form.username.trim() || form.password.length < 8}
                onClick={() => void createMember()}
                className={`${buttonClass} shrink-0 font-medium text-text disabled:opacity-50`}
              >
                <UserPlus size={12} /> Create
              </button>
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              New accounts join the server but start with no workspaces — hand them a join code from
              workspace settings, or open their workspace as this member and add them there.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
