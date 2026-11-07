"use client";
import { VirtualStack, type VirtualStackHandle } from "@/components/ui/virtual-stack";

import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { Bot } from "lucide-react";
import { useParams } from "next/navigation";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUI, isTyping, type TaskSelection } from "@/components/ui-context";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge, STATUS_META } from "@/components/icons";
import { STATUS_ORDER, PRIORITY_NAMES } from "@/lib/constants";
import { builtinAvatarId, builtinAvatarSrc } from "@/lib/avatars";
import type { Assignee, IssueWithLabels } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";
import type { TaskGroup } from "@/lib/view-grouping";
import { VIEW_PROPERTIES, type ViewProperty } from "@/lib/task-view";

const ALL_PROPERTIES: ViewProperty[] = [...VIEW_PROPERTIES];

function initials(displayName: string) {
  const words = displayName
    .replace(/[^A-Za-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 0) return words.map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return displayName.trim().slice(0, 2).toUpperCase();
}

export function AssigneeAvatar({
  displayName,
  avatar,
  size = 18,
  href,
}: {
  displayName: string;
  avatar?: string | null;
  size?: number;
  href?: string;
}) {
  const builtin = builtinAvatarId(avatar);
  let face;
  if (builtin) {
    face = (
      <span
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4f0e8] ring-1 ring-black/[0.06]"
        style={{ width: size, height: size }}
        title={displayName}
      >
        <img
          src={builtinAvatarSrc(builtin)}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </span>
    );
  } else if (avatar) {
    face = (
      <img
        src={avatar}
        alt=""
        title={displayName}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  } else {
    face = (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-elevated font-semibold text-muted"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title={displayName}
      >
        {initials(displayName)}
      </span>
    );
  }
  if (!href) return face;
  return (
    <Link
      href={href}
      title={displayName}
      onClick={(event) => event.stopPropagation()}
      className="shrink-0 rounded-full transition-opacity hover:opacity-80"
    >
      {face}
    </Link>
  );
}

// Same destination as clicking a name under "Your team" in the sidebar.
export function useAssigneeHref() {
  const params = useParams<{ workspaceId?: string }>();
  const workspaceId = params?.workspaceId;
  return (userId: string) =>
    workspaceId ? `/${workspaceId}/people/${userId}` : undefined;
}

// Overlapping avatars for issues with more than one assignee.
export function AssigneeStack({
  assignees,
  size = 18,
  max = 3,
  hrefFor,
}: {
  assignees: Assignee[];
  size?: number;
  max?: number;
  hrefFor?: (userId: string) => string | undefined;
}) {
  if (assignees.length === 0) return null;
  const shown = assignees.slice(0, max);
  const hidden = assignees.length - shown.length;
  return (
    <span
      className="flex shrink-0 items-center"
      title={assignees.map((assignee) => assignee.displayName).join(", ")}
    >
      {shown.map((assignee, index) => (
        <span
          key={assignee.id}
          className="rounded-full ring-2 ring-bg"
          style={{
            position: "relative",
            marginLeft: index === 0 ? 0 : -Math.round(size * 0.32),
            zIndex: shown.length - index,
          }}
        >
          <AssigneeAvatar
            displayName={assignee.displayName}
            avatar={assignee.avatar}
            size={size}
            href={hrefFor?.(assignee.id)}
          />
        </span>
      ))}
      {hidden > 0 && <span className="ml-1 text-caption text-faint">+{hidden}</span>}
    </span>
  );
}

function SelectionBox({
  title,
  checked,
  onToggle,
}: {
  title: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <input
      type="checkbox"
      aria-label={t("Select task {title}", { title })}
      checked={checked}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="h-3.5 w-3.5 shrink-0 accent-accent"
    />
  );
}

export function IssueTable({
  issues,
  groups: grouped,
  properties = ALL_PROPERTIES,
  selection,
}: {
  issues: IssueWithLabels[];
  // A pre-computed grouping from the display menu. Falls back to status for the
  // pages that do not offer display options.
  groups?: TaskGroup<IssueWithLabels>[];
  properties?: ViewProperty[];
  selection?: TaskSelection;
}) {
  const t = useT();
  const locale = useLocale();
  const { openIssue, openIssueId, setFocused, pins } = useUI();
  const assigneeHref = useAssigneeHref();
  const pinnedIds=useMemo(()=>new Set(pins.filter(pin=>pin.kind==="task").map(pin=>pin.id)),[pins]);
  const show = (property: ViewProperty) => properties.includes(property);
  const groups = useMemo(() => {
    const source =
      grouped ??
      STATUS_ORDER.map((status) => ({
        key: `status:${status}`,
        label: STATUS_META[status].label,
        property: "status" as const,
        value: status,
        tasks: [] as IssueWithLabels[],
      }));
    const explicit = grouped !== undefined;
    return [
      ...(pinnedIds.size > 0
        ? [
            {
              key: "pinned",
              label: "Pinned",
              property: "status" as const,
              value: null,
              tasks: issues.filter((issue) => pinnedIds.has(issue.id)),
            },
          ]
        : []),
      ...source
        .map((group) => ({
          ...group,
          tasks: group.tasks.filter((issue) => !pinnedIds.has(issue.id)),
        }))
        .filter((group) => explicit || group.tasks.length > 0 || group.key === "pinned"),
    ];
  }, [grouped, issues, pinnedIds]);

  const entries=useMemo(()=>groups.flatMap(group=>[{header:group},...group.tasks.map(issue=>({issue}))] as ({header:TaskGroup<IssueWithLabels>}|{issue:IssueWithLabels})[]),[groups]);
  const stickyIndexes=useMemo(()=>entries.flatMap((entry,index)=>"header" in entry?[index]:[]),[entries]);
  const entryIndex=useMemo(()=>new Map(entries.flatMap((entry,index)=>"issue" in entry?[[entry.issue.id,index] as const]:[])),[entries]);
  const windowHandle=useRef<VirtualStackHandle>(null),keyboardFocus=useRef(false);
  const visibleIssues = useMemo(() => groups.flatMap((group) => group.tasks), [groups]);
  const indexes=useMemo(()=>new Map(visibleIssues.map((issue,index)=>[issue.id,index])),[visibleIssues]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const foundIndex = indexes.get(focusId??"")??-1;
  const focusIndex = foundIndex < 0 ? null : foundIndex;
  const setFocusIndex = (next: number | null | ((previous:number|null)=>number)) => setFocusId((current)=>{
    const found = indexes.get(current??"")??-1;
    const index = typeof next === "function" ? next(found < 0 ? null : found) : next;
    return index === null ? null : visibleIssues[index]?.id ?? null;
  });
  const scroller=useRef<HTMLDivElement>(null);const path=usePathname();useScrollMemory(scroller,`task-list.${path}`);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex == null) {
      setFocused(null);
      return;
    }
    const issue = visibleIssues[focusIndex];
    setFocused(
      issue
        ? {
            id: issue.id,
            identifier: issue.identifier,
            ref: issueRef(issue),
            title: issue.title,
            status: issue.status,
          }
        : null
    );
  }, [focusIndex, visibleIssues, setFocused]);


  useEffect(() => {
    if(focusId){const index=entryIndex.get(focusId);if(index!==undefined)windowHandle.current?.scrollToIndex(index);}
    if(keyboardFocus.current){const frame=requestAnimationFrame(()=>{rowRefs.current[focusIndex??-1]?.focus({preventScroll:true});keyboardFocus.current=false;});return()=>cancelAnimationFrame(frame);}
  }, [focusIndex,focusId,entryIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(document.activeElement as HTMLElement|null)?.closest("[data-task-row]") || !!(e.target as HTMLElement|null)?.closest("button,a,input,textarea,select") || document.querySelector('[role="dialog"], [role="menu"][data-state="open"]') || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        keyboardFocus.current=true;
        setFocusIndex((i) => Math.min((i ?? -1) + 1, visibleIssues.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        keyboardFocus.current=true;
        setFocusIndex((i) => Math.max((i ?? 1) - 1, 0));
      } else if (e.key === "Enter") {
        const issue = focusIndex != null ? visibleIssues[focusIndex] : undefined;
        if (issue) {
          e.preventDefault();
          openIssue(issue.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleIssues, focusIndex, openIssue]);



  return (
    <VirtualStack scrollRef={scroller} handle={windowHandle} className="@container min-h-0 flex-1 overflow-y-auto" items={entries} keepIndex={focusId?entryIndex.get(focusId):undefined} estimate={38} stickyIndexes={stickyIndexes} keyFor={entry=>"header" in entry?`group:${entry.header.key}`:entry.issue.id} render={entry=>{
      if("header" in entry){const group=entry.header;const status=group.property==="status"&&group.value&&group.key!=="pinned"?group.value as keyof typeof STATUS_META:null;return (<div className={`sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 py-1.5 backdrop-blur ${PAGE_INSET}`}>
            {status?<StatusIcon status={status} size={13}/>:null}
            <span className="text-small font-medium text-muted">
              {t(group.label)}
            </span>
            <span className="text-small text-faint">{group.tasks.length}</span>
            {status?<AddIssueButton status={status}/>:null}
          </div>);}
      const issue=entry.issue;
            const index = indexes.get(issue.id) ?? -1;
            const focused = focusIndex === index;
            const opened = openIssueId === issue.id;
            const checked = selection?.selected.has(issue.id) ?? false;
            return (
              <div key={issue.id} className="max-[600px]:border-b max-[600px]:border-border">
              <EntityRow kind="task" id={issue.id} title={issue.title}>
              <div
                key={issue.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                data-task-row
                data-selected={checked || undefined}
                role="button"
                tabIndex={focused || focusIndex === null && index === 0 ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => {
                  setFocusIndex(index);
                  if (selection?.mode) selection.toggle(issue.id);
                  else openIssue(issue.id);
                }}
                onMouseEnter={() => setFocusIndex(index)}
                className={`flex cursor-default items-center gap-2.5 py-[7px] text-body transition-colors ${PAGE_INSET} max-[600px]:min-h-11 max-[600px]:py-2.5 max-[600px]:pl-4 max-[600px]:pr-4 ${
                  focused ? "bg-row-active" : opened ? "bg-surface" : "hover:bg-elevated/40"
                } ${opened ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}
              >
                {selection?.mode ? (
                  <SelectionBox
                    title={issue.title}
                    checked={checked}
                    onToggle={() => selection.toggle(issue.id)}
                  />
                ) : null}
                {show("status") ? <StatusIcon status={issue.status} size={14} /> : null}
                {show("id") ? (
                  <span
                    title={issueRef(issue)}
                    className="w-[124px] shrink-0 truncate font-mono text-small text-faint max-[600px]:hidden"
                  >
                    {issueRef(issue)}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{issue.title}</span>
                  <span suppressHydrationWarning className="hidden truncate text-small text-faint max-[600px]:block">
                    {[show("id") ? issueRef(issue) : null, show("status") ? t(STATUS_META[issue.status].label) : null, show("dates") ? timeAgo(issue.updatedAt, locale) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {issue.delegatedAgentId ? (
                  <span
                    title={issue.delegatedAgentName ? t("Delegated to {name}", { name: issue.delegatedAgentName }) : t("Delegated to an agent")}
                    data-testid="task-delegated"
                    className="flex shrink-0 items-center gap-0.5 rounded-full bg-elevated px-1.5 py-0.5 text-caption text-muted"
                  >
                    <Bot size={11} />
                    {issue.delegationStatus === "review" ? t("Review") : null}
                  </span>
                ) : null}
                {show("assignee") && issue.assignees[0] ? (
                  <span className="hidden shrink-0 max-[600px]:block">
                    <AssigneeAvatar displayName={issue.assignees[0].displayName} avatar={issue.assignees[0].avatar} />
                  </span>
                ) : null}
                {show("project") ? (
                  <span className="hidden w-[110px] shrink-0 truncate text-small text-muted @xl:block">
                    {issue.projectName}
                  </span>
                ) : null}
                {show("priority") ? (
                  <span className="hidden w-[96px] shrink-0 items-center gap-1.5 text-small @xl:flex">
                    <PriorityIcon priority={issue.priority} size={14} />
                    <span className={issue.priority === 0 ? "truncate text-faint" : "truncate text-muted"}>
                      {t(PRIORITY_NAMES[issue.priority])}
                    </span>
                  </span>
                ) : null}
                {show("assignee") ? (
                  <span className="hidden w-[146px] shrink-0 items-center gap-1.5 @4xl:flex">
                    {issue.assignees.length === 1 ? (
                      (() => {
                        const assignee = issue.assignees[0];
                        const href = assigneeHref(assignee.id);
                        const face = (
                          <>
                            <AssigneeAvatar
                              displayName={assignee.displayName}
                              avatar={assignee.avatar}
                            />
                            <span className="min-w-0 truncate text-small text-muted">
                              {assignee.displayName}
                            </span>
                          </>
                        );
                        return href ? (
                          <Link
                            href={href}
                            onClick={(event) => event.stopPropagation()}
                            className="flex min-w-0 items-center gap-1.5 rounded transition-colors hover:text-text"
                          >
                            {face}
                          </Link>
                        ) : (
                          <span className="flex min-w-0 items-center gap-1.5">{face}</span>
                        );
                      })()
                    ) : issue.assignees.length > 1 ? (
                      <span
                        title={issue.assignees.map((assignee) => assignee.displayName).join(", ")}
                        className="flex min-w-0 items-center gap-1.5"
                      >
                        <AssigneeStack assignees={issue.assignees} max={2} hrefFor={assigneeHref} />
                        <span className="min-w-0 truncate text-small text-muted">
                          {issue.assignees.map((assignee) => assignee.displayName).join(", ")}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {show("dueDate") ? (
                  <span className="hidden w-[86px] shrink-0 truncate text-small text-muted @2xl:block">
                    {issue.dueDate ?? ""}
                  </span>
                ) : null}
                {show("labels") ? (
                  <span className="hidden w-[112px] shrink-0 items-center justify-end gap-1 @4xl:flex">
                    {issue.labels.slice(0, 2).map((label) => (
                      <LabelPill key={label.id} name={label.name} color={label.color} small />
                    ))}
                    {issue.labels.length > 2 && (
                      <span className="text-caption text-faint">+{issue.labels.length - 2}</span>
                    )}
                  </span>
                ) : null}
                <span className="flex w-[72px] shrink-0 items-center justify-end gap-1 max-[600px]:hidden">
                  <ViaBadge via={issue.createdVia} />
                  {show("dates") ? (
                    <span suppressHydrationWarning className="whitespace-nowrap text-right text-small text-faint">
                      {timeAgo(issue.updatedAt, locale)}
                    </span>
                  ) : null}
                </span>
              </div>
              </EntityRow>
              </div>
            );
    }}/>
  );
}
