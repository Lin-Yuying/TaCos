"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { StatusIcon } from "@/components/icons";
import { IssueLayout, LayoutToggle } from "@/components/issue-layout";
import { toggleProjectFavoriteAction } from "@/app/actions";
import { ProjectHeader, type ProjectTab } from "@/components/project-header";
import { ProjectOverview } from "@/components/project-overview";
import { ProjectDocuments } from "@/components/project-documents";
import { STATUS_META, type Status } from "@/lib/constants";
import { issueRef } from "@/lib/format";
import type { PageSummary } from "@/lib/pages";
import type { ProjectResource } from "@/lib/resources";
import type {
  IssueWithLabels,
  Member,
  OverviewAccess,
  OverviewComment,
  OverviewDocEdit,
  OverviewGrant,
  Project,
  ProjectMember,
} from "@/lib/issues";

type Counts = Record<Status, number> & { total: number };
type ProjectDetail = Project & { doc: string; createdBy: string | null };

export function ProjectWorkspace({
  workspaceId,
  project,
  counts,
  members,
  workspaceMembers,
  issues,
  documents,
  currentUserId,
  initialTab,
  initialFavorite,
  access,
  grants,
  comments,
  edits,
  unseenDocEdits,
  resources,
  trashedTitles,
}: {
  workspaceId: string;
  project: ProjectDetail;
  counts: Counts;
  members: ProjectMember[];
  workspaceMembers: Member[];
  issues: IssueWithLabels[];
  documents: PageSummary[];
  currentUserId: string;
  initialTab: ProjectTab;
  initialFavorite: boolean;
  access: OverviewAccess;
  grants: OverviewGrant[];
  comments: OverviewComment[];
  edits: OverviewDocEdit[];
  unseenDocEdits: number;
  resources: ProjectResource[];
  trashedTitles: Record<string, string>;
}) {
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const [status, setStatus] = useState<Status | null>(null);
  const [q, setQ] = useState("");
  const [favorite, setFavorite] = useState(initialFavorite);

  // Optimistic: the star is a one-click toggle, and revalidating the layout is what
  // lands it in (or lifts it out of) the sidebar's Favorites group.
  function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    void toggleProjectFavoriteAction(workspaceId, project.id).then((res) => {
      if (!res.ok) setFavorite(!next);
    });
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter(
      (issue) =>
        (!status || issue.status === status) &&
        (!needle ||
          issue.title.toLowerCase().includes(needle) ||
          issue.identifier.toLowerCase().includes(needle) ||
          issueRef(issue).toLowerCase().includes(needle))
    );
  }, [issues, status, q]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ProjectHeader
        project={project}
        tab={tab}
        issueCount={counts.total}
        documentCount={documents.length}
        favorite={favorite}
        canViewOverview={access.canView}
        onTab={(next) => {
          setTab(next);
          if (next === "issues") setStatus(null);
        }}
        onToggleFavorite={toggleFavorite}
      />
      {tab === "overview" ? (
        <ProjectOverview
          workspaceId={workspaceId}
          project={project}
          members={members}
          workspaceMembers={workspaceMembers}
          issues={issues}
          documents={documents}
          resources={resources}
          trashedTitles={trashedTitles}
          access={access}
          grants={grants}
          comments={comments}
          edits={edits}
          unseenDocEdits={unseenDocEdits}
          currentUserId={currentUserId}
        />
      ) : tab === "documents" ? (
        <ProjectDocuments
          workspaceId={workspaceId}
          projectId={project.id}
          pages={documents}
        />
      ) : (
        <>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-6">
            {status ? (
              <button
                type="button"
                onClick={() => setStatus(null)}
                className="flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-[12px] text-text transition-colors hover:bg-elevated/70"
              >
                <StatusIcon status={status} size={12} />
                {STATUS_META[status].label}
                <X size={11} className="text-faint" />
              </button>
            ) : (
              <span className="text-[13px] font-medium text-muted">All tasks</span>
            )}
            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
              {shown.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex w-60 items-center gap-2 rounded-md border border-border bg-elevated/50 px-2 py-1.5 focus-within:border-border-strong">
                <Search size={13} className="shrink-0 text-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search tasks…"
                  className="w-full bg-transparent text-[13px] text-text placeholder:text-faint"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label="Clear search"
                    className="text-faint hover:text-muted"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <LayoutToggle />
            </div>
          </header>
          <IssueLayout issues={shown} workspaceId={workspaceId} currentUserId={currentUserId} />
        </>
      )}
    </div>
  );
}
