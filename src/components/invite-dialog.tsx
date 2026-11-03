"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, X } from "lucide-react";
import { interpolate, useT } from "@/components/i18n-context";
import { inviteMemberAction } from "@/app/auth-actions";

// The register URL is only knowable in the browser; useSyncExternalStore lets the
// server render the empty snapshot and the client swap in the real origin after
// hydration instead of a mismatch.
const NO_SUBSCRIBE = () => () => {};

export function InviteDialog({
  workspaceId,
  workspaceName,
  isAdmin = false,
  joinCode,
  onClose,
}: {
  workspaceId?: string;
  workspaceName: string;
  isAdmin?: boolean;
  joinCode: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const origin = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => window.location.origin,
    () => ""
  );
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [who, setWho] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // H-COLLAB-12: the invite link carries the active join code. Rotating the code kills it.
  const link = joinCode && origin ? `${origin}/join/${joinCode}` : null;

  async function invite() {
    if (!workspaceId || !who.trim() || inviteBusy) return;
    setInviteBusy(true);
    setInviteMsg(null);
    const result = await inviteMemberAction(workspaceId, who);
    setInviteBusy(false);
    if (!result.ok) {
      setInviteMsg({ ok: false, text: t(result.error) });
      return;
    }
    setWho("");
    setInviteMsg({ ok: true, text: t("{name} joined the workspace", { name: result.data.displayName }) });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(kind: "code" | "link") {
    const text = kind === "code" ? joinCode : link;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      // Clipboard permission denied: the code is on screen to copy by hand.
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 top-[18vh] z-50 mx-auto w-[480px] max-w-[94vw]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("Invite teammates")}
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-faint">
            <span>
              {workspaceName} <span className="mx-1">›</span>
              <span className="text-muted">{t("Invite teammates")}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close")}
              className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            <p className="text-[13px] leading-relaxed text-muted">
              {interpolate(
                t(
                  "Share this join code. Teammates register at {url}, then pick “Join an existing workspace” and enter the code."
                ),
                {
                  url: <code className="font-mono text-[12px] text-text">{origin || "/register"}</code>,
                }
              )}
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[13px] tracking-wide text-text">
                {joinCode ?? t("No active code")}
              </code>
              {joinCode && (
                <button
                  type="button"
                  onClick={() => void copy("code")}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  {copied === "code" ? <Check size={12} /> : <Copy size={12} />}
                  {copied === "code" ? t("Copied") : t("Copy")}
                </button>
              )}
            </div>
            {link && (
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted">{t("Invite link")}</div>
                <div className="flex items-center gap-2">
                  <code
                    data-testid="invite-link"
                    className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[12px] text-text"
                  >
                    {link}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy("link")}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
                  >
                    {copied === "link" ? <Check size={12} /> : <Copy size={12} />}
                    {copied === "link" ? t("Copied") : t("Copy link")}
                  </button>
                </div>
              </div>
            )}
            {isAdmin && workspaceId && (
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted">{t("Add an existing account")}</div>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void invite();
                  }}
                >
                  <input
                    value={who}
                    onChange={(e) => setWho(e.target.value)}
                    placeholder={t("User name")}
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-[13px] text-text outline-none focus:border-border-strong"
                  />
                  <button
                    type="submit"
                    disabled={inviteBusy || !who.trim()}
                    className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                  >
                    {t("Add")}
                  </button>
                </form>
                {inviteMsg && (
                  <p className={`mt-1 text-[12px] ${inviteMsg.ok ? "text-muted" : "text-danger"}`}>{inviteMsg.text}</p>
                )}
              </div>
            )}
            <p className="text-[12px] leading-relaxed text-faint">
              {t("Anyone with the code can join {name}. Admins can rotate it in Settings → Members.", {
                name: workspaceName,
              })}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
