"use client";

import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUI, isTyping } from "@/components/ui-context";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge, STATUS_META } from "@/components/icons";
import { STATUS_ORDER, PRIORITY_NAMES } from "@/lib/constants";
import { builtinAvatarId, builtinAvatarSrc } from "@/lib/avatars";
import type { Assignee, IssueWithLabels } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

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

export function IssueTable({ issues }: { issues: IssueWithLabels[] }) {
  const t = useT();
  const locale = useLocale();
  const { openIssue, openIssueId, setFocused, pins } = useUI();
  const assigneeHref = useAssigneeHref();
  const pinnedIds=useMemo(()=>new Set(pins.filter(pin=>pin.kind==="task").map(pin=>pin.id)),[pins]);
  const groups = useMemo(
    () =>
      [{status:"pinned" as const,items:issues.filter(issue=>pinnedIds.has(issue.id))},...STATUS_ORDER.map((status) => ({
        status,
        items: issues.filter((issue) => issue.status === status&&!pinnedIds.has(issue.id)),
      }))].filter((group) => group.items.length > 0),
    [issues,pinnedIds]
  );

  const visibleIssues = useMemo(() => groups.flatMap((group) => group.items), [groups]);
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
    rowRefs.current[focusIndex ?? -1]?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !rowRefs.current.some((row) => row?.contains(document.activeElement)) || document.querySelector('[role="dialog"], [role="menu"][data-state="open"]') || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIndex((i) => Math.min((i ?? -1) + 1, visibleIssues.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
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
    <div ref={scroller} className="@container flex-1 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.status}>
          <div className={`sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 py-1.5 backdrop-blur ${PAGE_INSET}`}>
            {group.status!=="pinned"&&<StatusIcon status={group.status} size={13} />}
            <span className="text-small font-medium text-muted">
              {group.status==="pinned"?t("Pinned"):t(STATUS_META[group.status].label)}
            </span>
            <span className="text-small text-faint">{group.items.length}</span>
            {group.status!=="pinned"&&<AddIssueButton status={group.status} />}
          </div>
          {group.items.map((issue) => {
            const index = indexes.get(issue.id) ?? -1;
            const focused = focusIndex === index;
            const opened = openIssueId === issue.id;
            return (
              <EntityRow key={issue.id} kind="task" id={issue.id} title={issue.title}>
              <div
                key={issue.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                role="button"
                tabIndex={focused || focusIndex === null && index === 0 ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => {
                  setFocusIndex(index);
                  openIssue(issue.id);
                }}
                onMouseEnter={() => setFocusIndex(index)}
                className={`flex cursor-default items-center gap-2.5 py-[7px] text-body transition-colors ${PAGE_INSET} ${
                  focused ? "bg-row-active" : opened ? "bg-surface" : "hover:bg-elevated/40"
                } ${opened ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}
              >
                <StatusIcon status={issue.status} size={14} />
                <span
                  title={issueRef(issue)}
                  className="w-[124px] shrink-0 truncate font-mono text-small text-faint"
                >
                  {issueRef(issue)}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                <span className="hidden w-[96px] shrink-0 items-center gap-1.5 text-small @xl:flex">
                  <PriorityIcon priority={issue.priority} size={14} />
                  <span className={issue.priority === 0 ? "truncate text-faint" : "truncate text-muted"}>
                    {t(PRIORITY_NAMES[issue.priority])}
                  </span>
                </span>
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
                    // Names, not a count: the row already shows who is on the task at
                    // a glance, without opening the panel to find out.
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
                <span className="hidden w-[112px] shrink-0 items-center justify-end gap-1 @4xl:flex">
                  {issue.labels.slice(0, 2).map((label) => (
                    <LabelPill key={label.id} name={label.name} color={label.color} small />
                  ))}
                  {issue.labels.length > 2 && (
                    <span className="text-caption text-faint">+{issue.labels.length - 2}</span>
                  )}
                </span>
                <span className="flex w-[72px] shrink-0 items-center justify-end gap-1">
                  <ViaBadge via={issue.createdVia} />
                  <span suppressHydrationWarning className="whitespace-nowrap text-right text-small text-faint">
                    {timeAgo(issue.updatedAt, locale)}
                  </span>
                </span>
              </div>
              </EntityRow>
            );
          })}
        </div>
      ))}
    </div>
  );
}
