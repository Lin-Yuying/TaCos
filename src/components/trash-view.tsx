"use client";

import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  purgeIssueAction,
  purgeProjectAction,
  restoreIssueAction,
  restoreProjectAction,
} from "@/app/actions";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { formatDate, issueRef } from "@/lib/format";
import type { TrashedIssue, TrashedProject } from "@/lib/issues";
import { useLocale, useT } from "@/components/i18n-context";

export function TrashView({
  workspaceId,
  userId,
  isOwner,
  projects,
  issues,
}: {
  workspaceId: string;
  userId: string;
  // The workspace owner may clear anything in the bin, not only the projects they created.
  isOwner: boolean;
  projects: TrashedProject[];
  issues: TrashedIssue[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();

  async function restoreProject(project: TrashedProject) {
    await restoreProjectAction(workspaceId, project.id);
    router.refresh();
  }

  async function purgeProject(project: TrashedProject) {
    if (
      !window.confirm(
        t(
          project.issueCount === 1
            ? 'Delete "{name}" and its {count} task permanently? This cannot be undone.'
            : 'Delete "{name}" and its {count} tasks permanently? This cannot be undone.',
          { name: project.name, count: project.issueCount }
        )
      )
    )
      return;
    await purgeProjectAction(workspaceId, project.id);
    router.refresh();
  }

  async function restoreIssue(issue: TrashedIssue) {
    await restoreIssueAction(workspaceId, issue.id);
    router.refresh();
  }

  async function purgeIssue(issue: TrashedIssue) {
    await purgeIssueAction(workspaceId, issue.id);
    router.refresh();
  }

  const empty = projects.length === 0 && issues.length === 0;

  return (
    <div className="flex-1 overflow-y-auto px-10 pb-10 pt-6 lg:px-20 xl:px-32">
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-muted">
          {t(
            "Deleted issues and projects wait here. Restore puts one back exactly as it was; deleting it for good cannot be undone."
          )}
        </p>
        {empty && (
          <div className="rounded-lg border border-border p-4 text-[13px] text-faint">
            {t("Trash is empty.")}
          </div>
        )}
        {issues.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {issues.map((issue) => (
              <div key={issue.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-[3px] flex shrink-0 items-center">
                  <StatusIcon status={issue.status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-[12px] text-faint">{issueRef(issue)}</span>
                    <span className="truncate text-[13px]">{issue.title}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-faint">
                    <span className="flex shrink-0 items-center">
                      <ProjectIcon color={issue.projectColor} size={12} />
                    </span>
                    <span className="truncate">{issue.projectName}</span>
                    <span className="shrink-0">· {t("deleted {date}", { date: formatDate(issue.deletedAt, locale) })}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void restoreIssue(issue)}
                    title={t("Restore")}
                    aria-label={t("Restore {name}", { name: issueRef(issue) })}
                    className="rounded-md border border-border p-1.5 text-faint transition-colors hover:border-border-strong hover:text-text"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void purgeIssue(issue)}
                    title={t("Delete forever")}
                    aria-label={t("Delete {name} forever", { name: issueRef(issue) })}
                    className="rounded-md p-1.5 text-faint transition-colors hover:bg-elevated hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {projects.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {projects.map((project) => (
              <div key={project.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-[2px] flex shrink-0 items-center">
                  <ProjectIcon color={project.color} icon={project.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{project.name}</div>
                  <div className="mt-0.5 text-[12px] text-faint">
                    {t(project.issueCount === 1 ? "{count} task" : "{count} tasks", {
                      count: project.issueCount,
                    })}{" "}
                    · {t("deleted {date}", { date: formatDate(project.deletedAt, locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void restoreProject(project)}
                    title={t("Restore")}
                    aria-label={t("Restore {name}", { name: project.name })}
                    className="rounded-md border border-border p-1.5 text-faint transition-colors hover:border-border-strong hover:text-text"
                  >
                    <RotateCcw size={13} />
                  </button>
                  {(project.createdBy === userId || isOwner) && (
                    <button
                      type="button"
                      onClick={() => void purgeProject(project)}
                      title={t("Delete forever")}
                      aria-label={t("Delete {name} forever", { name: project.name })}
                      className="rounded-md p-1.5 text-faint transition-colors hover:bg-elevated hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
