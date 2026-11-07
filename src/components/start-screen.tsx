"use client";
import { usePrimaryModifier } from "@/lib/ui/platform";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen, Bot, FileText, FolderPlus, List, SquarePen } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { ProjectIcon } from "@/components/icons";
import { formatDate } from "@/lib/format";
import type { Project } from "@/lib/issues";
import type { PageSummary } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";

function ActionCard({
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
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 bg-bg px-3.5 py-2.5 text-left text-text transition-colors hover:border-border-strong hover:bg-elevated/50"
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        <span className="block text-small text-faint">{hint}</span>
      </span>
      <ArrowUpRight
        size={14}
        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}

function JumpRow({
  href,
  icon,
  title,
  meta,
  divider,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  meta?: string;
  divider: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 px-3.5 py-2 text-body text-text transition-colors hover:bg-elevated/60 ${
        divider ? "border-t border-border" : ""
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta ? <span className="shrink-0 text-small text-faint" suppressHydrationWarning>{meta}</span> : null}
      <ArrowUpRight
        size={13}
        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
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
    <div className="flex min-h-0 flex-1 justify-center overflow-auto px-6 py-10">
      <div className="w-full max-w-[600px]">
        <p className="mb-4 px-1 text-body text-muted">
          {t("Nothing is open. Start something, or pick up where you left off.")}
        </p>

        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          <ActionCard
            icon={<SquarePen size={16} />}
            title={t("New task")}
            hint={t("Capture something to work on — press C anywhere")}
            onClick={() => setComposerOpen(true)}
          />
          <ActionCard
            icon={<FolderPlus size={16} />}
            title={t("New project")}
            hint={t("Group tasks under a shared goal")}
            onClick={() => setProjectComposerOpen(true)}
          />
          <ActionCard
            icon={<Bot size={16} />}
            title={t("Ask Agent")}
            hint={t("Plan, draft and edit with the workspace agent")}
            onClick={() => router.push(`/${workspaceId}/agent`)}
          />
          <ActionCard
            icon={<List size={16} />}
            title={t("All tasks")}
            hint={t("See everything across projects")}
            onClick={() => router.push(`/${workspaceId}`)}
          />
          <ActionCard
            icon={<BookOpen size={16} />}
            title={t("Documents")}
            hint={t("Open the document library")}
            onClick={() => router.push(`/${workspaceId}/docs`)}
          />
        </div>

        {recentProjects.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-wider text-faint">
              {t("Projects")}
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {recentProjects.map((project, index) => (
                <JumpRow
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  icon={<ProjectIcon color={project.color} icon={project.icon} size={15} />}
                  title={project.name}
                  divider={index > 0}
                />
              ))}
            </div>
          </section>
        )}

        {recentPages.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-caption font-medium uppercase tracking-wider text-faint">
              {t("Recent documents")}
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {recentPages.map((page, index) => (
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
                  meta={formatDate(page.updatedAt, locale)}
                  divider={index > 0}
                />
              ))}
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mt-8 flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {t("Jump anywhere")}
          <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-caption">{modifier}K</kbd>
        </button>
      </div>
    </div>
  );
}
