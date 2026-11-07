"use client";

import { VirtualStack } from "@/components/ui/virtual-stack";
import { EntityRow } from "@/components/ui/entity-row";

import { useEffect, useRef, useMemo, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { moveIssueAction, updateIssueAction } from "@/app/actions";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge } from "@/components/icons";
import { AssigneeStack, useAssigneeHref } from "@/components/issue-table";
import { useUI, type TaskSelection } from "@/components/ui-context";
import { BOARD_STATUS_ORDER, STATUS_META, type Status } from "@/lib/constants";
import { PAGE_BOARD } from "@/lib/page-chrome";
import { issueRef } from "@/lib/format";
import type { IssueWithLabels } from "@/lib/issues";
import { useT } from "@/components/i18n-context";
import type { TaskGroup } from "@/lib/view-grouping";
import { VIEW_PROPERTIES, type ViewGrouping, type ViewProperty } from "@/lib/task-view";

const ALL_PROPERTIES: ViewProperty[] = [...VIEW_PROPERTIES];

function BoardCard({
  issue,
  dragging,
  onDragStart,
  onDragEnd,
  canDrag,
  properties,
  selection,
}: {
  issue: IssueWithLabels;
  dragging: boolean;
  onDragStart: (issue: IssueWithLabels) => void;
  onDragEnd: () => void;
  canDrag: boolean;
  properties: ViewProperty[];
  selection?: TaskSelection;
}) {
  const t = useT();
  const { openIssue, openIssueId } = useUI();
  const assigneeHref = useAssigneeHref();
  const opened = openIssueId === issue.id;
  const show = (property: ViewProperty) => properties.includes(property);
  const checked = selection?.selected.has(issue.id) ?? false;

  return (
    <EntityRow kind="task" id={issue.id} title={issue.title}>
    <article
      data-issue-id={issue.id}
      data-selected={checked || undefined}
      role="button"
      tabIndex={0}
      onKeyDown={(event)=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing)openIssue(issue.id);}}
      draggable={canDrag}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", issue.id);
        onDragStart(issue);
      }}
      onDragEnd={onDragEnd}
      onClick={() => openIssue(issue.id)}
      className={`@container/card shrink-0 rounded-lg border bg-surface px-3 py-2.5 transition-colors ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
        checked ? "border-accent ring-1 ring-accent" : opened ? "border-accent" : "border-border hover:border-border-strong"
      } ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-small text-faint">
        {selection?.mode ? (
          <input
            type="checkbox"
            aria-label={t("Select task {title}", { title: issue.title })}
            checked={checked}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              selection.toggle(issue.id);
            }}
            className="h-3.5 w-3.5 shrink-0 accent-accent"
          />
        ) : null}
        {show("status") ? <StatusIcon status={issue.status} size={12} /> : null}
        {show("id") ? <span className="truncate font-mono">{issueRef(issue)}</span> : null}
        {show("project") ? (
          <span className="ml-1 min-w-0 truncate text-caption">{issue.projectName}</span>
        ) : null}
      </div>
      <h3 className="mt-1.5 line-clamp-2 text-body font-medium leading-snug text-text">
        {issue.title}
      </h3>
      {/* Narrow cards (four columns on a laptop, panel open) drop labels entirely and
          keep only priority + people; from ~240px there is room to show them again. */}
      <div className="mt-2 flex h-[18px] items-center gap-1.5 overflow-hidden">
        {show("priority") ? (
          <span className="flex shrink-0 items-center">
            <PriorityIcon priority={issue.priority} size={13} />
          </span>
        ) : null}
        {show("labels") ? (
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden @min-[240px]/card:flex">
            {issue.labels.slice(0, 2).map((label) => (
              <LabelPill key={label.id} name={label.name} color={label.color} small />
            ))}
            {issue.labels.length > 2 && (
              <span className="shrink-0 text-caption text-faint">+{issue.labels.length - 2}</span>
            )}
          </div>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {/* ml-auto keeps people pinned to the card's right edge even when the label
            group (the flex-1 spacer) is hidden on narrow cards. */}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <ViaBadge via={issue.createdVia} />
          {show("assignee") ? (
            <AssigneeStack assignees={issue.assignees} size={18} hrefFor={assigneeHref} />
          ) : null}
        </span>
      </div>
    </article>
    </EntityRow>
  );
}

function DropLine() {
  return <div className="h-0.5 shrink-0 rounded-full bg-accent" />;
}

function statusGroups(issues: IssueWithLabels[]): TaskGroup<IssueWithLabels>[] {
  return BOARD_STATUS_ORDER.map((status) => ({
    key: `status:${status}`,
    label: STATUS_META[status].label,
    property: "status" as const,
    value: status,
    tasks: issues.filter((issue) => issue.status === status),
  }));
}

/**
 * Kanban grouping. The default is one column per status, always all four. Other
 * groupings draw one column per assignee, priority or project; dropping a card into
 * another column adopts that column's property where the existing board can express
 * it. Changing status stays with the assignees, as everywhere else.
 */
export function IssueBoard({
  issues,
  workspaceId,
  currentUserId,
  manualOrder = true,
  groups: givenGroups,
  grouping = "status",
  properties = ALL_PROPERTIES,
  selection,
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
  manualOrder?: boolean;
  groups?: TaskGroup<IssueWithLabels>[];
  grouping?: ViewGrouping;
  properties?: ViewProperty[];
  selection?: TaskSelection;
}) {
  const t = useT();
  const router = useRouter();
  const {toast} = useUI();
  const [moving,setMoving]=useState(false);
  const [, startTransition] = useTransition();
  const [drag, setDrag] = useState<IssueWithLabels | null>(null);
  const overFrame=useRef(0),overPending=useRef<{key:string;index:number}|null>(null);
  useEffect(()=>()=>cancelAnimationFrame(overFrame.current),[]);
  const [over, setOver] = useState<{ key: string; index: number } | null>(null);

  const columns = useMemo(
    () => givenGroups ?? statusGroups(issues),
    [givenGroups, issues]
  );
  const columnByTask = useMemo(() => {
    const map = new Map<string, TaskGroup<IssueWithLabels>>();
    for (const column of columns) for (const issue of column.tasks) map.set(issue.id, column);
    return map;
  }, [columns]);

  const ranks=useMemo(()=>new Map(columns.flatMap(column=>column.tasks.map((issue,index)=>[issue.id,index] as const))),[columns]);

  function canAdopt(issue: IssueWithLabels, column: TaskGroup<IssueWithLabels>): boolean {
    const from = columnByTask.get(issue.id);
    if (!from || from.key === column.key) return true;
    if (grouping === "status") {
      return issue.assignees.some((assignee) => assignee.id === currentUserId);
    }
    return grouping === "assignee" || grouping === "priority";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, column: TaskGroup<IssueWithLabels>, rawIndex:number) {
    if (!drag || moving) return;
    if (drag.status === column.value && !manualOrder && grouping === "status") return;
    if (!canAdopt(drag, column)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const source=columnByTask.get(drag.id)?.key===column.key?(ranks.get(drag.id)??-1):-1;
    const index=rawIndex-(source>=0&&source<rawIndex?1:0);
    overPending.current={key:column.key,index};
    if(!overFrame.current)overFrame.current=requestAnimationFrame(()=>{overFrame.current=0;const next=overPending.current;setOver(previous=>previous?.key===next?.key&&previous?.index===next?.index?previous:next);});
  }

  async function updateColumn(issue: IssueWithLabels, column: TaskGroup<IssueWithLabels>) {
    if (grouping === "status") {
      if (issue.status !== column.value && !issue.assignees.some((assignee) => assignee.id === currentUserId)) {
        toast(t("Only assignees can change status"));
        return false;
      }
      const result = await moveIssueAction(workspaceId, issue.id, {
        status: column.value as Status,
        beforeId: null,
        afterId: null,
      });
      if (!result.ok) { toast(t(result.error)); return false; }
      return true;
    }
    if (grouping === "assignee") {
      const result = await updateIssueAction(workspaceId, issue.id, {
        assigneeIds: column.value ? [column.value] : [],
      });
      if (!result.ok) { toast(t(result.error)); return false; }
      return true;
    }
    if (grouping === "priority") {
      const result = await updateIssueAction(workspaceId, issue.id, {
        priority: Number(column.value) as 0 | 1 | 2 | 3 | 4,
      });
      if (!result.ok) { toast(t(result.error)); return false; }
      return true;
    }
    return false;
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, column: TaskGroup<IssueWithLabels>, rawIndex:number) {
    event.preventDefault();
    const issue = drag;
    const from = issue ? columnByTask.get(issue.id) : undefined;
    const source=from?.key===column.key?(ranks.get(issue!.id)??-1):-1;
    const target = {key: column.key, index:rawIndex-(source>=0&&source<rawIndex?1:0)};
    cancelAnimationFrame(overFrame.current);overFrame.current=0;overPending.current=null;
    setDrag(null);
    setOver(null);
    if (!issue || moving) return;
    if (!canAdopt(issue, column)) return;

    const crossColumn = from?.key !== column.key;
    // A sorted column has no manual order to drop into; cross-column drops still
    // adopt the column's property above.
    if (!crossColumn && !manualOrder) return;
    if (crossColumn) {
      setMoving(true);
      try {
        const changed = await updateColumn(issue, column);
        if (changed) startTransition(() => router.refresh());
      } catch {
        toast(t("Could not move task. Retry."));
      } finally {
        setMoving(false);
      }
      return;
    }

    const items = column.tasks;
    const rest = items.filter((item) => item.id !== issue.id);
    const beforeId = rest[target.index - 1]?.id ?? null;
    const afterId = rest[target.index]?.id ?? null;
    if (issue.status === column.value) {
      const current = items.findIndex((item) => item.id === issue.id);
      if (current !== -1) {
        const above = items[current - 1]?.id ?? null;
        const below = items[current + 1]?.id ?? null;
        if (above === beforeId && below === afterId) return;
      }
    }

    setMoving(true);
    try {
      const result = await moveIssueAction(workspaceId, issue.id, { beforeId:manualOrder?beforeId:null, afterId:manualOrder?afterId:null });
      if (result.ok) startTransition(() => router.refresh()); else toast(t(result.error));
    }catch{toast(t("Could not move task. Retry."));}finally{setMoving(false);}
  }

  return (
    // min-h-0 keeps the board inside the card: without it the columns' content height
    // wins over the flex budget and the last cards get clipped by the card's overflow.
    <div className={`@container flex min-h-0 flex-1 gap-1.5 overflow-x-auto overflow-y-hidden ${PAGE_BOARD}`} data-task-board>
      {columns.map((column) => {
        const status = grouping === "status" && column.value ? (column.value as Status) : null;
        const canDragColumn = grouping === "status" || grouping === "assignee" || grouping === "priority";
        return (
          <section key={column.key} data-board-group={column.key} className="flex min-h-0 min-w-[260px] flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-1 pb-2">
              {status ? <StatusIcon status={status} size={13} /> : null}
              <span className="truncate text-small font-medium text-muted">
                {t(column.label)}
              </span>
              <span className="text-small text-faint">{column.tasks.length}</span>
              {status ? <AddIssueButton status={status} /> : null}
            </header>
            {column.tasks.length>0&&<VirtualStack items={column.tasks} keyFor={issue=>issue.id} estimate={126} keepIndex={drag?.status===column.value&&columnByTask.get(drag.id)?.key===column.key?ranks.get(drag.id):undefined}
              onDragOverIndex={(event,index)=>handleDragOver(event,column,index)} onDropIndex={(event,index)=>void handleDrop(event,column,index)}
              render={(issue,index)=>{
                const source=columnByTask.get(drag?.id??"")?.key===column.key?(ranks.get(drag!.id)??-1):-1;
                const slot=index-(source>=0&&source<index?1:0);
                const showLine=!!drag&&drag.id!==issue.id&&over?.key===column.key&&over.index===slot;
                return <div className="relative pb-2">{showLine&&<div className="absolute inset-x-0 top-0 z-10"><DropLine/></div>}
                  <BoardCard issue={issue} dragging={drag?.id===issue.id} properties={properties} selection={selection}
                    canDrag={canDragColumn}
                    onDragStart={issue=>{setDrag(issue);if(grouping==="status"&&!issue.assignees.some(person=>person.id===currentUserId))toast(t("Only assignees can change status"));else if(!manualOrder)toast(t("Field sorting is active. Clear sorting to reorder cards."));}}
                    onDragEnd={()=>{cancelAnimationFrame(overFrame.current);overFrame.current=0;setDrag(null);setOver(null);}}/>
                  {!!drag&&over?.key===column.key&&index===column.tasks.length-1&&over.index===column.tasks.length-(source>=0?1:0)&&<DropLine/>}
                </div>;
              }}/>}
            {column.tasks.length===0&&<div onDragOver={event=>handleDragOver(event,column,0)} onDrop={event=>void handleDrop(event,column,0)} className="min-h-24 rounded-lg border border-dashed border-border px-3 py-4 text-center text-small text-faint">
              {grouping === "status" ? t("No {status} tasks",{status:t(column.label)}) : t("Drop tasks here")}
            </div>}

          </section>
        );
      })}
    </div>
  );
}
