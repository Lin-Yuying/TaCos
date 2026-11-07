"use client";

import type {TaskQuery,queryTaskView} from "@/lib/task-query";
import { DebouncedInput } from "./ui/debounced-input";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { StatusIcon } from "@/components/icons";
import { IssueLayout, LayoutToggle } from "@/components/issue-layout";
import { toggleProjectFavoriteAction, updateProjectAction } from "@/app/actions";
import { ProjectHeader, type ProjectTab } from "@/components/project-header";
import { ProjectMeta, MetaRowsMenu, useMetaRows } from "@/components/project-meta";
import { ProjectOverview } from "@/components/project-overview";
import { ProjectDocuments } from "@/components/project-documents";
import { ProjectTimeline } from "@/components/project-timeline";
import type { Milestone } from "@/lib/planning/milestones";
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
import type { TaskViewSummary } from "@/lib/task-views";
import { PAGE_INSET } from "@/lib/page-chrome";

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
  fieldValues,taskQuery,taskPage,initialView,
  milestones,
}: {
  fields: TaskField[];
  taskQuery?:TaskQuery;taskPage?:Awaited<ReturnType<typeof queryTaskView>>;
  initialView?: TaskViewSummary | null;
  fieldValues: FieldValues;
  milestones: Milestone[];
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
  const router=useRouter();
  const selectedTab = params.get("tab");
  const tab: ProjectTab = !access.canView?"issues":selectedTab === "documents" || selectedTab === "issues" || selectedTab === "overview" || selectedTab === "timeline" ? selectedTab : initialTab;
  const selectedStatus=params.get("status");
  const status:Status|null=selectedStatus&&selectedStatus in STATUS_META?selectedStatus as Status:null;
  const q=params.get("q")??"";
  function setQueryValue(key:string,value:string|null){const url=new URL(location.href);if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);router.replace(url.pathname+url.search,{scroll:false});}
  function setStatus(status:Status|null){setQueryValue("status",status);}
  function setQ(query:string){setQueryValue("q",query);}
  const [favorite, setFavorite] = useState(initialFavorite);
  const [sidePanel, setSidePanel] = useState(false);
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
    return taskQuery?issues:issues.filter(
      (issue) =>
        (!status || issue.status === status) &&
        (!needle ||
          issue.title.toLowerCase().includes(needle) ||
          issue.identifier.toLowerCase().includes(needle) ||
          issueRef(issue).toLowerCase().includes(needle))
    );
  }, [issues, status, q,taskQuery]);

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
          router.push(url.pathname+url.search,{scroll:false});

        }}
        onToggleFavorite={toggleFavorite}
        metaMenu={
          access.canView && tab==="overview" ? (
            <MetaRowsMenu hidden={metaRows.hidden} onToggle={metaRows.toggle} />
          ) : undefined
        }
      />
      {tab === "overview" ? (
        // Overview grants and resources are overview-only facts: without a grant the
        // reader never sees this column.
        <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col @min-[800px]:flex-row">
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
              onPanelChange={setSidePanel}
            />
            {access.canView && !sidePanel && metaRows.hidden.length < 2 && (
              <aside data-testid="project-properties" className="order-first max-h-[40%] shrink-0 overflow-y-auto border-b border-border p-4 @min-[800px]:order-none @min-[800px]:max-h-none @min-[800px]:w-[280px] @min-[800px]:border-b-0 @min-[800px]:border-l">
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
              </aside>
            )}
          </div>
        </div>
      ) : tab === "timeline" ? (
        <ProjectTimeline
          workspaceId={workspaceId}
          projectId={project.id}
          project={{ name: project.name, color: project.color, icon }}
          milestones={milestones}
          issues={issues}
        />
      ) : tab === "documents" ? (
        <ProjectDocuments
          workspaceId={workspaceId}
          projectId={project.id}
          pages={documents}
        />
      ) : (
        <>
          {/* The list's own row is a header, so it hangs from the same 52px column as
              the project title and Properties; the board below keeps the reading gutters. */}
          <header className={`flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border ${PAGE_INSET}`}>
            {status ? (
              <button
                type="button"
                onClick={() => setStatus(null)}
                className="flex items-center gap-1.5 rounded-lg bg-elevated px-2 py-0.5 text-small text-text transition-colors hover:bg-elevated/70"
              >
                <StatusIcon status={status} size={12} />
                {t(STATUS_META[status].label)}
                <X size={11} className="text-faint" />
              </button>
            ) : (
              <span className="whitespace-nowrap text-body font-medium text-muted">{t("All tasks")}</span>
            )}
            <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-muted">
              {taskPage?.total??shown.length}
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <div className="flex w-60 min-w-0 shrink items-center gap-2 rounded-md border border-border bg-elevated/50 px-2 py-1.5 focus-within:border-border-strong">
                <Search size={13} className="shrink-0 text-faint" />
                <DebouncedInput
                  value={q}
                  onCommit={setQ}
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
            key={`${project.id}:${initialView?.id ?? "no-view"}`}
            serverQuery={taskQuery}
            initialPage={taskPage}
            issues={shown}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            fields={fields}
            values={fieldValues}
            manageFields
            scope="project"
            projectId={project.id}
            initialView={initialView ?? null}
          />
        </>
      )}
    </div>
  );
}
