"use client";

import type { ReactNode } from "react";
import {
  Bot,
  FileText,
  FolderKanban,
  MessageSquare,
  Paperclip,
  SquareCheck,
  Tag,
  User,
  Zap,
} from "lucide-react";
import type { SearchHit } from "@/lib/search";
import { GROUP_LABELS, KIND_GROUP, type SearchKind } from "@/lib/search-query";
import { useT } from "@/components/i18n-context";

const ICONS: Record<SearchKind, typeof FileText> = {
  task: SquareCheck,
  task_comment: MessageSquare,
  doc: FileText,
  doc_comment: MessageSquare,
  project: FolderKanban,
  person: User,
  label: Tag,
  agent_thread: Bot,
  attachment: Paperclip,
  automation: Zap,
};

export function SearchKindIcon({ kind, size = 14 }: { kind: SearchKind; size?: number }) {
  const Icon = ICONS[kind];
  return <Icon size={size} className="shrink-0 text-faint" aria-hidden />;
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Marks every query word in a title or snippet without rendering server text as HTML. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 12)
    .map(escapePattern);
  if (!text || !words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded-sm bg-elevated px-0.5 text-text"
            data-search-highlight
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

/**
 * The shared body of one search result. The palette and the search page use the same
 * markup so a hit reads the same in both places.
 */
export function SearchHitLabel({
  hit,
  query,
  trailing,
  showKind = true,
}: {
  hit: SearchHit;
  query: string;
  trailing?: ReactNode;
  showKind?: boolean;
}) {
  const t = useT();
  const meta = [
    showKind ? t(GROUP_LABELS[KIND_GROUP[hit.kind]]) : null,
    hit.context,
    hit.byline,
  ].filter(Boolean);
  return (
    <>
      <SearchKindIcon kind={hit.kind} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {hit.ref && (
            <span className="max-w-[140px] shrink-0 truncate font-mono text-small text-faint">
              {hit.ref}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">
            <Highlight text={hit.title || t("Untitled")} query={query} />
          </span>
        </span>
        {hit.snippet && (
          <span className="block truncate text-small text-faint">
            <Highlight text={hit.snippet} query={query} />
          </span>
        )}
        {meta.length > 0 && (
          <span className="block truncate text-caption text-faint">{meta.join(" · ")}</span>
        )}
      </span>
      {trailing}
    </>
  );
}
