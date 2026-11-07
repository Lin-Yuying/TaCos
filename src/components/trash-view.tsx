"use client";

import { useRef, useState } from "react";
import { useUI } from "@/components/ui-context";
import { entityHref } from "@/lib/ui/entity-actions";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import type { ComponentProps } from "react";
import {
  purgeIssueAction,
  purgeProjectAction,
  restoreIssueAction,
  restoreProjectAction,
} from "@/app/actions";
import { purgePageAction, restorePageAction } from "@/app/pages-actions";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { formatDate, issueRef } from "@/lib/format";
import type { TrashedIssue, TrashedProject } from "@/lib/issues";
import type { TrashedPage } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";
import { PAGE_HEADER, PAGE_LEFT, PAGE_RIGHT, PAGE_TITLE } from "@/lib/page-chrome";
import { WorkspaceTrashList } from "@/components/workspace-trash-list";

const TABS = [["all", "All"], ["tasks", "Tasks"], ["docs", "Documents"], ["projects", "Projects"]] as const;

export function TrashView({
  workspaceId,
  userId,
  isOwner,
  projects,
  issues,
  docs,
  deletedWorkspaces,
}: {
  workspaceId: string;
  userId: string;
  // The workspace owner may clear anything in the bin, not only the projects they created.
  isOwner: boolean;
  projects: TrashedProject[];
  issues: TrashedIssue[];
  docs: TrashedPage[];
  deletedWorkspaces: ComponentProps<typeof WorkspaceTrashList>["items"];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");

  const {confirm,toast} = useUI();
  const running = useRef(new Set<string>());
  const [busy,setBusy] = useState<string[]>([]);
  const [errors,setErrors] = useState<Record<string,string>>({});
  async function perform(id:string, action:()=>Promise<{ok:boolean;error?:string}>, href?:string) {
    if(running.current.has(id))return;
    running.current.add(id);setBusy([...running.current]);
    setErrors(previous=>({...previous,[id]:""}));
    try {
      const result=await action();
      if(!result.ok){setErrors(previous=>({...previous,[id]:result.error??"Could not save. Retry."}));return;}
      if(href)toast(t("Restored"),{label:t("Open"),run:()=>router.push(href)});
      router.refresh();
    }catch{setErrors(previous=>({...previous,[id]:"Could not save. Retry."}));}
    finally{running.current.delete(id);setBusy([...running.current]);}
  }
  async function restoreProject(project:TrashedProject) {await perform(project.id,()=>restoreProjectAction(workspaceId,project.id),`/${workspaceId}/projects/${project.id}`);}
  async function purgeProject(project:TrashedProject) {
    if(!await confirm(t('Delete "{name}" and its {count} tasks permanently?',{name:project.name,count:project.issueCount}),{ body: t("This cannot be undone."), action: t("Delete permanently") }))return;
    await perform(project.id,()=>purgeProjectAction(workspaceId,project.id));
  }
  async function restoreIssue(issue:TrashedIssue) {await perform(issue.id,()=>restoreIssueAction(workspaceId,issue.id),entityHref(workspaceId,{kind:"task",id:issue.id}));}
  async function purgeIssue(issue:TrashedIssue) {
    if(!await confirm(t('Delete "{name}" permanently?',{name:issue.title}),{ body: t("This cannot be undone."), action: t("Delete permanently") }))return;
    await perform(issue.id,()=>purgeIssueAction(workspaceId,issue.id));
  }
  async function restoreDoc(doc:TrashedPage) {await perform(doc.id,()=>restorePageAction(workspaceId,doc.id),entityHref(workspaceId,{kind:"document",id:doc.id}));}
  async function purgeDoc(doc:TrashedPage) {
    if(!await confirm(t('Delete "{name}" and everything inside it permanently?',{name:doc.title}),{ body: t("This cannot be undone."), action: t("Delete permanently") }))return;
    await perform(doc.id,()=>purgePageAction(workspaceId,doc.id));
  }

  const listed = { all: projects.length + issues.length + docs.length + deletedWorkspaces.length, tasks: issues.length, docs: docs.length, projects: projects.length }[tab];
  const empty = listed === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={`${PAGE_HEADER} ${PAGE_LEFT} ${PAGE_RIGHT}`}>
        <h1 className={PAGE_TITLE}>{t("Trash")}</h1>
        <span className="text-small tabular-nums text-faint">{projects.length + issues.length + docs.length}</span>
        <nav aria-label={t("Type")} className="ml-auto flex items-center gap-1 text-small">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-md px-2.5 py-1 transition-colors ${tab === value ? "bg-elevated font-medium text-text" : "text-muted hover:bg-elevated hover:text-text"}`}
            >
              {t(label)}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-10 pt-3">
        {Object.entries(errors).filter(([,message])=>message).map(([id,message])=><p role="alert" key={id} className="text-small text-danger">{t(message)}</p>)}
        <p className={`text-small leading-relaxed text-faint ${PAGE_LEFT} ${PAGE_RIGHT}`}>
          {t(
            "Deleted issues, documents and projects wait here. Restore puts one back exactly as it was; deleting it for good cannot be undone."
          )}
        </p>
        {empty && (
          <EmptyState title={t("Trash is empty.")} />
        )}
        {issues.length > 0 && (tab === "all" || tab === "tasks") && (
          <div className="divide-y divide-border border-y border-border">
            {issues.map((issue) => (
              <div key={issue.id} className={`flex items-start gap-3 py-2.5 ${PAGE_LEFT} ${PAGE_RIGHT}`}>
                <span className="mt-[3px] flex shrink-0 items-center">
                  <StatusIcon status={issue.status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-small text-faint">{issueRef(issue)}</span>
                    <span className="truncate text-body">{issue.title}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-small text-faint">
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
                    disabled={busy.includes(issue.id)} onClick={() => void restoreIssue(issue)}
                    aria-label={t("Restore {name}", { name: issueRef(issue) })}
                    className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text disabled:opacity-50"
                  >
                    {t("Restore")}
                  </button>
                  <button
                    type="button"
                    disabled={busy.includes(issue.id)} onClick={() => void purgeIssue(issue)}
                    aria-label={t("Delete {name} forever", { name: issueRef(issue) })}
                      className="rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-danger disabled:opacity-50"
                    >
                      {t("Delete forever")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {docs.length > 0 && (tab === "all" || tab === "docs") && (
          <div className="divide-y divide-border border-y border-border">
            {docs.map((doc) => (
              <div key={doc.id} data-trashed-doc className={`flex items-start gap-3 py-2.5 ${PAGE_LEFT} ${PAGE_RIGHT}`}>
                <span className="mt-[1px] shrink-0 text-body leading-none">{doc.icon ?? <FileText size={14} className="text-muted" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{doc.title}</div>
                  <div className="mt-0.5 text-small text-faint">
                    {doc.subpageCount > 0 && <>{t("{count} subpages", { count: doc.subpageCount })} · </>}
                    {t("deleted {date}", { date: formatDate(doc.deletedAt, locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy.includes(doc.id)} onClick={() => void restoreDoc(doc)}
                    aria-label={t("Restore {name}", { name: doc.title })}
                    className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text disabled:opacity-50"
                  >
                    {t("Restore")}
                  </button>
                  {(doc.createdBy === userId || isOwner) && (
                    <button
                      type="button"
                      disabled={busy.includes(doc.id)} onClick={() => void purgeDoc(doc)}
                      aria-label={t("Delete {name} forever", { name: doc.title })}
                      className="rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-danger disabled:opacity-50"
                    >
                      {t("Delete forever")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {projects.length > 0 && (tab === "all" || tab === "projects") && (
          <div className="divide-y divide-border border-y border-border">
            {projects.map((project) => (
              <div key={project.id} className={`flex items-start gap-3 py-2.5 ${PAGE_LEFT} ${PAGE_RIGHT}`}>
                <span className="mt-[2px] flex shrink-0 items-center">
                  <ProjectIcon color={project.color} icon={project.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{project.name}</div>
                  <div className="mt-0.5 text-small text-faint">
                    {t(project.issueCount === 1 ? "{count} task" : "{count} tasks", {
                      count: project.issueCount,
                    })}{" "}
                    · {t("deleted {date}", { date: formatDate(project.deletedAt, locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy.includes(project.id)} onClick={() => void restoreProject(project)}
                    aria-label={t("Restore {name}", { name: project.name })}
                    className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text disabled:opacity-50"
                  >
                    {t("Restore")}
                  </button>
                  {(project.createdBy === userId || isOwner) && (
                    <button
                      type="button"
                      disabled={busy.includes(project.id)} onClick={() => void purgeProject(project)}
                      aria-label={t("Delete {name} forever", { name: project.name })}
                      className="rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-danger disabled:opacity-50"
                    >
                      {t("Delete forever")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "all" && (
          <div className={`${PAGE_LEFT} ${PAGE_RIGHT}`}>
            <WorkspaceTrashList items={deletedWorkspaces} />
          </div>
        )}
      </div>
    </div>
  );
}
