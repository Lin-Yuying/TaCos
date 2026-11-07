"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/i18n-context";
import { Modal } from "@/components/ui/modal";
import { inviteMemberAction } from "@/app/auth-actions";

// The register URL is only knowable in the browser; useSyncExternalStore lets the
// server render the empty snapshot and the client swap in the real origin after
// hydration instead of a mismatch.
const NO_SUBSCRIBE = () => () => {};

export function InviteDialog({
  workspaceId,
  isAdmin = false,
  joinCode,
  onClose,
}: {
  workspaceId?: string;
  workspaceName?: string;
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
    <Modal open onClose={onClose} title={t("Invite teammates")} className="max-w-[480px] !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-lead font-semibold text-text">{t("Invite teammates")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
          className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        {link && (
          <div>
            <div className="mb-1 text-small font-medium text-muted">{t("Invite link")}</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                aria-label={t("Invite link")}
                value={link}
                data-testid="invite-link"
                className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg text-text outline-none text-body"
              />
              <button
                type="button"
                onClick={() => void copy("link")}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 bg-accent font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {copied === "link" ? t("Copied") : t("Copy link")}
              </button>
            </div>
          </div>
        )}
        <div>
          <div className="mb-1 text-small font-medium text-muted">{t("Join code")}</div>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label={t("Join code")}
              value={joinCode ?? t("No active code")}
              className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg text-body tracking-wide text-text outline-none"
            />
            {joinCode && (
              <button
                type="button"
                onClick={() => void copy("code")}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 border border-border transition-colors bg-bg text-text hover:bg-active"
              >
                {copied === "code" ? t("Copied") : t("Copy")}
              </button>
            )}
          </div>
        </div>
        {isAdmin && workspaceId && (
          <div>
            <div className="mb-1 text-small font-medium text-muted">{t("Add an existing account")}</div>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <input
                onKeyDown={(event)=>{if(event.key==="Enter"&&event.nativeEvent.isComposing)event.preventDefault();}}
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-label={t("User name")}
                placeholder={t("User name")}
                className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg text-body text-text outline-none focus:border-border-strong"
              />
              <button
                type="submit"
                disabled={inviteBusy || !who.trim()}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 border border-border transition-colors disabled:opacity-50 bg-bg text-text hover:bg-active"
              >
                {t("Add")}
              </button>
            </form>
            {inviteMsg && (
              <p className={`mt-1 text-small ${inviteMsg.ok ? "text-muted" : "text-danger"}`}>{inviteMsg.text}</p>
            )}
          </div>
        )}
        <p className="text-small leading-relaxed text-faint">
          {t("Anyone with the code can join. Admins can rotate it in Settings → Members.")}
        </p>
      </div>
    </Modal>
  );
}
