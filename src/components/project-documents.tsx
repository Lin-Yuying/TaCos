"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, Lock, Plus, Users } from "lucide-react";
import { createPageAction } from "@/app/pages-actions";
import { timeAgo } from "@/lib/format";
import type { PageSummary } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";

export function ProjectDocuments({
  workspaceId,
  projectId,
  pages,
}: {
  workspaceId: string;
  projectId: string;
  pages: PageSummary[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function createPage() {
    setCreating(true);
    const result = await createPageAction(workspaceId, { projectId });
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/${workspaceId}/docs/${result.data.id}`);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full px-10 pb-8 pt-6 lg:px-20 xl:px-32">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lead font-semibold tracking-tight">{t("Documents")}</h2>
            <p className="mt-0.5 text-small text-muted">
              {t("Pages created here belong to this project. They stay private until you share them with the workspace.")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void createPage()}
            disabled={creating}
            className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            <Plus size={13} /> {t("New page")}
          </button>
        </div>

        {error && <div className="mt-3 text-small text-danger">{t(error)}</div>}

        {pages.length === 0 ? (
          <p className="mt-8 text-body text-faint">
            {t("No documents in this project yet — create one to keep notes, specs or links next to the tasks.")}
          </p>
        ) : (
          <div className="mt-5 space-y-0.5">
            {pages.map((page) => (
              <Link
                key={page.id}
                href={`/${workspaceId}/docs/${page.id}`}
                style={{ paddingLeft: 8 + page.depth * 18 }}
                className="flex items-center gap-2 rounded-md py-1.5 pr-2 text-body text-text transition-colors hover:bg-elevated/60"
              >
                <span className="flex w-4 shrink-0 justify-center text-body">
                  {page.icon ?? <FileText size={13} className="text-faint" />}
                </span>
                <span className="truncate">{page.title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-caption text-faint">
                  <span>{timeAgo(page.updatedAt, locale)}</span>
                  <span className="flex items-center gap-1">
                    {page.shared ? <Users size={11} /> : <Lock size={11} />}
                    {page.shared ? t("Shared") : t("Private")}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
