"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, X } from "lucide-react";

// The register URL is only knowable in the browser; useSyncExternalStore lets the
// server render the empty snapshot and the client swap in the real origin after
// hydration instead of a mismatch.
const NO_SUBSCRIBE = () => () => {};

export function InviteDialog({
  workspaceName,
  joinCode,
  onClose,
}: {
  workspaceName: string;
  joinCode: string | null;
  onClose: () => void;
}) {
  const origin = useSyncExternalStore(
    NO_SUBSCRIBE,
    () => window.location.origin,
    () => ""
  );
  const [copied, setCopied] = useState(false);

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

  async function copyCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
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
          aria-label="Invite teammates"
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-faint">
            <span>
              {workspaceName} <span className="mx-1">›</span>
              <span className="text-muted">Invite teammates</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-3 px-4 py-4">
            <p className="text-[13px] leading-relaxed text-muted">
              Share this join code. Teammates register at{" "}
              <code className="font-mono text-[12px] text-text">{origin || "/register"}</code>,
              then pick “Join an existing workspace” and enter the code.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[13px] tracking-wide text-text">
                {joinCode ?? "No active code"}
              </code>
              {joinCode && (
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>
            <p className="text-[12px] leading-relaxed text-faint">
              Anyone with the code can join {workspaceName}. Admins can rotate it in
              Settings → Members.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
