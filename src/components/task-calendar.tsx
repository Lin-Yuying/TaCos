"use client";

import { VirtualStack } from "@/components/ui/virtual-stack";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin, {Draggable} from "@fullcalendar/react/interaction";
import zhLocale from "@fullcalendar/react/locales/zh-cn";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState } from "react";
import { updateIssueAction } from "@/app/actions";
import { useLocale, useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import type { IssueWithLabels } from "@/lib/issues";
import { PAGE_INSET } from "@/lib/page-chrome";

/** The calendar view: tasks on their due dates. Dragging a task to another day moves its due date. */
export default function TaskCalendar({
  workspaceId,
  issues,
}: {
  workspaceId: string;
  issues: IssueWithLabels[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue,setComposerOpen } = useUI();
  const [error, setError] = useState<string | null>(null);
  const tray=useRef<HTMLDivElement>(null);
  const undatedItems=issues.filter(issue=>!issue.dueDate);
  const undated=undatedItems.length;
  useEffect(()=>{if(!tray.current)return;const draggable=new Draggable(tray.current,{itemSelector:"[data-unscheduled-task]",eventData:element=>({id:element.dataset.id,title:element.dataset.title,allDay:true})});return()=>draggable.destroy();},[]);
  async function schedule(id:string,date:string,revert:()=>void,complete?:()=>void){try{const result=await updateIssueAction(workspaceId,id,{dueDate:date.slice(0,10)});if(!result.ok){setError(result.error);revert();}else{setError(null);complete?.();router.refresh();}}catch{setError("Could not save. Retry.");revert();}}


  return (
    <div data-task-calendar className={`task-calendar min-h-0 flex-1 overflow-auto py-3 text-small ${PAGE_INSET}`}>
      {(undated > 0 || error) && (
        <div className="mb-2 text-small text-faint">
          {error ? <span className="text-danger">{t(error)}</span> : t("{count} tasks have no due date", { count: undated })}
        </div>
      )}
      <div ref={tray} className="mb-3"><VirtualStack items={undatedItems} keyFor={issue=>issue.id} estimate={34} style={{height:Math.min(160,undatedItems.length*34),overflow:"auto"}} render={issue=><button key={issue.id} data-unscheduled-task data-id={issue.id} data-title={issue.title} onClick={()=>openIssue(issue.id)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small cursor-grab border border-border bg-surface bg-bg text-text hover:bg-active">{issue.title}</button>}/></div>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin, classicTheme]}
        initialView="dayGridMonth"
        locales={[zhLocale]}
        locale={locale === "zh" ? "zh-cn" : "en"}
        height="auto"
        dayMaxEvents={3}
        droppable
        dateClick={({dateStr})=>setComposerOpen(true,null,{dueDate:dateStr.slice(0,10)})}
        eventReceive={({event,revert})=>void schedule(event.id,event.startStr,revert,()=>event.remove())}
        editable
        eventDurationEditable={false}
        headerToolbar={{ left: "title", center: "", right: "today prev,next" }}
        events={issues
          .filter((issue) => issue.dueDate)
          .map((issue) => ({ id: issue.id, title: issue.title, start: issue.dueDate!, allDay: true }))}
        eventClick={({ event }) => openIssue(event.id)}
        eventDrop={({event,revert})=>void schedule(event.id,event.startStr,revert)}
      />
    </div>
  );
}
