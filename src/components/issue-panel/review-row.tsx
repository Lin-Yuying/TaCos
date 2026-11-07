"use client";

import { useState } from "react";
import { Check, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { MentionBox } from "@/components/mention-box";
import { reviewCommentAction } from "@/app/actions";
import type { IssueDetail, Member } from "@/lib/issues";

export type ReviewThreadStatus = "approved" | "pending" | "rejected" | "changes_requested";
import { useT } from "@/components/i18n-context";

/**
 * U-11 review thread. Request changes / Approve is one marked task comment, not a
 * separate review entity; the task's review status follows the decision and the comment
 * stays in the thread (and in Inbox for the people waiting on it).
 */
export function ReviewRow({
  workspaceId,
  issueId,
  status,
  members,
  onSaved,
  onError,
}: {
  workspaceId: string;
  issueId: string;
  status: ReviewThreadStatus;
  members: Member[];
  onSaved: (detail: IssueDetail) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"approve" | "request_changes" | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(decision: "approve" | "request_changes", text: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await reviewCommentAction(workspaceId, issueId, decision, text);
      if (result.ok) {
        onSaved(result.data);
        setMode(null);
        setBody("");
      } else {
        onError(result.error);
      }
    } catch {
      onError(t("Could not save. Retry."));
    } finally {
      setBusy(false);
    }
  }

  const label =
    status === "approved"
      ? t("Approved")
      : status === "pending"
        ? t("Waiting for review")
        : t("Changes requested");

  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2" data-testid="review-actions">
      <div className="flex items-center gap-2 text-small">
        <ShieldCheck size={13} className="text-faint" />
        <span className="text-muted">{t("Review")}</span>
        <span
          className={`rounded-full border px-1.5 py-px text-caption ${
            status === "approved"
              ? "border-accent/40 text-accent"
              : status === "pending"
                ? "border-border text-faint"
                : "border-[#f2994a]/50 text-[#f2994a]"
          }`}
        >
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode(mode === "request_changes" ? null : "request_changes")}
            data-testid="review-request-changes"
            aria-pressed={mode === "request_changes"}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            <MessageSquareWarning size={12} />
            {t("Request changes")}
          </button>
          <button
            type="button"
            onClick={() => void submit("approve", "")}
            disabled={busy}
            data-testid="review-approve"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            <Check size={12} />
            {t("Approve")}
          </button>
        </span>
      </div>
      {mode && (
        <div data-testid="review-comment-box">
          <MentionBox
            value={body}
            members={members}
            busy={busy}
            onChange={setBody}
            onSubmit={() => {
              if (!body.trim()) {
                onError(t("Say what needs to change"));
                return;
              }
              void submit("request_changes", body);
            }}
          />
          <button
            type="button"
            onClick={() => {
              setMode(null);
              setBody("");
            }}
            className="mt-1 text-caption text-faint hover:text-text"
          >
            {t("Cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
