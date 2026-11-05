"use client";

import { useEffect, useRef, useState } from "react";
import { AssigneeAvatar } from "@/components/issue-table";
import type { Member } from "@/lib/issues";
import { useT } from "@/components/i18n-context";
import { mentionText } from "@/lib/mentions";

/** The comment composer: "@" opens a member list, Cmd or Ctrl + Enter submits. */
export function MentionBox({
  value,
  members = [],
  busy,
  onChange,
  onSubmit,
  focusOn,
}: {
  value: string;
  members?: Member[];
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  // The caret comes here each time this changes to something.
  focusOn?: unknown;
}) {
  const t = useT();
  const box = useRef<HTMLTextAreaElement>(null);
  // H-COLLAB-10: "@" opens a member list. The query is the text after "@" up to the caret.
  const [query, setQuery] = useState<string | null>(null);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    if (focusOn) box.current?.focus();
  }, [focusOn]);

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

  function track(next: string, caret: number) {
    const found = /(^|[^A-Za-z0-9_.+\-/@])@([^\s@[\]]*)$/.exec(next.slice(0, caret));
    setQuery(found ? found[2] : null);
    setPick(0);
  }

  function insert(member: Member) {
    const el = box.current;
    const caret = el?.selectionStart ?? value.length;
    const head = value.slice(0, caret).replace(/@([^\s@[\]]*)$/, () => `${mentionText(member.username)} `);
    const next = head + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  }

  return (
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
              className={`flex w-full items-center gap-2 px-2 py-1 text-left text-small ${
                i === pick ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <AssigneeAvatar displayName={m.displayName} avatar={m.avatar} size={16} />
              <span className="truncate">{m.displayName}</span>
              <span className="ml-auto text-caption text-faint">@{m.username}</span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={box}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
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
        className="w-full resize-none bg-transparent text-body text-text placeholder:text-faint"
      />
      <div className="flex justify-end pt-1">
        <button
          type="button"
          disabled={!value.trim() || busy}
          onClick={onSubmit}
          className="rounded-md bg-accent px-2.5 py-1 text-small font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {t("Comment")}
        </button>
      </div>
    </div>
  );
}
