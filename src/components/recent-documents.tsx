"use client";
import Link from "next/link";
import { useStoredJson } from "@/lib/use-stored-json";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
export function RecentDocuments({
  workspaceId,
  pages,
}: {
  workspaceId: string;
  pages: { id: string; title: string }[];
}) {
  const { scope } = useUI(),
    t = useT();
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
          className="block truncate rounded px-1 py-1 text-muted hover:bg-elevated"
        >
          {page.title}
        </Link>
      ))}
    </section>
  ) : null;
}
