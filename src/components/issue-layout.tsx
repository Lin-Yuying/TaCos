"use client";

import { useDetailSource } from "@/components/detail-navigation";
import { TaskViews } from "@/components/task-views";
import { TaskBulkBar } from "@/components/task-bulk-bar";
import { BTN_PRIMARY, SEGMENTED, PAGE_INSET, segment } from "@/lib/page-chrome";
import { DisplayMenu } from "@/components/display-menu";
import { BatchSelection } from "@/components/ui/batch-selection";
import dynamic from "next/dynamic";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { taskViewPageAction,taskViewCandidatesAction,taskViewExportAction,taskViewChoicesAction } from "@/app/task-query-actions";
import {
  resetTaskViewOverrideAction,
  saveTaskViewDefinitionAction,
} from "@/app/task-view-actions";
import type { TaskQuery,queryTaskView } from "@/lib/task-query";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { CalendarDays, CheckSquare, Columns3, Filter, List, Plus, Table2 } from "lucide-react";
import { IssueBoard } from "@/components/issue-board";
import { IssueTable } from "@/components/issue-table";
import { useUI, type IssueLayout as Layout, type TaskSelection } from "@/components/ui-context";
import { TaskGrid } from "@/components/task-grid";
import { TaskViewBar, filterSummary } from "@/components/task-view-bar";
import type { IssueWithLabels } from "@/lib/issues";
import { BOARD_STATUS_ORDER, STATUS_ORDER } from "@/lib/constants";
import {
  EMPTY_VIEW,
  applyView,
  DEFAULT_DISPLAY,
  isManualOrder,
  type FieldValues,
  type TaskField,
  type TaskView,
  type TaskViewDisplay,
} from "@/lib/task-view";
import { groupTasks } from "@/lib/view-grouping";
import { useStoredJson } from "@/lib/use-stored-json";
import { interpolate, useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";
import type { TaskViewDefinition, TaskViewSummary, ViewScope } from "@/lib/task-views";

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
    <div role="group" aria-label={t("Layout")} className={SEGMENTED}>
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setLayout(key)}
          aria-pressed={layout === key}
          aria-label={t(label)}
          title={t(label)}
          className={segment(layout === key)}
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
    <EmptyState
      icon={<List size={16} />}
      title={t("No tasks found")}
      hint={interpolate(t("Adjust your filters, or press {key} to create one."), {
        key: <kbd className="rounded border border-border px-1 font-mono text-caption">C</kbd>,
      })}
    >
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className={BTN_PRIMARY}
      >
        <Plus size={13} /> {t("New task")}
      </button>
    </EmptyState>
  );
}

function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Display-menu values belong to the saved view when one is open, otherwise to this device. */
function definitionOf(
  view: TaskView,
  layout: Layout,
  display: TaskViewDisplay
): TaskViewDefinition {
  return { filters: view.filters, sort: view.sort, layout, display };
}

export function IssueLayout({
  issues,
  workspaceId,
  currentUserId,
  fields = NO_FIELDS,
  values = NO_VALUES,
  manageFields = false,
  serverQuery,initialPage,
  scope = "workspace",
  projectId = null,
  initialView = null,
  phoneToolsCollapsed = false,
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
  fields?: TaskField[];
  values?: FieldValues;
  manageFields?: boolean;
  serverQuery?:TaskQuery;initialPage?:Awaited<ReturnType<typeof queryTaskView>>;
  // A project page asks for project views as well as the workspace's.
  scope?: ViewScope;
  projectId?: string | null;
  // The view the server resolved from ?viewId= or the scope default.
  initialView?: TaskViewSummary | null;
  // The task list has a filter button in its phone header; other lists keep the bar open.
  phoneToolsCollapsed?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { layout, scope: userScope, pins, setLayout } = useUI();
  const pathname=usePathname(),params=useSearchParams();
  const viewScope=`${pathname}?view=${params.get("view")??"all"}&assignee=${params.get("assignee")??""}`;
  const [scratch, setScratch] = useStoredJson<TaskView>(`tacos.tasks.view.${userScope}.${viewScope}`, EMPTY_VIEW);
  const [scratchDisplay, setScratchDisplay] = useStoredJson<TaskViewDisplay>(`tacos.tasks.display.${userScope}.${viewScope}`, DEFAULT_DISPLAY);
  const [view, setViewState] = useState<TaskView>(
    initialView
      ? { filters: initialView.definition.filters, sort: initialView.definition.sort }
      : scratch
  );
  const [display, setDisplayState] = useState<TaskViewDisplay>(
    initialView?.definition.display ?? scratchDisplay
  );
  const [active, setActive] = useState<TaskViewSummary | null>(initialView);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [remote,setRemote]=useState(initialPage),[pending,setPending]=useState(false),[failure,setFailure]=useState<string|null>(null);
  const [choices,setChoices]=useState<{projects:string[];members:{id:string;displayName:string}[]}>();
  const requestGeneration=useRef(0);

  const setView = useCallback(
    (next: TaskView) => {
      setViewState(next);
      if (!active) setScratch(next);
    },
    [active, setScratch]
  );

  // The saved view owns its layout; the UI layout switch still works while browsing.
  useEffect(() => {
    if (initialView) setLayout(initialView.definition.layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView?.id]);

  const effectiveView = useMemo<TaskView>(
    () => ({ ...view, display }),
    [view, display]
  );
  const queryKey=JSON.stringify(serverQuery),viewKey=JSON.stringify(effectiveView);
  useEffect(()=>{if(!serverQuery)return;let live=true;const generation=++requestGeneration.current;Promise.resolve().then(()=>{if(live)setPending(true);});void taskViewPageAction(workspaceId,serverQuery,effectiveView,0).then(result=>{if(!live||generation!==requestGeneration.current)return;if(result.ok){setRemote(result.data);setFailure(null);}else setFailure(result.error);setPending(false);}).catch(error=>{if(live&&generation===requestGeneration.current){setFailure(error instanceof Error?error.message:"Could not load tasks. Retry.");setPending(false);}});return()=>{live=false;requestGeneration.current++;};},[workspaceId,queryKey,viewKey,initialPage,pins]);
  useEffect(()=>{void taskViewChoicesAction(workspaceId).then(result=>{if(result.ok)setChoices(result.data);}).catch(()=>{});},[workspaceId]);
  async function changePage(page:number,reset=false){if(!serverQuery||!remote)return;const generation=++requestGeneration.current;setPending(true);try{const result=await taskViewPageAction(workspaceId,serverQuery,effectiveView,page,reset?undefined:remote.revision);if(generation!==requestGeneration.current)return;if(result.ok){setRemote(result.data);setFailure(null);}else setFailure(result.error);}catch(error){if(generation===requestGeneration.current)setFailure(error instanceof Error?error.message:"Could not load tasks. Retry.");}finally{if(generation===requestGeneration.current)setPending(false);}}
  async function exportView(){if(!serverQuery)return;setPending(true);try{const result=await taskViewExportAction(workspaceId,serverQuery,effectiveView);if(!result.ok){setFailure(result.error);return;}const url=URL.createObjectURL(new Blob([JSON.stringify(result.data,null,2)],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="tasks.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){setFailure(error instanceof Error?error.message:"Could not export tasks. Retry.");}finally{setPending(false);}}
  const pageIssues=serverQuery?(remote?.items??issues):issues;
  const pageValues=serverQuery?(remote?.values??values):values;
  // Ids that left the current view are not selectable any more; no effect needed.
  const shownIds = useMemo(() => new Set(pageIssues.map((issue) => issue.id)), [pageIssues]);
  const selectedShown = useMemo(
    () => selected.filter((id) => shownIds.has(id)),
    [selected, shownIds]
  );
  const [columnsSlot, setColumnsSlot] = useState<HTMLElement | null>(null);
  const selection = useMemo<TaskSelection>(
    () => ({
      mode: selecting,
      selected: new Set(selectedShown),
      toggle: (id: string) =>
        setSelected((current) =>
          current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
        ),
    }),
    [selecting, selectedShown]
  );
  const shown = useMemo(() => {const rank=new Map(pins.filter(p=>p.kind==="task").map((p,index)=>[p.id,index]));return (serverQuery?[...pageIssues]:applyView(issues,effectiveView,fields,values)).sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));}, [issues,effectiveView,fields,values,pins,serverQuery,pageIssues]);
  const pinnedIds=new Set(pins.filter(pin=>pin.kind==="task").map(pin=>pin.id));

  const grouping = display.grouping;
  const groups = useMemo(() => {
    if (layout !== "list" && layout !== "board") return [];
    const members = choices?.members ??
      [...new Map(pageIssues.flatMap((issue) => issue.assignees).map((person) => [person.id, person])).values()];
    const projectNames = choices?.projects ?? [...new Set(pageIssues.map((issue) => issue.projectName))];
    return groupTasks(
      shown,
      grouping,
      {
        members,
        projects: projectNames,
        today: todayString(),
        statusOrder: layout === "board" ? BOARD_STATUS_ORDER : STATUS_ORDER,
      },
      // A status board has always shown its four columns; the toggle governs the rest.
      { includeEmpty: display.showEmptyGroups || (layout === "board" && grouping === "status") }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, grouping, shown, choices, display.showEmptyGroups]);

  useDetailSource("task",(layout==="list"?[...shown.filter(issue=>pinnedIds.has(issue.id)),...shown.filter(issue=>!pinnedIds.has(issue.id))]:shown).map(issue=>issue.id));

  function selectView(next: TaskViewSummary | null) {
    setActive(next);
    if (next) {
      setViewState({ filters: next.definition.filters, sort: next.definition.sort });
      setDisplayState(next.definition.display);
      setLayout(next.definition.layout);
    } else {
      setViewState(scratch);
      setDisplayState(scratchDisplay);
    }
    setDisplayError(null);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("viewId", next.id);
    else url.searchParams.delete("viewId");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  function changeDisplay(next: TaskViewDisplay) {
    setDisplayState(next);
    if (!active) setScratchDisplay(next);
    setDisplayError(null);
  }

  const currentDefinition = definitionOf(view, layout, display);

  async function saveDisplay() {
    if (!active || savingDisplay) return;
    setSavingDisplay(true);
    setDisplayError(null);
    try {
      const result = await saveTaskViewDefinitionAction(workspaceId, active.id, currentDefinition);
      if (result.ok) {
        setActive(result.data);
        setViewState({ filters: result.data.definition.filters, sort: result.data.definition.sort });
        setDisplayState(result.data.definition.display);
      } else setDisplayError(result.error);
    } catch {
      setDisplayError(t("Could not save. Retry."));
    } finally {
      setSavingDisplay(false);
    }
  }

  async function resetDisplay() {
    if (!active || savingDisplay) return;
    setSavingDisplay(true);
    setDisplayError(null);
    try {
      const result = await resetTaskViewOverrideAction(workspaceId, active.id);
      if (result.ok) {
        setActive(result.data);
        setViewState({ filters: result.data.definition.filters, sort: result.data.definition.sort });
        setDisplayState(result.data.definition.display);
      } else setDisplayError(result.error);
    } catch {
      setDisplayError(t("Could not save. Retry."));
    } finally {
      setSavingDisplay(false);
    }
  }

  // Shift V opens display options, the same shortcut Linear uses.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "v") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input,textarea,select,[contenteditable=true]"))) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setDisplayOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!serverQuery&&issues.length === 0) return <Empty />;
  return (
    <>
      {selecting ? (
        <TaskBulkBar
          workspaceId={workspaceId}
          selected={selectedShown}
          clear={() => {
            setSelected([]);
            setSelecting(false);
          }}
          onResults={(results) =>
            setSelected(results.filter((row) => !row.ok).map((row) => row.id))
          }
        />
      ) : null}
      <TaskViewBar
        phoneCollapsed={phoneToolsCollapsed}
        workspaceId={workspaceId}
        view={view}
        onChange={setView}
        fields={fields}
        choices={choices}
        issues={pageIssues}
        manageFields={manageFields}
        onFieldsChanged={() => router.refresh()}
        leading={<>
        <DisplayMenu
          open={displayOpen}
          onOpenChange={setDisplayOpen}
          display={display}
          onChange={changeDisplay}
          layout={layout}
          onLayoutChange={setLayout}
          activeView={active}
          onSaveForEveryone={saveDisplay}
          onSavePersonal={saveDisplay}
          onResetPersonal={resetDisplay}
          saving={savingDisplay}
          error={displayError}
        />
          {layout === "table" && <span ref={setColumnsSlot} className="contents" />}
        <TaskViews
          workspaceId={workspaceId}
          scope={scope}
          projectId={projectId}
          context={viewScope}
          definition={currentDefinition}
          active={active}
          onSelect={selectView}
        />
        </>}
        trailing={<>
          {!serverQuery && shown.length !== issues.length && <span className="text-small tabular-nums text-faint">{`${shown.length} / ${issues.length}`}</span>}
          {selecting && <BatchSelection key={queryKey+viewKey} workspaceId={workspaceId} kind="task" items={shown} loadItems={serverQuery?()=>taskViewCandidatesAction(workspaceId,serverQuery,effectiveView):undefined}/>}
        <button
          type="button"
          data-bulk-select
          aria-pressed={selecting}
          onClick={() => {
            setSelecting((mode) => !mode);
            setSelected([]);
          }}
          className={`inline-flex h-[26px] items-center gap-1.5 rounded-lg px-2.5 text-small transition-colors ${
            selecting ? "bg-elevated font-medium text-text" : "text-muted hover:bg-elevated hover:text-text"
          }`}
        >
          <CheckSquare size={14} /> {t("Pick tasks")}
        </button>
        </>}
        onExport={serverQuery ? () => void exportView() : undefined}
        exportDisabled={pending}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<Filter size={16} />}
          title={t("No tasks match this filter")}
          hint={view.filters.length > 0 ? t("Current filters: {filters}", { filters: filterSummary(view, fields, pageIssues, t, choices) }) : undefined}
        >
          {view.filters.length > 0 && (
            <button
              type="button"
              onClick={() => setView({ ...view, filters: [] })}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors bg-bg text-text hover:bg-active"
            >
              {t("Clear filters")}
            </button>
          )}
        </EmptyState>
      ) : layout === "board" ? (
        <IssueBoard issues={shown} workspaceId={workspaceId} currentUserId={currentUserId} manualOrder={isManualOrder(effectiveView)} groups={groups} grouping={grouping} properties={display.properties} selection={selection} />
      ) : layout === "table" ? (
        <TaskGrid currentUserId={currentUserId}
          workspaceId={workspaceId}
          issues={shown}
          fields={fields}
          values={pageValues}
          view={view}
          onViewChange={setView}
          properties={display.properties}
          selection={selection}
          columnsSlot={columnsSlot}
        />
      ) : layout === "calendar" ? (
        <TaskCalendar workspaceId={workspaceId} issues={shown} />
      ) : (
        <IssueTable issues={shown} groups={groups} properties={display.properties} selection={selection} />
      )}
      {serverQuery && (pending || failure || (remote?.total ?? 0) > 100 || (remote?.page ?? 0) > 0) && (
        <div className={`flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-t border-border py-1 text-small text-muted ${PAGE_INSET}`}>
          {((remote?.total ?? 0) > 100 || (remote?.page ?? 0) > 0) && <>
            <span className="tabular-nums text-faint">{`${(remote?.page ?? 0) * 100 + (shown.length ? 1 : 0)}–${(remote?.page ?? 0) * 100 + shown.length} / ${remote?.total ?? 0}`}</span>
            <button type="button" className="rounded-md px-2 py-1 hover:bg-elevated hover:text-text disabled:opacity-50" disabled={pending || !remote?.page} onClick={() => void changePage((remote?.page ?? 0) - 1)}>{t("Previous page")}</button>
            <button type="button" className="rounded-md px-2 py-1 hover:bg-elevated hover:text-text disabled:opacity-50" disabled={pending || !remote || (remote.page + 1) * 100 >= remote.total} onClick={() => void changePage((remote?.page ?? 0) + 1)}>{t("Next page")}</button>
          </>}
          {pending && <span>{t("Loading…")}</span>}
          {failure && <span role="alert" className="text-danger">{t(failure)} <button type="button" className="underline" onClick={() => void changePage(0, true)}>{t("Refresh")}</button></span>}
        </div>
      )}
    </>
  );
}
