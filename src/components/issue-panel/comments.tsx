"use client";

import { Markdown } from "@/components/markdown";
import { AssigneeAvatar } from "@/components/issue-table";
import { timeAgo } from "@/lib/format";
import type { Comment } from "@/lib/issues";
import { commentAuthorName } from "./format";
import { useLocale, useT } from "@/components/i18n-context";

/**
 * Renders straight into the panel footer, so the comments and the composer stay direct
 * children of the footer's `space-y-2` column.
 */
export function CommentsSection({
  comments,
  comment,
  busy,
  onCommentChange,
  onSubmit,
}: {
  comments: Comment[];
  comment: string;
  busy: boolean;
  onCommentChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      {comments.map((item) => (
        <div key={item.id} className="px-1 py-1">
          <div className="flex items-baseline gap-2">
            {item.author ? (
              <AssigneeAvatar
                displayName={item.author.displayName}
                avatar={item.author.avatar}
                size={16}
              />
            ) : null}
            <span className="text-[12px] font-medium text-muted">{commentAuthorName(item, t)}</span>
            <span suppressHydrationWarning className="text-[11px] text-faint">
              {timeAgo(item.createdAt, locale)}
            </span>
          </div>
          {/* Comments arrive in Markdown too, so an agent's checklist keeps its ticks. */}
          <div className="text-[13px] leading-relaxed text-text">
            <Markdown source={item.body} />
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-border bg-elevated/40 p-2">
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={t("Leave a comment…")}
          rows={2}
          className="w-full resize-none bg-transparent text-[13px] text-text placeholder:text-faint"
        />
        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={!comment.trim() || busy}
            onClick={onSubmit}
            className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t("Comment")}
          </button>
        </div>
      </div>
    </>
  );
}
