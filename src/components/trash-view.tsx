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
import { friendlyDate, issueRef } from "@/lib/format";
import type { TrashedIssue, TrashedProject } from "@/lib/issues";
import type { TrashedPage } from "@/lib/pages";
import { useLocale, useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";
import { BTN, BTN_GHOST, LINE, LINE_SUB, PAGE_HEADER, PAGE_LEFT, PAGE_RIGHT, PAGE_TITLE, vtab } from "@/lib/page-chrome";
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
        <span className="text-small tabular-nums text-faint">{projects.length + issues.length + docs.length + deletedWorkspaces.length}</span>
        <nav aria-label={t("Type")} className="ml-1.5 flex items-center gap-0.5">
          {TABS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={vtab(tab === value)}>
              {t(label)}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {Object.entries(errors).filter(([,message])=>message).map(([id,message])=><p role="alert" key={id} className="text-small text-danger">{t(message)}</p>)}
        {empty && (
          <EmptyState title={t("Trash is empty.")} />
        )}
        {issues.length > 0 && (tab === "all" || tab === "tasks") && (
          <div>
            {issues.map((issue) => (
              <div key={issue.id} className={LINE}>
                <span className="flex shrink-0 items-center">
                  <StatusIcon status={issue.status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-small text-faint">{issueRef(issue)}</span>
                    <span className="truncate">{issue.title}</span>
                  </div>
                  <div className={`flex min-w-0 items-center gap-1.5 ${LINE_SUB}`}>
                    <span className="flex shrink-0 items-center">
                      <ProjectIcon color={issue.projectColor} icon={issue.projectIcon} size={12} />
                    </span>
                    <span className="truncate">{issue.projectName}</span>
                    <span className="shrink-0">· {t("deleted {date}", { date: friendlyDate(issue.deletedAt, locale) })}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy.includes(issue.id)} onClick={() => void restoreIssue(issue)}
                    aria-label={t("Restore {name}", { name: issueRef(issue) })}
                    className={BTN}
                  >
                    {t("Restore")}
                  </button>
                  <button
                    type="button"
                    disabled={busy.includes(issue.id)} onClick={() => void purgeIssue(issue)}
                    aria-label={t("Delete {name} forever", { name: issueRef(issue) })}
                      className={`${BTN_GHOST} !text-danger`}
                    >
                      {t("Delete forever")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {docs.length > 0 && (tab === "all" || tab === "docs") && (
          <div>
            {docs.map((doc) => (
              <div key={doc.id} data-trashed-doc className={LINE}>
                <span className="shrink-0 text-body leading-none">{doc.icon ?? <FileText size={14} className="text-muted" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{doc.title}</div>
                  <div className={LINE_SUB}>
                    {doc.subpageCount > 0 && <>{t("{count} subpages", { count: doc.subpageCount })} · </>}
                    {t("deleted {date}", { date: friendlyDate(doc.deletedAt, locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy.includes(doc.id)} onClick={() => void restoreDoc(doc)}
                    aria-label={t("Restore {name}", { name: doc.title })}
                    className={BTN}
                  >
                    {t("Restore")}
                  </button>
                  {(doc.createdBy === userId || isOwner) && (
                    <button
                      type="button"
                      disabled={busy.includes(doc.id)} onClick={() => void purgeDoc(doc)}
                      aria-label={t("Delete {name} forever", { name: doc.title })}
                      className={`${BTN_GHOST} !text-danger`}
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
          <div>
            {projects.map((project) => (
              <div key={project.id} className={LINE}>
                <span className="flex shrink-0 items-center">
                  <ProjectIcon color={project.color} icon={project.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{project.name}</div>
                  <div className={LINE_SUB}>
                    {t(project.issueCount === 1 ? "{count} task" : "{count} tasks", {
                      count: project.issueCount,
                    })}{" "}
                    · {t("deleted {date}", { date: friendlyDate(project.deletedAt, locale) })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy.includes(project.id)} onClick={() => void restoreProject(project)}
                    aria-label={t("Restore {name}", { name: project.name })}
                    className={BTN}
                  >
                    {t("Restore")}
                  </button>
                  {(project.createdBy === userId || isOwner) && (
                    <button
                      type="button"
                      disabled={busy.includes(project.id)} onClick={() => void purgeProject(project)}
                      aria-label={t("Delete {name} forever", { name: project.name })}
                      className={`${BTN_GHOST} !text-danger`}
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
          <div className={deletedWorkspaces.length ? `${PAGE_LEFT} ${PAGE_RIGHT} pt-6` : ""}>
            <WorkspaceTrashList items={deletedWorkspaces} />
          </div>
        )}
      </div>
    </div>
  );
}
