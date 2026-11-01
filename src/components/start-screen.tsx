"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen, Bot, FileText, FolderPlus, List, SquarePen } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { ProjectIcon, WorkspaceMark } from "@/components/icons";
import type { Project } from "@/lib/issues";
import type { PageSummary } from "@/lib/pages";

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
      className="group flex items-center gap-3 rounded-xl border border-border bg-bg px-3.5 py-3 text-left text-text transition-colors hover:border-border-strong hover:bg-elevated/50"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11.5px] text-faint">{hint}</span>
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
  divider,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  divider: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-text transition-colors hover:bg-elevated/60 ${
        divider ? "border-t border-border" : ""
      }`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <ArrowUpRight
        size={13}
        className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

export function StartScreen({
  workspaceId,
  workspaceName,
  workspaceIcon,
  projects,
  pages,
}: {
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  projects: Project[];
  pages: PageSummary[];
}) {
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
        <div className="mb-7 flex items-center gap-3">
          <WorkspaceMark icon={workspaceIcon} className="h-9 w-9" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-text">{workspaceName}</div>
            <div className="text-[12.5px] text-muted">
              Nothing is open. Start something, or pick up where you left off.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ActionCard
            icon={<SquarePen size={16} />}
            title="New task"
            hint="Capture something to work on — press C anywhere"
            onClick={() => setComposerOpen(true)}
          />
          <ActionCard
            icon={<FolderPlus size={16} />}
            title="New project"
            hint="Group tasks under a shared goal"
            onClick={() => setProjectComposerOpen(true)}
          />
          <ActionCard
            icon={<Bot size={16} />}
            title="Ask Agent"
            hint="Plan, draft and edit with the workspace agent"
            onClick={() => router.push(`/${workspaceId}/agent`)}
          />
          <ActionCard
            icon={<List size={16} />}
            title="All tasks"
            hint="See everything across projects"
            onClick={() => router.push(`/${workspaceId}`)}
          />
          <ActionCard
            icon={<BookOpen size={16} />}
            title="Documents"
            hint="Open the document library"
            onClick={() => router.push(`/${workspaceId}/docs`)}
          />
        </div>

        {recentProjects.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              Projects
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {recentProjects.map((project, index) => (
                <JumpRow
                  key={project.id}
                  href={`/${workspaceId}/projects/${project.id}`}
                  icon={<ProjectIcon color={project.color} size={15} />}
                  title={project.name}
                  divider={index > 0}
                />
              ))}
            </div>
          </section>
        )}

        {recentPages.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              Recent documents
            </h2>
            <div className="overflow-hidden rounded-xl border border-border">
              {recentPages.map((page, index) => (
                <JumpRow
                  key={page.id}
                  href={`/${workspaceId}/docs/${page.id}`}
                  icon={
                    page.icon ? (
                      <span className="text-[14px] leading-none">{page.icon}</span>
                    ) : (
                      <FileText size={14} />
                    )
                  }
                  title={page.title}
                  divider={index > 0}
                />
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 flex items-center gap-4 px-1 text-[11.5px] text-faint">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-1.5 transition-colors hover:text-text"
          >
            <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[10.5px]">
              ⌘K
            </kbd>
            Jump anywhere
          </button>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-surface px-1 py-0.5 text-[10.5px]">C</kbd>
            New task
          </span>
        </div>
      </div>
    </div>
  );
}
