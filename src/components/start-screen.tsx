"use client";
import { usePrimaryModifier } from "@/lib/ui/platform";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Bot, Box, FileText, List, Plus, Search } from "lucide-react";
import { BOX, BTN, KBD, LINE, LINE_SUB, NARROW_PAGE, SEC, SEC_TITLE } from "@/lib/page-chrome";
import { useUI } from "@/components/ui-context";
import { ProjectIcon } from "@/components/icons";
import { friendlyDate } from "@/lib/format";
import type { Project } from "@/lib/issues";
import type { PageSummary } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";

function ActionRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`${LINE} w-full text-left text-text`}>
      <span className="flex w-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block">{title}</span>
        <span className={`block ${LINE_SUB}`}>{hint}</span>
      </span>
    </button>
  );
}

function JumpRow({
  href,
  icon,
  title,
  meta,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  meta?: string;
}) {
  return (
    <Link href={href} className={`${LINE} text-text`}>
      <span className="flex w-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta ? <span className={`shrink-0 ${LINE_SUB}`} suppressHydrationWarning>{meta}</span> : null}
    </Link>
  );
}

export function StartScreen({
  workspaceId,
  projects,
  pages,
}: {
  workspaceId: string;
  projects: Project[];
  pages: PageSummary[];
}) {
  const t = useT();
  const locale = useLocale();
  const modifier=usePrimaryModifier();
  const router = useRouter();
  const { setComposerOpen, setProjectComposerOpen, setPaletteOpen } = useUI();
  // `listPageTree` is already ordered like the sidebar; recency is what belongs here.
  const recentPages = [...pages]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);
  const recentProjects = projects.slice(0, 5);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={`${NARROW_PAGE} max-w-[640px]`}>
        <p className="text-body text-muted">
          {t("Nothing is open. Start something, or pick up where you left off.")}
        </p>

        <div className={BOX}>
          <ActionRow
            icon={<Plus size={14} />}
            title={t("New task")}
            hint={t("Capture something to work on — press C anywhere")}
            onClick={() => setComposerOpen(true)}
          />
          <ActionRow
            icon={<Box size={14} />}
            title={t("New project")}
            hint={t("Group tasks under a shared goal")}
            onClick={() => setProjectComposerOpen(true)}
          />
          <ActionRow
            icon={<Bot size={14} />}
            title={t("Ask Agent")}
            hint={t("Plan, draft and edit with the workspace agent")}
            onClick={() => router.push(`/${workspaceId}/agent`)}
          />
          <ActionRow
            icon={<List size={14} />}
            title={t("All tasks")}
            hint={t("See everything across projects")}
            onClick={() => router.push(`/${workspaceId}`)}
          />
          <ActionRow
            icon={<FileText size={14} />}
            title={t("Documents")}
            hint={t("Open the document library")}
            onClick={() => router.push(`/${workspaceId}/docs`)}
          />
        </div>

        {recentProjects.length > 0 && (
          <section className={SEC}>
            <h2 className={SEC_TITLE}>{t("Projects")}</h2>
            <div className={BOX}>
              {recentProjects.map((project) => (
                <JumpRow
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  icon={<ProjectIcon color={project.color} icon={project.icon} size={14} />}
                  title={project.name}
                />
              ))}
            </div>
          </section>
        )}

        {recentPages.length > 0 && (
          <section className={SEC}>
            <h2 className={SEC_TITLE}>{t("Recent documents")}</h2>
            <div className={BOX}>
              {recentPages.map((page) => (
                <JumpRow
                  key={page.id}
                  href={`/${workspaceId}/docs/${page.id}`}
                  icon={
                    page.icon ? (
                      <span className="text-body leading-none">{page.icon}</span>
                    ) : (
                      <FileText size={14} />
                    )
                  }
                  title={page.title}
                  meta={friendlyDate(page.updatedAt, locale)}
                />
              ))}
            </div>
          </section>
        )}

        <button type="button" onClick={() => setPaletteOpen(true)} className={`${BTN} self-start`}>
          <Search size={13} />
          {t("Jump anywhere")}
          <kbd className={KBD}>{modifier}K</kbd>
        </button>
      </div>
    </div>
  );
}
