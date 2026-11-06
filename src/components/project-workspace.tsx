"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { StatusIcon } from "@/components/icons";
import { IssueLayout, LayoutToggle } from "@/components/issue-layout";
import { toggleProjectFavoriteAction, updateProjectAction } from "@/app/actions";
import { ProjectHeader, type ProjectTab } from "@/components/project-header";
import { ProjectMeta, MetaRowsMenu, useMetaRows } from "@/components/project-meta";
import { ProjectOverview } from "@/components/project-overview";
import { ProjectDocuments } from "@/components/project-documents";
import { STATUS_META, type Status } from "@/lib/constants";
import { issueRef } from "@/lib/format";
import type { PageContext } from "@/components/markdown";
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
import { useT } from "@/components/i18n-context";
import type { FieldValues, TaskField } from "@/lib/task-view";

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
  pages,
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
  fields,
  fieldValues,
}: {
  fields: TaskField[];
  fieldValues: FieldValues;
  workspaceId: string;
  project: ProjectDetail;
  counts: Counts;
  members: ProjectMember[];
  workspaceMembers: Member[];
  issues: IssueWithLabels[];
  documents: PageSummary[];
  pages: PageContext;
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
  const t = useT();
  const params = useSearchParams();
  const selectedTab = params.get("tab");
  const tab: ProjectTab = selectedTab === "documents" || selectedTab === "issues" || selectedTab === "overview" ? selectedTab : initialTab;
  const [status, setStatus] = useState<Status | null>(null);
  const [q, setQ] = useState("");
  const [favorite, setFavorite] = useState(initialFavorite);
  const [icon, setIcon] = useState<string | null>(project.icon);
  const metaRows = useMetaRows();

  // Optimistic: the star is a one-click toggle, and revalidating the layout is what
  // lands it in (or lifts it out of) the sidebar's Favorites group.
  function toggleFavorite() {
    const next = !favorite;
    setFavorite(next);
    void toggleProjectFavoriteAction(workspaceId, project.id).then((res) => {
      if (!res.ok) setFavorite(!next);
    });
  }

  // Same reasoning for the icon: the header, the sidebar row and the tab all draw it,
  // so it changes locally first and the server's revalidation makes that permanent.
  function pickIcon(next: string | null) {
    const before = icon;
    setIcon(next);
    void updateProjectAction(workspaceId, project.id, { icon: next }).then((res) => {
      if (!res.ok) setIcon(before);
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
        project={{ ...project, icon }}
        tab={tab}
        issueCount={counts.total}
        documentCount={documents.length}
        favorite={favorite}
        canViewOverview={access.canView}
        canPickIcon={access.canEdit}
        onPickIcon={pickIcon}
        onTab={(next) => {
          const url = new URL(window.location.href); url.searchParams.set("tab", next);
          window.history.pushState(null, "", url);
          if (next === "issues") setStatus(null);
        }}
        onToggleFavorite={toggleFavorite}
        meta={
          // Overview grants and resources are overview-only facts: without a grant the
          // reader never saw these rows, so the header keeps it that way.
          access.canView ? (
            <ProjectMeta
              workspaceId={workspaceId}
              projectId={project.id}
              createdBy={project.createdBy}
              members={members}
              workspaceMembers={workspaceMembers}
              documents={documents}
              resources={resources}
              access={access}
              grants={grants}
              rows={metaRows}
            />
          ) : undefined
        }
        metaMenu={
          access.canView ? (
            <MetaRowsMenu hidden={metaRows.hidden} onToggle={metaRows.toggle} />
          ) : undefined
        }
      />
      {tab === "overview" ? (
        <ProjectOverview
          workspaceId={workspaceId}
          project={project}
          issues={issues}
          pages={pages}
          trashedTitles={trashedTitles}
          access={access}
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
          {/* The list's own row is a header, so it hangs from the same card gutter as
              the project title and Properties; the board below keeps the reading gutters. */}
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border pl-4 pr-10 lg:pr-20 xl:pr-32">
            {status ? (
              <button
                type="button"
                onClick={() => setStatus(null)}
                className="flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5 text-small text-text transition-colors hover:bg-elevated/70"
              >
                <StatusIcon status={status} size={12} />
                {t(STATUS_META[status].label)}
                <X size={11} className="text-faint" />
              </button>
            ) : (
              <span className="whitespace-nowrap text-body font-medium text-muted">{t("All tasks")}</span>
            )}
            <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
              {shown.length}
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <div className="flex w-60 min-w-0 shrink items-center gap-2 rounded-md border border-border bg-elevated/50 px-2 py-1.5 focus-within:border-border-strong">
                <Search size={13} className="shrink-0 text-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Search tasks…")}
                  className="w-full bg-transparent text-body text-text placeholder:text-faint"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label={t("Clear search")}
                    className="text-faint hover:text-muted"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <LayoutToggle />
            </div>
          </header>
          <IssueLayout
            issues={shown}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            fields={fields}
            values={fieldValues}
            manageFields
          />
        </>
      )}
    </div>
  );
}
