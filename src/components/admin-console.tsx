"use client";
import { safeAction } from "@/lib/ui/safe-action";
import { useConfirmation } from "@/components/ui/confirmation";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ShieldCheck, Trash2 } from "lucide-react";
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
import { useLocale, useT } from "@/components/i18n-context";

const inputClass =
  "w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text outline-none transition-colors focus:border-border-strong";
const buttonClass =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text";

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
  const t = useT();
  const {confirm,dialog}=useConfirmation();
  const locale = useLocale();
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
        ? await safeAction(async()=>adminResetPasswordAction(editing.id, draft))
        : await safeAction(async()=>adminRenameMemberAction(editing.id, draft));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(t(editing.field === "password" ? "Password reset." : "Name updated."));
    setEditing(null);
    setDraft("");
    router.refresh();
  }

  async function createMember() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await safeAction(async()=>adminCreateMemberAction(form));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      t("{username} created — sign in with the password you just set.", {
        username: result.data.username,
      })
    );
    setForm({ username: "", displayName: "", password: "" });
    router.refresh();
  }

  async function openAs(userId: string) {
    const result = await safeAction(async()=>switchUserAction(userId));
    if (result.ok) window.location.href = result.data.url;
    else setError(result.error);
  }

  async function remove(member: SiteMember) {
    const ok = await confirm(
      t("Delete {name} (@{username})?", { name: member.displayName, username: member.username }) +
        "\n\n" +
        t("Their issues stay but become unassigned, and their comments stay without an author.")
    );
    if (!ok) return;
    const result = await safeAction(async()=>adminDeleteMemberAction(member.id));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(t("{username} deleted.", { username: result.data.username }));
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col bg-bg">{dialog}
      <header className="app-titlebar flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <OtterMark className="h-6 w-6" />
        <h1 className="text-lead font-semibold">{t("Admin console")}</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
          <ShieldCheck size={11} /> {t("site admin")}
        </span>
        <Link
          href={homeUrl}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={13} />
          {t(homeUrl === "/onboarding" ? "Create / join a workspace" : "Back")}
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[880px] space-y-6 px-5 pb-10 pt-6">
          {(notice || error) && (
            <div className={`text-small ${error ? "text-danger" : "text-muted"}`}>
              {error ? t(error) : notice}
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-body font-semibold">{t("Members ({count})", { count: members.length })}</h2>
            <div className="divide-y divide-border rounded-lg border border-border">
              {members.map((member) => {
                const isSelf = member.id === currentUser.id;
                const isBuiltIn = member.username === builtInAdminUsername;
                const rowEditing = editing?.id === member.id ? editing : null;
                return (
                  <div key={member.id} className="px-5 py-2">
                    <div className="flex flex-wrap items-center gap-3">
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
                        <div className="text-caption text-faint">
                          @{member.username} ·{" "}
                          {t(
                            member.workspaceCount === 1
                              ? "{count} workspace · joined {date}"
                              : "{count} workspaces · joined {date}",
                            { count: member.workspaceCount, date: formatDate(member.createdAt, locale) }
                          )}
                        </div>
                      </div>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
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
                          className="rounded-md border border-border bg-elevated px-1.5 py-1 text-small text-muted disabled:opacity-50"
                          title={t(
                            isBuiltIn
                              ? "The built-in superuser always keeps site admin"
                              : isSelf
                                ? "You cannot change your own site role"
                                : "Site role"
                          )}
                        >
                          <option value="admin">{t("Site admin")}</option>
                          <option value="member">{t("Member")}</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => start(member, "name")}
                          className={buttonClass}
                          title={t("Rename this member")}
                        >
                          {t("Rename")}
                        </button>
                        <button
                          type="button"
                          onClick={() => start(member, "password")}
                          className={buttonClass}
                          title={t("Set a new password")}
                        >
                          {t("Set a new password")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void openAs(member.id)}
                          className={buttonClass}
                          title={t("Start a session as this member")}
                        >
                          {t("Open as")}
                        </button>
                        {!isSelf && !isBuiltIn && (
                          <button
                            type="button"
                            onClick={() => void remove(member)}
                            className="rounded-md p-1.5 text-danger transition-colors hover:bg-elevated"
                            title={t("Delete {name}", { name: member.displayName })}
                            aria-label={t("Delete {name}", { name: member.displayName })}
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
                          type={rowEditing.field === "password" ? "password" : "text"}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder={
                            rowEditing.field === "password"
                              ? t("new password, at least 8 characters")
                              : t("display name")
                          }
                          className={`${inputClass} max-w-[320px]`}
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void save()}
                          className={`${buttonClass} shrink-0 disabled:opacity-50`}
                        >
                          {t("Save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="shrink-0 rounded-md px-2 py-1 text-small text-faint transition-colors hover:text-text"
                        >
                          {t("Cancel")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-small leading-relaxed text-faint">
              {t(
                "Site admins can manage every account on this server and switch into any of them from the avatar menu. Per-workspace roles are still handled in workspace settings."
              )}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-body font-semibold">{t("Add a member")}</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[150px] flex-1 space-y-1">
                <span className="text-caption text-faint">{t("Username")}</span>
                <input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="jordan"
                  className={inputClass}
                />
              </label>
              <label className="min-w-[150px] flex-1 space-y-1">
                <span className="text-caption text-faint">{t("Display name")}</span>
                <input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="Jordan Reyes"
                  className={inputClass}
                />
              </label>
              <label className="min-w-[170px] flex-1 space-y-1">
                <span className="text-caption text-faint">{t("Password")}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={t("at least 8 characters")}
                  className={inputClass}
                />
              </label>
              <button
                type="button"
                disabled={busy || !form.username.trim() || form.password.length < 8}
                onClick={() => void createMember()}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {t("Create")}
              </button>
            </div>
            <p className="text-small leading-relaxed text-faint">
              {t(
                "New accounts join the server but start with no workspaces — hand them a join code from workspace settings, or open their workspace as this member and add them there."
              )}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
