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

export function TrashView({
  workspaceId,
  userId,
  projects,
  issues,
}: {
  workspaceId: string;
  userId: string;
  projects: TrashedProject[];
  issues: TrashedIssue[];
}) {
  const router = useRouter();

  async function restoreProject(project: TrashedProject) {
    await restoreProjectAction(workspaceId, project.id);
    router.refresh();
  }

  async function purgeProject(project: TrashedProject) {
    if (
      !window.confirm(
        `Delete "${project.name}" and its ${project.issueCount} ${
          project.issueCount === 1 ? "issue" : "issues"
        } permanently? This cannot be undone.`
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
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-[13px] leading-relaxed text-muted">
          Deleted issues and projects wait here. Restore puts one back exactly as it was; deleting it
          for good cannot be undone.
        </p>
        {empty && (
          <div className="rounded-lg border border-border p-4 text-[13px] text-faint">
            Trash is empty.
          </div>
        )}
        {issues.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {issues.map((issue) => (
              <div key={issue.id} className="flex items-center gap-3 px-4 py-2.5">
                <StatusIcon status={issue.status} size={14} />
                <span className="shrink-0 text-[12px] text-faint">{issueRef(issue)}</span>
                <span className="truncate text-[13px]">{issue.title}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-faint">
                  <ProjectIcon color={issue.projectColor} size={12} />
                  {issue.projectName} · deleted {formatDate(issue.deletedAt)}
                </span>
                <button
                  type="button"
                  onClick={() => void restoreIssue(issue)}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  <RotateCcw size={12} /> Restore
                </button>
                <button
                  type="button"
                  onClick={() => void purgeIssue(issue)}
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:bg-elevated hover:text-danger"
                >
                  <Trash2 size={12} /> Delete forever
                </button>
              </div>
            ))}
          </div>
        )}
        {projects.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {projects.map((project) => (
              <div key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                <ProjectIcon color={project.color} size={15} />
                <span className="truncate text-[13px]">{project.name}</span>
                <span className="shrink-0 text-[12px] text-faint">
                  {project.issueCount} {project.issueCount === 1 ? "issue" : "issues"} · deleted{" "}
                  {formatDate(project.deletedAt)}
                </span>
                <button
                  type="button"
                  onClick={() => void restoreProject(project)}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  <RotateCcw size={12} /> Restore
                </button>
                {/* Permanently removing a project stays the creator's decision. */}
                {project.createdBy === userId && (
                  <button
                    type="button"
                    onClick={() => void purgeProject(project)}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:bg-elevated hover:text-danger"
                  >
                    <Trash2 size={12} /> Delete forever
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
