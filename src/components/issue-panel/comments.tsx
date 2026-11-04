"use client";

import { useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
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
  const box = useRef<HTMLTextAreaElement>(null);
  // H-COLLAB-10: "@" opens a member list. The query is the text after "@" up to the caret.
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const matches =
    query === null
      ? []
      : members
          .filter(
            (m) =>
              m.username.toLowerCase().startsWith(query.toLowerCase()) ||
              m.displayName.toLowerCase().includes(query.toLowerCase())
          )
          .slice(0, 6);

  function track(value: string, caret: number) {
    const found = /(^|\s)@([A-Za-z0-9_.-]*)$/.exec(value.slice(0, caret));
    setQuery(found ? found[2] : null);
    setPick(0);
  }

  function insert(member: Member) {
    const el = box.current;
    const caret = el?.selectionStart ?? comment.length;
    const head = comment.slice(0, caret).replace(/@([A-Za-z0-9_.-]*)$/, `@${member.username} `);
    const next = head + comment.slice(caret);
    onCommentChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  }

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

      <div className="relative rounded-lg border border-border bg-elevated/40 p-2">
        {matches.length > 0 && (
          <div
            data-testid="mention-menu"
            className="absolute bottom-full left-2 z-20 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
          >
            {matches.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(m);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[12.5px] ${
                  i === pick ? "bg-elevated text-text" : "text-muted"
                }`}
              >
                <AssigneeAvatar displayName={m.displayName} avatar={m.avatar} size={16} />
                <span className="truncate">{m.displayName}</span>
                <span className="ml-auto text-[11px] text-faint">@{m.username}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={box}
          value={comment}
          onChange={(e) => {
            onCommentChange(e.target.value);
            track(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={() => setQuery(null)}
          onKeyDown={(e) => {
            if (matches.length > 0) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insert(matches[pick]);
                return;
              }
              if (e.key === "Escape") {
                setQuery(null);
                return;
              }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={t("Leave a comment… Type @ to mention someone")}
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
