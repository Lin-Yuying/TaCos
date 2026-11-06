"use client";

import { useT } from "@/components/i18n-context";
import type { MentionPerson } from "@/lib/mentions";

/** Shown while a private page names someone who cannot read it yet. */
export function DocMentionWarning({
  members,
  shared,
  isOwner,
  onShare,
}: {
  members: MentionPerson[];
  shared: boolean;
  isOwner: boolean;
  onShare?: () => void;
}) {
  const t = useT();
  if (!members.length) return null;
  const names = members.map((member) => member.displayName).join(", ");
  return (
    <div
      data-testid="doc-mention-warning"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-strong bg-surface px-3 py-2 text-small text-muted"
    >
      <span>{t("{names} cannot see this document.", { names })}</span>
      {isOwner && !shared && onShare && (
        <button
          type="button"
          onClick={onShare}
          className="font-medium text-accent hover:text-accent-hover"
        >
          {t("Share with workspace")}
        </button>
      )}
    </div>
  );
}
