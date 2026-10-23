"use client";

import { useMemo } from "react";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge } from "@/components/icons";
import { AssigneeStack } from "@/components/issue-table";
import { useUI } from "@/components/ui-context";
import { STATUS_META, STATUS_ORDER, type Status } from "@/lib/constants";
import { issueRef } from "@/lib/format";
import type { IssueWithLabels } from "@/lib/issues";

function BoardCard({ issue }: { issue: IssueWithLabels }) {
  const { openIssue, openIssueId } = useUI();
  const opened = openIssueId === issue.id;

  return (
    <article
      role="button"
      tabIndex={-1}
      onClick={() => openIssue(issue.id)}
      className={`cursor-default rounded-lg border bg-surface px-3 py-2.5 transition-colors ${
        opened ? "border-accent" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-faint">
        <StatusIcon status={issue.status} size={12} />
        <span className="truncate font-mono">{issueRef(issue)}</span>
      </div>
      <h3 className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-text">
        {issue.title}
      </h3>
      <div className="mt-2 flex h-[18px] items-center gap-1.5 overflow-hidden">
        <PriorityIcon priority={issue.priority} size={13} />
        {issue.labels.slice(0, 2).map((label) => (
          <LabelPill key={label.id} name={label.name} color={label.color} small />
        ))}
        {issue.labels.length > 2 && (
          <span className="text-[11px] text-faint">+{issue.labels.length - 2}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <ViaBadge via={issue.createdVia} />
          <AssigneeStack assignees={issue.assignees} size={18} />
        </span>
      </div>
    </article>
  );
}

/**
 * Kanban grouping: one column per status, always all four so a card has somewhere to
 * go. Columns share the width down to 100px, which keeps all four visible at the
 * desktop shell's 720px minimum window. Dragging is not wired up — move a card by
 * opening it and changing the status.
 */
export function IssueBoard({ issues }: { issues: IssueWithLabels[] }) {
  const columns = useMemo(
    () =>
      STATUS_ORDER.map((status: Status) => ({
        status,
        items: issues.filter((issue) => issue.status === status),
      })),
    [issues],
  );

  return (
    <div className="flex flex-1 gap-3 overflow-x-auto px-4 py-3">
      {columns.map(({ status, items }) => (
        <section key={status} className="flex min-w-[100px] flex-1 flex-col">
          <header className="flex shrink-0 items-center gap-2 px-1 pb-2">
            <StatusIcon status={status} size={13} />
            <span className="truncate text-[12px] font-medium text-muted">
              {STATUS_META[status].label}
            </span>
            <span className="text-[12px] text-faint">{items.length}</span>
            <AddIssueButton status={status} />
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3">
            {items.map((issue) => (
              <BoardCard key={issue.id} issue={issue} />
            ))}
            {items.length === 0 && (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-faint">
                No {STATUS_META[status].label.toLowerCase()} issues
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
