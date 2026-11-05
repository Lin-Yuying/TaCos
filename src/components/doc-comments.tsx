"use client";

import { useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { AssigneeAvatar } from "@/components/issue-table";
import { MentionBox } from "@/components/mention-box";
import { useLocale, useT } from "@/components/i18n-context";
import { timeAgo } from "@/lib/format";
import type { DocAnchor } from "@/lib/doc-anchor";
import type { Member } from "@/lib/issues";
import type { PageComment } from "@/lib/page-comments";

export function DocCommentsPanel({
  comments,
  members,
  userId,
  isOwner,
  canComment,
  compact,
  located,
  draftAnchor,
  active,
  busy,
  onAdd,
  onResolve,
  onRemove,
  onSelect,
  onClearDraft,
  onClose,
  page,
  onShare,
}: {
  comments: PageComment[];
  members: Member[];
  userId: string | null;
  isOwner: boolean;
  canComment: boolean;
  page: { shared: boolean; createdBy: string };
  onShare?: () => void;
  compact: boolean;
  // Comments whose quote can still be found in the text.
  located: Set<string>;
  draftAnchor: DocAnchor | null;
  active: string | null;
  busy: boolean;
  onAdd: (body: string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onClearDraft: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [body, setBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((comment) => !comment.resolvedAt);
  const resolved = comments.filter((comment) => comment.resolvedAt);

  async function submit() {
    if (await onAdd(body)) setBody("");
  }

  function row(comment: PageComment) {
    const canRemove = isOwner || comment.author?.id === userId;
    return (
      <div
        key={comment.id}
        data-doc-comment
        onClick={() => comment.quote && onSelect(comment.id)}
        className={`group rounded-md px-2 py-2 ${comment.quote ? "cursor-pointer" : ""} ${
          active === comment.id ? "bg-elevated/60" : "hover:bg-elevated/40"
        }`}
      >
        <div className="flex items-center gap-2">
          {comment.author && (
            <AssigneeAvatar displayName={comment.author.displayName} avatar={comment.author.avatar} size={16} />
          )}
          <span className="min-w-0 truncate text-small font-medium text-muted">{comment.author?.displayName}</span>
          <span suppressHydrationWarning className="text-caption text-faint">
            {timeAgo(comment.createdAt, locale)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {canComment && <button
              type="button"
              title={comment.resolvedAt ? t("Reopen") : t("Resolve")}
              aria-label={comment.resolvedAt ? t("Reopen") : t("Resolve")}
              onClick={(event) => {
                event.stopPropagation();
                onResolve(comment.id, !comment.resolvedAt);
              }}
              className="rounded p-1 text-faint hover:bg-elevated hover:text-text"
            >
              {comment.resolvedAt ? <RotateCcw size={12} /> : <Check size={12} />}
            </button>}
            {canRemove && (
              <button
                type="button"
                title={t("Delete comment")}
                aria-label={t("Delete comment")}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(comment.id);
                }}
                className="rounded p-1 text-faint hover:bg-elevated hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>
        {comment.quote && (
          <blockquote className="mt-1 line-clamp-2 border-l-2 border-border-strong pl-2 text-small text-muted">
            {comment.quote}
          </blockquote>
        )}
        {comment.quote && !comment.resolvedAt && !located.has(comment.id) && (
          <p className="mt-1 text-small text-faint">{t("The quoted text has changed.")}</p>
        )}
        <div className="mt-1 text-body leading-relaxed text-text">
          <Markdown source={comment.body} />
        </div>
      </div>
    );
  }

  return (
    <aside
      data-doc-comments
      className={`flex min-h-0 flex-col border-l border-border bg-bg ${
        compact ? "absolute inset-0 z-10 border-l-0" : "w-[340px] shrink-0"
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3 text-body font-medium text-text">
        <MessageSquare size={13} />
        {t("Comments")}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close comments")}
          title={t("Close comments")}
          className="ml-auto rounded p-1 text-muted hover:bg-elevated hover:text-text"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {comments.length === 0 && <p className="px-2 py-2 text-body text-faint">{t("No comments yet.")}</p>}
        {open.map(row)}
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            className="mt-2 px-2 text-small text-faint hover:text-text"
          >
            {t(showResolved ? "Hide {count} resolved" : "Show {count} resolved", { count: resolved.length })}
          </button>
        )}
        {showResolved && resolved.map(row)}
      </div>
      {canComment && <div className="shrink-0 border-t border-border p-2">
        {draftAnchor && (
          <div className="mb-1.5 flex items-start gap-1">
            <blockquote className="line-clamp-2 min-w-0 flex-1 border-l-2 border-border-strong pl-2 text-small text-muted">
              {draftAnchor.quote}
            </blockquote>
            <button
              type="button"
              onClick={onClearDraft}
              aria-label={t("Comment on the whole document")}
              title={t("Comment on the whole document")}
              className="rounded p-0.5 text-faint hover:text-text"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <MentionBox
          value={body}
          members={members}
          busy={busy}
          onChange={setBody}
          onSubmit={() => void submit()}
          focusOn={draftAnchor}
          page={page}
          isOwner={isOwner}
          onShare={onShare}
        />
      </div>}
    </aside>
  );
}
