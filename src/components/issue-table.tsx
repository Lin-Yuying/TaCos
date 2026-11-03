"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUI, isTyping } from "@/components/ui-context";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge, STATUS_META } from "@/components/icons";
import { STATUS_ORDER, PRIORITY_NAMES } from "@/lib/constants";
import { builtinAvatarId, builtinAvatarSrc } from "@/lib/avatars";
import type { Assignee, IssueWithLabels } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";

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
      {hidden > 0 && <span className="ml-1 text-[11px] text-faint">+{hidden}</span>}
    </span>
  );
}

export function IssueTable({ issues }: { issues: IssueWithLabels[] }) {
  const t = useT();
  const locale = useLocale();
  const { openIssue, openIssueId, setFocused } = useUI();
  const assigneeHref = useAssigneeHref();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex == null) {
      setFocused(null);
      return;
    }
    const issue = issues[focusIndex];
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
  }, [focusIndex, issues, setFocused]);

  useEffect(() => {
    if (focusIndex != null && focusIndex >= issues.length) {
      setFocusIndex(issues.length > 0 ? issues.length - 1 : null);
    }
  }, [issues, focusIndex]);

  useEffect(() => {
    rowRefs.current[focusIndex ?? -1]?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIndex((i) => Math.min((i ?? -1) + 1, issues.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => Math.max((i ?? 1) - 1, 0));
      } else if (e.key === "Enter") {
        const issue = focusIndex != null ? issues[focusIndex] : undefined;
        if (issue) {
          e.preventDefault();
          openIssue(issue.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issues, focusIndex, openIssue]);

  const groups = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        items: issues.filter((issue) => issue.status === status),
      })).filter((group) => group.items.length > 0),
    [issues]
  );

  let flatIndex = -1;

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.status}>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg/95 px-10 py-1.5 backdrop-blur lg:px-20 xl:px-32">
            <StatusIcon status={group.status} size={13} />
            <span className="text-[12px] font-medium text-muted">
              {t(STATUS_META[group.status].label)}
            </span>
            <span className="text-[12px] text-faint">{group.items.length}</span>
            <AddIssueButton status={group.status} />
          </div>
          {group.items.map((issue) => {
            flatIndex += 1;
            const index = flatIndex;
            const focused = focusIndex === index;
            const opened = openIssueId === issue.id;
            return (
              <div
                key={issue.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                role="button"
                tabIndex={-1}
                onClick={() => {
                  setFocusIndex(index);
                  openIssue(issue.id);
                }}
                onMouseEnter={() => setFocusIndex(index)}
                className={`flex cursor-default items-center gap-2.5 px-10 py-[7px] text-[13px] transition-colors lg:px-20 xl:px-32 ${
                  focused ? "bg-row-active" : opened ? "bg-surface" : "hover:bg-elevated/40"
                } ${opened ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"}`}
              >
                <StatusIcon status={issue.status} size={14} />
                <span
                  title={issueRef(issue)}
                  className="w-[124px] shrink-0 truncate font-mono text-[12px] text-faint"
                >
                  {issueRef(issue)}
                </span>
                <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                <span className="flex w-[96px] shrink-0 items-center gap-1.5 text-[12px]">
                  <PriorityIcon priority={issue.priority} size={14} />
                  <span className={issue.priority === 0 ? "truncate text-faint" : "truncate text-muted"}>
                    {t(PRIORITY_NAMES[issue.priority])}
                  </span>
                </span>
                <span className="flex w-[146px] shrink-0 items-center gap-1.5">
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
                          <span className="min-w-0 truncate text-[12px] text-muted">
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
                      <span className="min-w-0 truncate text-[12px] text-muted">
                        {issue.assignees.map((assignee) => assignee.displayName).join(", ")}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className="flex w-[112px] shrink-0 items-center justify-end gap-1">
                  {issue.labels.slice(0, 2).map((label) => (
                    <LabelPill key={label.id} name={label.name} color={label.color} small />
                  ))}
                  {issue.labels.length > 2 && (
                    <span className="text-[11px] text-faint">+{issue.labels.length - 2}</span>
                  )}
                </span>
                <span className="flex w-[44px] shrink-0 items-center justify-end gap-1">
                  <ViaBadge via={issue.createdVia} />
                  <span suppressHydrationWarning className="w-8 text-right text-[12px] text-faint">
                    {timeAgo(issue.updatedAt, locale)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
