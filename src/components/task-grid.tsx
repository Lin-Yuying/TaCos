"use client";
import { OptionSearch,matchesOption } from "@/components/ui/option-search";

import { usePathname, useRouter } from "next/navigation";
import { EntityRow } from "@/components/ui/entity-row";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { columnSizingFeature, columnResizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { setTaskFieldValueAction, updateIssueAction, changeIssueCollectionAction } from "@/app/actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { PriorityIcon, StatusIcon, STATUS_META } from "@/components/icons";
import { useT } from "@/components/i18n-context";
import { useUI, type TaskSelection } from "@/components/ui-context";
import { issueRef } from "@/lib/format";
import type { IssueWithLabels } from "@/lib/issues";
import { Menu } from "@/components/menu";
import { useDraft } from "@/lib/ui/draft-store";
import { DuePicker } from "@/components/ui/due-picker";
import { useStoredJson } from "@/lib/use-stored-json";
import { readJson } from "@/lib/ui/request";
import { STATUS_ORDER, PRIORITY_NAMES, type Status, type Priority } from "@/lib/constants";
import type { Member, UpdateIssueInput } from "@/lib/issues";
import { fieldKey, VIEW_PROPERTIES, type FieldValues, type TaskField, type TaskView, type ViewProperty } from "@/lib/task-view";

const FEATURES = tableFeatures({ columnSizingFeature, columnResizingFeature });

const CELL_INPUT = "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-small text-text hover:border-border focus:border-border focus:outline-none";

function FieldCell({id,field,value,onSave}:{id:string;field:TaskField;value:string;onSave:(next:string|null)=>Promise<boolean>}) {
 const t=useT();const [savedDraft,setDraft]=useDraft<string|null>("grid-cell",id,null);const draft=savedDraft??value;const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);const running=useRef(false);
 async function save(next:string){if(running.current)return;running.current=true;setBusy(true);try{const ok=await onSave(next||null);setFailed(!ok);if(ok)setDraft(old=>old===next?null:old);}finally{running.current=false;setBusy(false);}}
 const props={disabled:busy,onClick:(event:React.SyntheticEvent)=>event.stopPropagation(),className:CELL_INPUT,"aria-label":field.name};
 return <div className="min-w-0 flex-1">{field.type==="checkbox"?<input {...props} type="checkbox" checked={draft==="1"} onChange={e=>{const next=e.target.checked?"1":"";setDraft(next);void save(next);}}/>:field.type==="select"?<select {...props} value={draft} onChange={e=>{setDraft(e.target.value);void save(e.target.value);}}><option value=""/>{[...new Set([...field.options,...(draft?[draft]:[])])].map(option=><option key={option} value={option}>{option}</option>)}</select>:<input {...props} type={field.type==="date"?"date":field.type==="number"?"number":"text"} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(draft!==value)void save(draft);}} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}/>}{failed&&<button className="text-caption text-danger" onClick={e=>{e.stopPropagation();void save(draft);}}>{t("Retry")}</button>}</div>;
}

const SORT_KEYS: Record<string, string> = {
  ref: "",
  title: "title",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  dueDate: "dueDate",
};

// Display properties map onto the table's built-in columns. Title always shows.
const COLUMN_PROPERTY: Record<string, ViewProperty> = {
  ref: "id",
  status: "status",
  priority: "priority",
  assignee: "assignee",
  dueDate: "dueDate",
};

const ALL_PROPERTIES: ViewProperty[] = [...VIEW_PROPERTIES];

/** The table view: built-in columns plus the workspace's fields, which edit in place. */
export function TaskGrid({
  workspaceId,
  currentUserId,
  issues,
  fields,
  values,
  view,
  onViewChange,
  properties = ALL_PROPERTIES,
  selection,
  columnsSlot,
}: {
  workspaceId: string;
  currentUserId:string;
  issues: IssueWithLabels[];
  fields: TaskField[];
  values: FieldValues;
  view: TaskView;
  onViewChange: (next: TaskView) => void;
  properties?: ViewProperty[];
  selection?: TaskSelection;
  // Where the Columns menu goes: the toolbar, so the grid does not add a third row.
  columnsSlot?: HTMLElement | null;
}) {
  const t = useT();
  const [memberQuery,setMemberQuery]=useState("");
  const { openIssue, scope, density } = useUI();
  const ROW_HEIGHT=density==="compact"?30:40;
  const pathname=usePathname();
  const [settings,setSettings]=useStoredJson<{sizes:Record<string,number>;hidden:string[];order:string[];frozen:string[]}>(`tacos.grid.${scope}.${pathname}`,{sizes:{},hidden:[],order:[],frozen:[]});
  const [members,setMembers]=useState<Member[]>([]);
  useEffect(()=>{let live=true;readJson<Member[]>(`/api/internal/${workspaceId}/members`,(data):data is Member[]=>Array.isArray(data)).then(data=>{if(live)setMembers(data);}).catch(()=>{if(live)setError("Could not load members. Reopen this view to retry.");});return()=>{live=false;};},[workspaceId]);
  async function update(id:string,patch:UpdateIssueInput){try{const result=await updateIssueAction(workspaceId,id,patch);if(!result.ok){setError(result.error);return false;}setError(null);router.refresh();return true;}catch{setError("Could not save. Retry.");return false;}}
  const router=useRouter();
  const [memberBusy,setMemberBusy]=useState<string[]>([]);
  const memberRunning=useRef(new Set<string>());
  const saving=useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useScrollMemory(scroller,`task-grid.${pathname}`);

  const columns = useMemo(() => {
    const column = createColumnHelper<typeof FEATURES, IssueWithLabels>();
    const valueOf = (issueId: string, fieldId: string) => {
      return values[issueId]?.[fieldId] ?? "";
    };
    const save = async (issueId: string, fieldId: string, next: string | null) => {
      const key=`${issueId}:${fieldId}`;
      if(saving.current.has(key))return false;
      saving.current.add(key);
      try {
      const result = await setTaskFieldValueAction(workspaceId, issueId, fieldId, next);
      if (result.ok) {
        setError(null);
        router.refresh();return true;
      } else {
        setError(result.error);return false;
      }
      }catch{setError("Could not save. Retry.");return false;}finally{saving.current.delete(key);}
    };
    return column.columns([
      column.display({
        id: "ref",
        header: t("ID"),
        size: 110,
        cell: ({ row }) => <span className="truncate text-small text-faint">{issueRef(row.original)}</span>,
      }),
      column.accessor("title", {
        id: "title",
        header: t("Title"),
        size: 320,
        cell: ({ row }) => <EntityRow kind="task" id={row.original.id} title={row.original.title}><input aria-label={t("Title")} key={row.original.title} defaultValue={row.original.title} onClick={e=>e.stopPropagation()} onBlur={e=>{if(e.target.value!==row.original.title)void update(row.original.id,{title:e.target.value});}} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} className={CELL_INPUT}/></EntityRow>,
      }),
      column.accessor("status", {
        id: "status",
        header: t("Status"),
        size: 120,
        cell: ({ row }) => <select disabled={!row.original.assignees.some(person=>person.id===currentUserId)} title={row.original.assignees.some(person=>person.id===currentUserId)?undefined:t("Only assignees can change status")} aria-label={t("Status")} value={row.original.status} onClick={e=>e.stopPropagation()} onChange={e=>void update(row.original.id,{status:e.target.value as Status})} className={CELL_INPUT}>{STATUS_ORDER.map(status=><option key={status} value={status}>{t(STATUS_META[status].label)}</option>)}</select>,
      }),
      column.accessor("priority", {
        id: "priority",
        header: t("Priority"),
        size: 70,
        cell: ({ row }) => <select aria-label={t("Priority")} value={row.original.priority} onClick={e=>e.stopPropagation()} onChange={e=>void update(row.original.id,{priority:Number(e.target.value) as Priority})} className={CELL_INPUT}>{[0,1,2,3,4].map(priority=><option key={priority} value={priority}>{t(PRIORITY_NAMES[priority as Priority])}</option>)}</select>,
      }),
      column.display({
        id: "assignee",
        header: t("Assignee"),
        size: 100,
        cell: ({ row }) => <div onClick={e=>e.stopPropagation()}><Menu trigger={row.original.assignees.map(person=>person.displayName).join(", ")||t("Assignee")}>{()=> <div className="max-h-64 overflow-auto p-2"><OptionSearch value={memberQuery} onChange={setMemberQuery} selected={row.original.assignees.length}/>{members.filter(member=>matchesOption(memberQuery,member.displayName,member.username)).map(member=><label key={member.id} className="flex gap-2 py-1"><input type="checkbox" disabled={memberBusy.includes(`${row.original.id}:${member.id}`)} checked={row.original.assignees.some(person=>person.id===member.id)} onChange={async e=>{const key=`${row.original.id}:${member.id}`;if(memberRunning.current.has(key))return;memberRunning.current.add(key);setMemberBusy(old=>[...old,key]);try{const result=await changeIssueCollectionAction(workspaceId,row.original.id,{kind:"assignee",value:member.id,selected:e.target.checked});if(!result.ok)setError(result.error);else router.refresh();}catch{setError("Could not save. Retry.");}finally{memberRunning.current.delete(key);setMemberBusy(old=>old.filter(value=>value!==key));}}}/>{member.displayName}</label>)}</div>}</Menu></div>,
      }),
      column.accessor("dueDate", {
        id: "dueDate",
        header: t("Due date"),
        size: 110,
        cell: ({ row }) => <div onClick={e=>e.stopPropagation()}><DuePicker value={row.original.dueDate} reminder={row.original.reminder} onSave={(dueDate,reminder)=>update(row.original.id,{dueDate,reminder})}/></div>,
      }),
      ...fields.map((field) =>
        column.display({
          id: fieldKey(field.id),
          header: field.name,
          size: field.type === "checkbox" ? 90 : 150,
          cell: ({ row }) => (
            <FieldCell id={`${row.original.id}:${field.id}`} key={`${row.original.id}:${field.id}:${valueOf(row.original.id,field.id)}`}
              field={field}
              value={valueOf(row.original.id, field.id)}
              onSave={(next) => save(row.original.id, field.id, next)}
            />
          ),
        })
      ),
    ]);
  // Cells read current server values after every refresh.
  }, [fields, t, values, workspaceId,router,members,memberBusy,currentUserId,memberQuery]);

  const orderRanks=new Map(settings.order.map((id,index)=>[id,index]));
  const hiddenIds=new Set(settings.hidden),frozenIds=new Set(settings.frozen);
  const ordered=[...columns]
    .filter(column=>{
      const property=COLUMN_PROPERTY[String(column.id)];
      return !property||properties.includes(property);
    })
    .sort((a,b)=>(orderRanks.get(String(a.id))??999)-(orderRanks.get(String(b.id))??999))
    .filter(column=>!hiddenIds.has(String(column.id)));
  const table = useTable({ features: FEATURES, data: issues, columns:ordered, columnResizeMode:"onEnd",state:{columnSizing:settings.sizes},onColumnSizingChange:updater=>setSettings(old=>({...old,sizes:typeof updater==="function"?updater(old.sizes):updater})) });
  const frozenLeft=new Map<string,number>();let left=0;
  for(const column of table.getAllLeafColumns())if(frozenIds.has(column.id)){frozenLeft.set(column.id,left);left+=column.getSize();}
  const sticky=(id:string)=>frozenLeft.has(id)?{position:"sticky" as const,left:frozenLeft.get(id)!,zIndex:2,background:"var(--color-bg)"}:{};
  function reorder(id:string,delta:number){const ids=columns.map(column=>String(column.id)).sort((a,b)=>(settings.order.indexOf(a)<0?999:settings.order.indexOf(a))-(settings.order.indexOf(b)<0?999:settings.order.indexOf(b)));const at=ids.indexOf(id),next=at+delta;if(next<0||next>=ids.length)return;[ids[at],ids[next]]=[ids[next],ids[at]];setSettings(old=>({...old,order:ids}));}
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const width = table.getTotalSize();

  function toggleSort(id: string) {
    const key = id.startsWith("field:") ? id : SORT_KEYS[id];
    if (!key) return;
    const current = view.sort[0]?.key === key ? view.sort[0].dir : null;
    onViewChange({
      ...view,
      // Off, ascending, descending, off: one click at a time, like every table.
      sort: current === "desc" ? [] : [{ key, dir: current === "asc" ? "desc" : "asc" }],
    });
  }

  return (
    <div data-task-grid ref={scroller} className="min-h-0 flex-1 overflow-auto text-small">
      {columnsSlot&&createPortal(<Menu width={300} triggerClassName="flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text" trigger={t("Columns")}>{()=> <div className="max-h-80 overflow-auto p-2 text-small">{columns.map(column=><div key={column.id} className="flex items-center gap-2 py-1"><label className="flex flex-1 gap-2"><input type="checkbox" checked={!settings.hidden.includes(String(column.id))} onChange={e=>setSettings(old=>({...old,hidden:e.target.checked?old.hidden.filter(id=>id!==column.id):[...old.hidden,String(column.id)]}))}/>{String(column.header)}</label><button type="button" className="rounded px-1 text-muted hover:bg-elevated hover:text-text" aria-label={t("Move up")} onClick={()=>reorder(String(column.id),-1)}>↑</button><button type="button" className="rounded px-1 text-muted hover:bg-elevated hover:text-text" aria-label={t("Move down")} onClick={()=>reorder(String(column.id),1)}>↓</button><button type="button" className="rounded px-1 text-muted hover:bg-elevated hover:text-text aria-pressed:bg-elevated aria-pressed:text-text" aria-pressed={settings.frozen.includes(String(column.id))} onClick={()=>setSettings(old=>({...old,frozen:old.frozen.includes(String(column.id))?old.frozen.filter(id=>id!==column.id):[...old.frozen,String(column.id)]}))}>{t("Freeze")}</button></div>)}<button type="button" className="mt-1 w-full rounded border-t border-border px-1 pt-2 text-left text-muted hover:text-text" onClick={()=>setSettings({sizes:{},hidden:[],order:[],frozen:[]})}>{t("Reset columns")}</button></div>}</Menu>,columnsSlot)}
      {error && <div className="sticky left-0 px-4 py-1 text-small text-danger">{t(error)}</div>}
      <div style={{ width, minWidth: "100%" }}>
        {table.getHeaderGroups().map((group) => (
          <div key={group.id} className="sticky top-0 z-10 flex border-b border-border bg-bg">
            {group.headers.map((header) => {
              const key = header.id.startsWith("field:") ? header.id : SORT_KEYS[header.id];
              const sort = view.sort.find((item) => item.key === key);
              return (
                <div key={header.id} style={{width:header.getSize(),...sticky(header.id)}} className="relative flex shrink-0">
                <button
                  type="button"
                  disabled={!key}
                  onClick={() => toggleSort(header.id)}
                  style={{ width: "100%" }}
                  className="flex shrink-0 items-center gap-1 truncate px-2 py-1.5 text-left text-small font-medium text-muted enabled:hover:text-text"
                >
                  <span className="truncate"><table.FlexRender header={header} /></span>
                  {sort && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button><div role="separator" aria-label={t("Resize column")} aria-orientation="vertical" aria-valuenow={header.getSize()} tabIndex={0} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} onDoubleClick={()=>setSettings(old=>({...old,sizes:{...old.sizes,[header.id]:columns.find(column=>column.id===header.id)?.size??150}}))} onKeyDown={e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();setSettings(old=>({...old,sizes:{...old.sizes,[header.id]:Math.max(50,header.getSize()+(e.key==="ArrowRight"?10:-10))}}));}}} className="absolute inset-y-0 right-0 w-1 cursor-col-resize touch-none hover:bg-accent"/></div>
              );
            })}
          </div>
        ))}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.id}
                data-task-row={row.original.id}
                onClick={() => openIssue(row.original.id)}
                style={{ position: "absolute", top: 0, transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                data-selected={selection?.selected.has(row.original.id) || undefined}
                className="flex w-full cursor-pointer items-center border-b border-border/60 hover:bg-elevated/60"
              >
                {selection?.mode ? (
                  <div className="flex w-8 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={t("Select task {title}", { title: row.original.title })}
                      checked={selection.selected.has(row.original.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation();
                        selection.toggle(row.original.id);
                      }}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                  </div>
                ) : null}
                {row.getAllCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize(),...sticky(cell.column.id) }}
                    className="flex shrink-0 items-center overflow-hidden px-2"
                  >
                    <table.FlexRender cell={cell} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
