"use client";

import { Markdown } from "@/components/markdown";
import { MentionBox } from "@/components/mention-box";
import { AssigneeAvatar } from "@/components/issue-table";
import { timeAgo } from "@/lib/format";
import type { Comment, Member } from "@/lib/issues";
import { commentAuthorName } from "./format";
import { useLocale, useT } from "@/components/i18n-context";

/**
 * Renders straight into the panel footer, so the comments and the composer stay direct
 * children of the footer's `space-y-2` column.
 */
export function CommentsSection({
  comments,
  members = [],
  comment,
  busy,
  onCommentChange,
  onSubmit,
}: {
  comments: Comment[];
  members?: Member[];
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
            <span className="text-small font-medium text-muted">{commentAuthorName(item, t)}</span>
            <span suppressHydrationWarning className="text-caption text-faint">
              {timeAgo(item.createdAt, locale)}
            </span>
          </div>
          {/* Comments arrive in Markdown too, so an agent's checklist keeps its ticks. */}
          <div className="text-body leading-relaxed text-text">
            <Markdown source={item.body} />
          </div>
        </div>
      ))}

      <MentionBox value={comment} members={members} busy={busy} onChange={onCommentChange} onSubmit={onSubmit} />
    </>
  );
}
