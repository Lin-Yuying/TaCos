"use client";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useStoredJson } from "@/lib/use-stored-json";
import { useUI } from "@/components/ui-context";
import { useLocale, useT } from "@/components/i18n-context";
import { timeAgo } from "@/lib/format";

export function RecentDocuments({
  workspaceId,
  pages,
}: {
  workspaceId: string;
  pages: { id: string; title: string; icon: string | null; updatedAt: string }[];
}) {
  const { scope } = useUI(),
    t = useT(),
    locale = useLocale();
  const [recent, setRecent] = useStoredJson<string[]>(
    `tacos.recent-documents.${scope}`,
    [],
  );
  const items = recent
    .flatMap((id) => {
      const page = pages.find((page) => page.id === id);
      return page ? [page] : [];
    })
    .slice(0, 12);
  return items.length ? (
    <section className="px-2 py-1 text-small">
      <div className="flex gap-2 text-faint">
        <span className="flex-1">{t("Recent documents")}</span>
        <button onClick={() => setRecent([])}>{t("Clear history")}</button>
      </div>
      {items.map((page) => (
        <Link
          key={page.id}
          href={`/${workspaceId}/docs/${page.id}`}
          className="flex items-center gap-1.5 rounded px-1 py-1 text-muted hover:bg-elevated"
        >
          <span className="flex w-4 shrink-0 justify-center text-faint">
            {page.icon ?? <FileText size={12} />}
          </span>
          <span className="min-w-0 flex-1 truncate">{page.title}</span>
          <span suppressHydrationWarning className="shrink-0 text-caption text-faint">
            {timeAgo(page.updatedAt, locale)}
          </span>
        </Link>
      ))}
    </section>
  ) : null;
}
