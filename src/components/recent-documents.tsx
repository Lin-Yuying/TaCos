"use client";
import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
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
  const [open, setOpen] = useStoredJson<boolean>(`tacos.recent-documents-open.${scope}`, false);
  return items.length ? (
    <section className="text-small">
      <div className="group/section mt-2.5 flex h-[26px] items-center gap-2 px-2 text-muted">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1 font-medium transition-colors hover:text-text">
          {t("Recent documents")}
          <ChevronRight size={11} className={`shrink-0 ${open ? "rotate-90" : ""}`} />
        </button>
        {open && <button type="button" onClick={() => setRecent([])} className="text-faint opacity-0 transition-opacity hover:text-text group-hover/section:opacity-100">{t("Clear history")}</button>}
      </div>
      {open && items.map((page) => (
        <Link
          key={page.id}
          href={`/${workspaceId}/docs/${page.id}`}
          data-nav-new-tab=""
          className="flex h-[30px] items-center gap-[9px] rounded-[7px] px-2 text-body text-[#2b2b2b] hover:bg-elevated"
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
