"use client";

import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { useDetailSource } from "@/components/detail-navigation";
import { BatchSelection } from "@/components/ui/batch-selection";
import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { useRef } from "react";
import { FileText, Lock, Users } from "lucide-react";
import { NewPageMenu } from "@/components/new-page-menu";
import { timeAgo } from "@/lib/format";
import type { PageSummary } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

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

  const scroller=useRef<HTMLDivElement>(null);useScrollMemory(scroller,`project-documents.${projectId}`);

  useDetailSource("document",pages.map(page=>page.id));
  return (
    <div ref={scroller} className="flex-1 overflow-y-auto">
      <div className={`w-full pb-8 pt-6 ${PAGE_INSET}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lead font-semibold tracking-tight">{t("Documents")}</h2>
            <p className="mt-0.5 text-small text-muted">
              {t("Pages created here belong to this project. They stay private until you share them with the workspace.")}
            </p>
          </div>
          <NewPageMenu workspaceId={workspaceId} projectId={projectId} />
        </div>

        <BatchSelection workspaceId={workspaceId} kind="document" items={pages}/>

        {pages.length === 0 ? (
          <p className="mt-8 text-body text-faint">
            {t("No documents in this project yet — create one to keep notes, specs or links next to the tasks.")}
          </p>
        ) : (
          <div className="mt-5 space-y-0.5">
            {pages.map((page) => (
              <EntityRow key={page.id} kind="document" id={page.id} title={page.title}>
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
            </EntityRow>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
