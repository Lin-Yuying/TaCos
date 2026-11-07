"use client";

import { useState } from "react";
import { CheckCircle2, CornerUpLeft, Pencil, RotateCcw, SmilePlus, Trash2 } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { MentionBox } from "@/components/mention-box";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu } from "@/components/menu";
import { timeAgo } from "@/lib/format";
import { COMMENT_REACTIONS, COMMENT_REACTION_META } from "@/lib/constants";
import {
  deleteCommentAction,
  editCommentAction,
  restoreCommentAction,
  setCommentResolvedAction,
  toggleCommentReactionAction,
} from "@/app/actions";
import type { Comment, IssueDetail, Member } from "@/lib/issues";
import { commentAuthorName } from "./format";
import { useLocale, useT } from "@/components/i18n-context";

/**
 * U-11 task comments: one reply level, quoted parent, edit/delete, resolve/reopen and
 * the fixed reaction set. The composer stays the existing MentionBox so a comment is
 * still two rows and Cmd+Enter.
 */
export function CommentsSection({
  workspaceId,
  issueId,
  currentUserId,
  canModerate,
  comments,
  members = [],
  comment,
  busy,
  onCommentChange,
  onSubmit,
  onDetail,
}: {
  workspaceId: string;
  issueId: string;
  currentUserId: string;
  canModerate: boolean;
  comments: Comment[];
  members?: Member[];
  comment: string;
  busy: boolean;
  onCommentChange: (value: string) => void;
  onSubmit: (parentId?: string) => void;
  onDetail: (detail: IssueDetail) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string } | null>(null);

  const byId = new Map(comments.map((item) => [item.id, item]));
  const topLevel = comments.filter((item) => !item.parentId);
  const replies = new Map<string, Comment[]>();
  for (const item of comments) {
    if (!item.parentId) continue;
    const root = byId.get(item.parentId);
    if (!root) continue;
    const list = replies.get(root.id) ?? [];
    list.push(item);
    replies.set(root.id, list);
  }
  const open = topLevel.filter((item) => !item.resolvedAt);
  const resolved = topLevel.filter((item) => item.resolvedAt);
  const visible = showResolved ? [...open, ...resolved] : open;

  async function run(
    id: string,
    work: () => Promise<{ ok: boolean; data?: IssueDetail; error?: string }>
  ): Promise<boolean> {
    if (pending) return false;
    setPending(id);
    try {
      const result = await work();
      if (result.ok && result.data) {
        onDetail(result.data);
        setError(null);
        return true;
      }
      if (!result.ok) setError(result.error ?? t("Could not save. Retry."));
      return false;
    } catch {
      setError(t("Could not save. Retry."));
      return false;
    } finally {
      setPending(null);
    }
  }

  function authorName(item: Comment) {
    return commentAuthorName(item, t);
  }

  function quote(item: Comment) {
    const text = item.body.replace(/\s+/g, " ").trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  }

  function canDelete(item: Comment) {
    return !item.deletedAt && (canModerate || (item.author?.id ?? "") === currentUserId);
  }

  function commentRow(item: Comment, isReply: boolean) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    const isAuthor = (item.author?.id ?? "") === currentUserId;
    return (
      <div
        key={item.id}
        data-comment-id={item.id}
        data-testid={`comment-${item.id}`}
        data-comment-state={item.deletedAt ? "deleted" : item.resolvedAt ? "resolved" : "open"}
        tabIndex={-1}
        className={`group rounded-md px-1 py-1 ${isReply ? "ml-5 border-l border-border pl-3" : ""}`}
      >
        <div className="flex items-baseline gap-2">
          {item.author ? (
            <AssigneeAvatar displayName={item.author.displayName} avatar={item.author.avatar} size={16} />
          ) : null}
          <span className="text-small font-medium text-muted">{authorName(item)}</span>
          <span suppressHydrationWarning className="text-caption text-faint">
            {timeAgo(item.createdAt, locale)}
          </span>
          {item.editedAt && !item.deletedAt && (
            <span className="text-caption text-faint" title={item.editedAt}>
              {t("edited")}
            </span>
          )}
          {item.reviewState && (
            <span
              data-testid="comment-review-badge"
              className={`rounded-full border px-1.5 py-px text-caption ${
                item.reviewState === "approve"
                  ? "border-accent/40 text-accent"
                  : "border-[#f2994a]/50 text-[#f2994a]"
              }`}
            >
              {t(item.reviewState === "approve" ? "Approved" : "Changes requested")}
            </span>
          )}
          {!isReply && item.resolvedAt && (
            <span className="rounded-full border border-border px-1.5 py-px text-caption text-faint">
              {t("Resolved")}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {!item.deletedAt && (
              <Menu
                width={212}
                trigger={
                  <span
                    className="rounded p-1"
                    title={t("React")}
                    aria-label={t("React")}
                    data-testid={`comment-reactions-${item.id}`}
                  >
                    <SmilePlus size={13} />
                  </span>
                }
                triggerClassName="rounded p-1 text-faint hover:bg-elevated hover:text-text"
              >
                {(close) => (
                  <div className="flex items-center gap-0.5 p-1">
                    {COMMENT_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        title={t(COMMENT_REACTION_META[emoji].label)}
                        aria-label={t(COMMENT_REACTION_META[emoji].label)}
                        data-testid={`comment-reaction-${emoji}`}
                        onClick={() => {
                          close();
                          void run(item.id, () =>
                            toggleCommentReactionAction(workspaceId, issueId, item.id, emoji)
                          );
                        }}
                        className="rounded p-1 text-lead transition-colors hover:bg-elevated"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </Menu>
            )}
            {!item.deletedAt && !isReply && (
              <button
                type="button"
                onClick={() => setReplyTo(item)}
                data-testid={`comment-reply-${item.id}`}
                title={t("Reply")}
                aria-label={t("Reply")}
                className="rounded p-1 text-faint hover:bg-elevated hover:text-text"
              >
                <CornerUpLeft size={13} />
              </button>
            )}
            {!item.deletedAt && !isReply && (
              <button
                type="button"
                onClick={() =>
                  void run(item.id, () =>
                    setCommentResolvedAction(workspaceId, issueId, item.id, !item.resolvedAt)
                  )
                }
                data-testid={`comment-resolve-${item.id}`}
                title={item.resolvedAt ? t("Reopen") : t("Resolve")}
                aria-label={item.resolvedAt ? t("Reopen") : t("Resolve")}
                className={`rounded p-1 hover:bg-elevated ${
                  item.resolvedAt ? "text-accent" : "text-faint hover:text-accent"
                }`}
              >
                {item.resolvedAt ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
              </button>
            )}
            {!item.deletedAt && isAuthor && (
              <button
                type="button"
                onClick={() => setEditing({ id: item.id, body: item.body })}
                data-testid={`comment-edit-${item.id}`}
                title={t("Edit")}
                aria-label={t("Edit")}
                className="rounded p-1 text-faint hover:bg-elevated hover:text-text"
              >
                <Pencil size={13} />
              </button>
            )}
            {canDelete(item) && (
              <button
                type="button"
                onClick={() => {
                  void run(item.id, () =>
                    deleteCommentAction(workspaceId, issueId, item.id)
                  ).then((ok) => {
                    if (ok) setUndo({ id: item.id });
                    setEditing(null);
                  });
                }}
                data-testid={`comment-delete-${item.id}`}
                title={t("Delete comment")}
                aria-label={t("Delete comment")}
                className="rounded p-1 text-faint hover:bg-elevated hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            )}
            {item.deletedAt && (canModerate || isAuthor) && (
              <button
                type="button"
                onClick={() =>
                  void run(item.id, () => restoreCommentAction(workspaceId, issueId, item.id))
                }
                data-testid={`comment-restore-${item.id}`}
                className="rounded px-1 py-0.5 text-caption text-muted hover:bg-elevated hover:text-text"
              >
                {t("Restore")}
              </button>
            )}
          </span>
        </div>
        {item.deletedAt ? (
          <p className="mt-0.5 text-small italic text-faint">{t("Comment deleted")}</p>
        ) : editing?.id === item.id ? (
          <div className="mt-1">
            <MentionBox
              value={editing.body}
              members={members}
              busy={Boolean(pending)}
              onChange={(body) => setEditing({ id: item.id, body })}
              onSubmit={() => {
                if (!editing.body.trim()) return;
                void run(item.id, () =>
                  editCommentAction(workspaceId, issueId, item.id, editing.body)
                ).then((ok) => {
                  if (ok) setEditing(null);
                });
              }}
            />
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="mt-1 text-caption text-faint hover:text-text"
            >
              {t("Cancel")}
            </button>
          </div>
        ) : (
          <div className="text-body leading-relaxed text-text" data-testid="comment-body">
            {item.body ? (
              <Markdown source={item.body} />
            ) : item.reviewState ? (
              <span className="text-small italic text-faint">{t("No comment")}</span>
            ) : null}
          </div>
        )}
        {isReply && parent && !item.deletedAt && (
          <p className="mt-0.5 text-caption text-faint">
            {t("Replying to {name}: “{quote}”", {
              name: authorName(parent),
              quote: quote(parent),
            })}
          </p>
        )}
        {!item.deletedAt && item.reactions.length > 0 && (
          <div
            className="mt-1 flex flex-wrap items-center gap-1"
            data-testid={`comment-reaction-summary-${item.id}`}
          >
            {item.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                aria-pressed={reaction.mine}
                onClick={() =>
                  void run(item.id, () =>
                    toggleCommentReactionAction(workspaceId, issueId, item.id, reaction.emoji)
                  )
                }
                className={`flex items-center gap-1 rounded-full border px-1.5 py-px text-small transition-colors ${
                  reaction.mine
                    ? "border-accent/50 bg-accent/10 text-text"
                    : "border-border text-muted hover:border-border-strong"
                }`}
              >
                <span>{reaction.emoji}</span>
                <span className="text-caption tabular-nums">{reaction.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div data-testid="task-comments" className="space-y-1">
        {visible.map((item) => (
          <div key={item.id} data-testid="comment-thread">
            {commentRow(item, false)}
            {(replies.get(item.id) ?? []).map((reply) => commentRow(reply, true))}
          </div>
        ))}
        {visible.length === 0 && (
          <p className="px-1 py-1 text-small text-faint">{t("No comments yet. Start the thread.")}</p>
        )}
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((current) => !current)}
            data-testid="toggle-resolved-comments"
            className="px-1 py-1 text-small text-faint hover:text-text"
          >
            {showResolved
              ? t("Hide {count} resolved", { count: resolved.length })
              : t("Show {count} resolved", { count: resolved.length })}
          </button>
        )}
        {error && (
          <p role="alert" className="px-1 text-small text-danger">
            {t(error)}
          </p>
        )}
        {undo && (
          <div className="flex items-center gap-2 px-1 text-caption text-faint">
            <span>{t("Comment deleted")}</span>
            <button
              type="button"
              onClick={() => {
                void run(undo.id, () =>
                  restoreCommentAction(workspaceId, issueId, undo.id)
                );
                setUndo(null);
              }}
              data-testid="comment-undo-delete"
              className="text-accent hover:underline"
            >
              {t("Undo")}
            </button>
          </div>
        )}
      </div>

      {replyTo && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-elevated/40 px-2 py-1 text-small text-muted">
          <span className="min-w-0 truncate">
            {t("Replying to {name}", { name: authorName(replyTo) })}
          </span>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="ml-auto shrink-0 text-faint hover:text-text"
          >
            {t("Cancel")}
          </button>
        </div>
      )}
      <div data-testid="comment-composer">
        <MentionBox
          value={comment}
          members={members}
          busy={busy}
          onChange={onCommentChange}
          onSubmit={() => {
            onSubmit(replyTo?.id);
            setReplyTo(null);
          }}
          focusOn={replyTo?.id}
        />
      </div>
    </>
  );
}
