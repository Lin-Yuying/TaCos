"use client";

import { VirtualStack } from "@/components/ui/virtual-stack";
import { EntityRow } from "@/components/ui/entity-row";

import { useEffect, useRef, useMemo, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { moveIssueAction } from "@/app/actions";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge } from "@/components/icons";
import { AssigneeStack, useAssigneeHref } from "@/components/issue-table";
import { useUI } from "@/components/ui-context";
import { BOARD_STATUS_ORDER, STATUS_META, type Status } from "@/lib/constants";
import { PAGE_BOARD } from "@/lib/page-chrome";
import { issueRef } from "@/lib/format";
import type { IssueWithLabels } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

function BoardCard({
  issue,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  issue: IssueWithLabels;
  dragging: boolean;
  onDragStart: (issue: IssueWithLabels) => void;
  onDragEnd: () => void;
}) {
  const { openIssue, openIssueId } = useUI();
  const assigneeHref = useAssigneeHref();
  const opened = openIssueId === issue.id;

  return (
    <EntityRow kind="task" id={issue.id} title={issue.title}>
    <article
      data-issue-id={issue.id}
      role="button"
      tabIndex={0}
      onKeyDown={(event)=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing)openIssue(issue.id);}}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", issue.id);
        onDragStart(issue);
      }}
      onDragEnd={onDragEnd}
      onClick={() => openIssue(issue.id)}
      className={`@container/card shrink-0 cursor-grab rounded-lg border bg-surface px-3 py-2.5 transition-colors active:cursor-grabbing ${
        opened ? "border-accent" : "border-border hover:border-border-strong"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-small text-faint">
        <StatusIcon status={issue.status} size={12} />
        <span className="truncate font-mono">{issueRef(issue)}</span>
      </div>
      <h3 className="mt-1.5 line-clamp-2 text-body font-medium leading-snug text-text">
        {issue.title}
      </h3>
      {/* Narrow cards (four columns on a laptop, panel open) drop labels entirely and
          keep only priority + people; from ~240px there is room to show them again. */}
      <div className="mt-2 flex h-[18px] items-center gap-1.5 overflow-hidden">
        <span className="flex shrink-0 items-center">
          <PriorityIcon priority={issue.priority} size={13} />
        </span>
        <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden @min-[240px]/card:flex">
          {issue.labels.slice(0, 2).map((label) => (
            <LabelPill key={label.id} name={label.name} color={label.color} small />
          ))}
          {issue.labels.length > 2 && (
            <span className="shrink-0 text-caption text-faint">+{issue.labels.length - 2}</span>
          )}
        </div>
        {/* ml-auto keeps people pinned to the card's right edge even when the label
            group (the flex-1 spacer) is hidden on narrow cards. */}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <ViaBadge via={issue.createdVia} />
          <AssigneeStack assignees={issue.assignees} size={18} hrefFor={assigneeHref} />
        </span>
      </div>
    </article>
    </EntityRow>
  );
}

function DropLine() {
  return <div className="h-0.5 shrink-0 rounded-full bg-accent" />;
}

/**
 * Kanban grouping: one column per status, always all four so a card has somewhere to
 * go. Columns share the width down to 100px, which keeps all four visible at the
 * desktop shell's 720px minimum window. Cards can be dragged to reorder a column or
 * to change status — changing status follows the same creator/assignee rule as the
 * detail panel, reordering is open to every member.
 */
export function IssueBoard({
  issues,
  workspaceId,
  currentUserId,
  manualOrder = true,
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
  manualOrder?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const {toast} = useUI();
  const [moving,setMoving]=useState(false);
  const [, startTransition] = useTransition();
  const [drag, setDrag] = useState<IssueWithLabels | null>(null);
  const overFrame=useRef(0),overPending=useRef<{status:Status;index:number}|null>(null);
  useEffect(()=>()=>cancelAnimationFrame(overFrame.current),[]);
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null);

  const columns = useMemo(
    () =>
      BOARD_STATUS_ORDER.map((status: Status) => ({
        status,
        items: issues.filter((issue) => issue.status === status),
      })),
    [issues],
  );

  const ranks=useMemo(()=>new Map(columns.flatMap(column=>column.items.map((issue,index)=>[issue.id,index] as const))),[columns]);

  // Cross-column drags change status, which is reserved to assignees; everyone else
  // can still drag cards up and down inside their current column.
  function canChangeStatus(issue: IssueWithLabels) {
    return issue.assignees.some((assignee) => assignee.id === currentUserId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, status: Status, rawIndex:number) {
    if (!drag || moving) return;
    if (drag.status === status && !manualOrder) return;
    if (drag.status !== status && !canChangeStatus(drag)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const source=drag.status===status?(ranks.get(drag.id)??-1):-1;
    const index=rawIndex-(source>=0&&source<rawIndex?1:0);
    overPending.current={status,index};
    if(!overFrame.current)overFrame.current=requestAnimationFrame(()=>{overFrame.current=0;const next=overPending.current;setOver(previous=>previous?.status===next?.status&&previous?.index===next?.index?previous:next);});
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, status: Status, rawIndex:number) {
    event.preventDefault();
    const issue = drag;
    const source=drag?.status===status?(ranks.get(drag.id)??-1):-1;
    const target = {status,index:rawIndex-(source>=0&&source<rawIndex?1:0)};
    cancelAnimationFrame(overFrame.current);overFrame.current=0;overPending.current=null;
    setDrag(null);
    setOver(null);
    if (!issue || !target || target.status !== status || moving) return;
    if(issue.status === status && !manualOrder)return;
    if (issue.status !== status && !canChangeStatus(issue)) return;

    const items = columns.find((column) => column.status === status)?.items ?? [];
    const rest = items.filter((item) => item.id !== issue.id);
    const beforeId = rest[target.index - 1]?.id ?? null;
    const afterId = rest[target.index]?.id ?? null;

    if (issue.status === status) {
      // Dropping a card back into its own slot is a no-op, not an activity entry.
      const current = items.findIndex((item) => item.id === issue.id);
      if (current !== -1) {
        const above = items[current - 1]?.id ?? null;
        const below = items[current + 1]?.id ?? null;
        if (above === beforeId && below === afterId) return;
      }
    }

    setMoving(true);
    try {
      const result = await moveIssueAction(workspaceId, issue.id, { status, beforeId:manualOrder?beforeId:null, afterId:manualOrder?afterId:null });
      if (result.ok) startTransition(() => router.refresh()); else toast(t(result.error));
    }catch{toast(t("Could not move task. Retry."));}finally{setMoving(false);}
  }

  return (
    // min-h-0 keeps the board inside the card: without it the columns' content height
    // wins over the flex budget and the last cards get clipped by the card's overflow.
    <div className={`@container flex min-h-0 flex-1 gap-1.5 overflow-x-auto ${PAGE_BOARD}`}>
      {columns.map(({ status, items }) => {
        return (
          <section key={status} className="flex min-h-0 min-w-[260px] flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-1 pb-2">
              <StatusIcon status={status} size={13} />
              <span className="truncate text-small font-medium text-muted">
                {t(STATUS_META[status].label)}
              </span>
              <span className="text-small text-faint">{items.length}</span>
              <AddIssueButton status={status} />
            </header>
            <VirtualStack items={items} keyFor={issue=>issue.id} estimate={126} keepIndex={drag?.status===status?ranks.get(drag.id):undefined}
              onDragOverIndex={(event,index)=>handleDragOver(event,status,index)} onDropIndex={(event,index)=>void handleDrop(event,status,index)}
              render={(issue,index)=>{
                const source=drag?.status===status?(ranks.get(drag.id)??-1):-1;
                const slot=index-(source>=0&&source<index?1:0);
                const showLine=!!drag&&drag.id!==issue.id&&over?.status===status&&over.index===slot;
                return <div className="relative pb-2">{showLine&&<div className="absolute inset-x-0 top-0 z-10"><DropLine/></div>}
                  <BoardCard issue={issue} dragging={drag?.id===issue.id}
                    onDragStart={issue=>{setDrag(issue);if(!canChangeStatus(issue))toast(t("Only assignees can change status"));else if(!manualOrder)toast(t("Field sorting is active. Clear sorting to reorder cards."));}}
                    onDragEnd={()=>{cancelAnimationFrame(overFrame.current);overFrame.current=0;setDrag(null);setOver(null);}}/>
                  {!!drag&&over?.status===status&&index===items.length-1&&over.index===items.length-(source>=0?1:0)&&<DropLine/>}
                </div>;
              }}/>
            {items.length===0&&<div onDragOver={event=>handleDragOver(event,status,0)} onDrop={event=>void handleDrop(event,status,0)} className="min-h-24 rounded-lg border border-dashed border-border px-3 py-4 text-center text-small text-faint">{t("No {status} tasks",{status:t(STATUS_META[status].label)})}</div>}

          </section>
        );
      })}
    </div>
  );
}
