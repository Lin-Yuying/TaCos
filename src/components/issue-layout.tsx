"use client";

import { useDetailSource } from "@/components/detail-navigation";
import { PersonalViews } from "@/components/personal-views";
import { BatchSelection } from "@/components/ui/batch-selection";
import dynamic from "next/dynamic";
import { useEffect,useMemo,useRef,useState } from "react";
import { taskViewPageAction,taskViewCandidatesAction,taskViewExportAction,taskViewChoicesAction } from "@/app/task-query-actions";
import type { TaskQuery,queryTaskView } from "@/lib/task-query";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, Columns3, List, Plus, Table2 } from "lucide-react";
import { IssueBoard } from "@/components/issue-board";
import { IssueTable } from "@/components/issue-table";
import { useUI, type IssueLayout as Layout } from "@/components/ui-context";
import { TaskGrid } from "@/components/task-grid";
import { TaskViewBar } from "@/components/task-view-bar";
import type { IssueWithLabels } from "@/lib/issues";
import { STATUS_ORDER } from "@/lib/constants";
import { EMPTY_VIEW, applyView, type FieldValues, type TaskField, type TaskView } from "@/lib/task-view";
import { useStoredJson } from "@/lib/use-stored-json";
import { interpolate, useT } from "@/components/i18n-context";

const TaskCalendar = dynamic(() => import("@/components/task-calendar"), { ssr: false });

const NO_FIELDS: TaskField[] = [];
const NO_VALUES: FieldValues = {};

const LAYOUTS: { key: Layout; label: string; icon: typeof List }[] = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: Columns3 },
  { key: "table", label: "Table", icon: Table2 },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
];

export function LayoutToggle() {
  const t = useT();
  const { layout, setLayout } = useUI();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-elevated/50 p-0.5">
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setLayout(key)}
          aria-pressed={layout === key}
          aria-label={t(label)}
          title={t(label)}
          className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
            layout === key
              ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-muted hover:text-text"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function Empty() {
  const t = useT();
  const { setComposerOpen } = useUI();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="text-lead font-medium text-muted">{t("No tasks found")}</div>
      <div className="text-body text-faint">
        {interpolate(t("Adjust your filters, or press {key} to create one."), {
          key: <kbd className="rounded border border-border px-1 font-mono text-caption">C</kbd>,
        })}
      </div>
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover"
      >
        <Plus size={13} /> {t("New task")}
      </button>
    </div>
  );
}

export function IssueLayout({
  issues,
  workspaceId,
  currentUserId,
  fields = NO_FIELDS,
  values = NO_VALUES,
  manageFields = false,
  serverQuery,initialPage,
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
  fields?: TaskField[];
  values?: FieldValues;
  manageFields?: boolean;
  serverQuery?:TaskQuery;initialPage?:Awaited<ReturnType<typeof queryTaskView>>;
}) {
  const t = useT();
  const router = useRouter();
  const { layout, scope, pins } = useUI();
  const pathname=usePathname(),params=useSearchParams();
  const viewScope=`${pathname}?view=${params.get("view")??"all"}&assignee=${params.get("assignee")??""}`;
  const [view, setView] = useStoredJson<TaskView>(`tacos.tasks.view.${scope}.${viewScope}`, EMPTY_VIEW);
  const [remote,setRemote]=useState(initialPage),[pending,setPending]=useState(false),[failure,setFailure]=useState<string|null>(null);
  const [choices,setChoices]=useState<{projects:string[];members:{id:string;displayName:string}[]}>();
  const requestGeneration=useRef(0);
  const queryKey=JSON.stringify(serverQuery),viewKey=JSON.stringify(view);
  useEffect(()=>{if(!serverQuery)return;let live=true;const generation=++requestGeneration.current;Promise.resolve().then(()=>{if(live)setPending(true);});void taskViewPageAction(workspaceId,serverQuery,view,0).then(result=>{if(!live||generation!==requestGeneration.current)return;if(result.ok){setRemote(result.data);setFailure(null);}else setFailure(result.error);setPending(false);}).catch(error=>{if(live&&generation===requestGeneration.current){setFailure(error instanceof Error?error.message:"Could not load tasks. Retry.");setPending(false);}});return()=>{live=false;requestGeneration.current++;};},[workspaceId,queryKey,viewKey,initialPage,pins]);
  useEffect(()=>{if(serverQuery)void taskViewChoicesAction(workspaceId).then(result=>{if(result.ok)setChoices(result.data);}).catch(()=>{});},[workspaceId,queryKey]);
  async function changePage(page:number,reset=false){if(!serverQuery||!remote)return;const generation=++requestGeneration.current;setPending(true);try{const result=await taskViewPageAction(workspaceId,serverQuery,view,page,reset?undefined:remote.revision);if(generation!==requestGeneration.current)return;if(result.ok){setRemote(result.data);setFailure(null);}else setFailure(result.error);}catch(error){if(generation===requestGeneration.current)setFailure(error instanceof Error?error.message:"Could not load tasks. Retry.");}finally{if(generation===requestGeneration.current)setPending(false);}}
  async function exportView(){if(!serverQuery)return;setPending(true);try{const result=await taskViewExportAction(workspaceId,serverQuery,view);if(!result.ok){setFailure(result.error);return;}const url=URL.createObjectURL(new Blob([JSON.stringify(result.data,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="tasks.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setFailure(error instanceof Error?error.message:"Could not export tasks. Retry.");}finally{setPending(false);}}
  const pageIssues=serverQuery?(remote?.items??issues):issues;
  const pageValues=serverQuery?(remote?.values??values):values;
  const shown = useMemo(() => {const rank=new Map(pins.filter(p=>p.kind==="task").map((p,index)=>[p.id,index]));return (serverQuery?[...pageIssues]:applyView(issues,view,fields,values)).sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));}, [issues,view,fields,values,pins,serverQuery,pageIssues]);
  const pinnedIds=new Set(pins.filter(pin=>pin.kind==="task").map(pin=>pin.id));
  useDetailSource("task",(layout==="list"?[...shown.filter(issue=>pinnedIds.has(issue.id)),...STATUS_ORDER.flatMap(status=>shown.filter(issue=>issue.status===status&&!pinnedIds.has(issue.id)))]:shown).map(issue=>issue.id));
  if (!serverQuery&&issues.length === 0) return <Empty />;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1"><BatchSelection key={queryKey+viewKey} workspaceId={workspaceId} kind="task" items={shown} loadItems={serverQuery?()=>taskViewCandidatesAction(workspaceId,serverQuery,view):undefined}/><PersonalViews workspaceId={workspaceId} viewScope={viewScope} view={view} onChange={setView}/><span className="text-small text-faint">{serverQuery?`${(remote?.page??0)*100+ (shown.length?1:0)}–${(remote?.page??0)*100+shown.length} / ${remote?.total??0}`:`${shown.length} / ${issues.length}`}</span></div>
      {serverQuery&&<div className="flex shrink-0 flex-wrap items-center gap-3 px-3 py-1 text-small"><button disabled={pending||!remote?.page} onClick={()=>void changePage((remote?.page??0)-1)}>{t("Previous")}</button><button disabled={pending||!remote||((remote.page+1)*100>=remote.total)} onClick={()=>void changePage((remote?.page??0)+1)}>{t("Next")}</button><button disabled={pending} onClick={()=>void exportView()}>{t("Export all filtered tasks")}</button>{pending&&<span>{t("Loading…")}</span>}{failure&&<span role="alert" className="text-danger">{t(failure)} <button onClick={()=>void changePage(0,true)}>{t("Refresh")}</button></span>}</div>}
      <TaskViewBar
        workspaceId={workspaceId}
        view={view}
        onChange={setView}
        fields={fields}
        choices={choices}
        issues={pageIssues}
        manageFields={manageFields}
        onFieldsChanged={() => router.refresh()}
      />
      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-body text-faint">
          {t("No tasks match this filter")}
        </div>
      ) : layout === "board" ? (
        <IssueBoard issues={shown} workspaceId={workspaceId} currentUserId={currentUserId} manualOrder={view.sort.length===0} />
      ) : layout === "table" ? (
        <TaskGrid currentUserId={currentUserId}
          workspaceId={workspaceId}
          issues={shown}
          fields={fields}
          values={pageValues}
          view={view}
          onViewChange={setView}
        />
      ) : layout === "calendar" ? (
        <TaskCalendar workspaceId={workspaceId} issues={shown} />
      ) : (
        <IssueTable issues={shown} />
      )}
    </>
  );
}
