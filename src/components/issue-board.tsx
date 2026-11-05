"use client";

import { Fragment, useMemo, useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { moveIssueAction } from "@/app/actions";
import { AddIssueButton } from "@/components/add-issue-button";
import { LabelPill, PriorityIcon, StatusIcon, ViaBadge } from "@/components/icons";
import { AssigneeStack, useAssigneeHref } from "@/components/issue-table";
import { useUI } from "@/components/ui-context";
import { STATUS_META, STATUS_ORDER, type Status } from "@/lib/constants";
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
    <article
      data-issue-id={issue.id}
      role="button"
      tabIndex={-1}
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
}: {
  issues: IssueWithLabels[];
  workspaceId: string;
  currentUserId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [drag, setDrag] = useState<IssueWithLabels | null>(null);
  const [over, setOver] = useState<{ status: Status; index: number } | null>(null);

  const columns = useMemo(
    () =>
      STATUS_ORDER.map((status: Status) => ({
        status,
        items: issues.filter((issue) => issue.status === status),
      })),
    [issues],
  );

  // Cross-column drags change status, which is reserved to assignees; everyone else
  // can still drag cards up and down inside their current column.
  function canChangeStatus(issue: IssueWithLabels) {
    return issue.assignees.some((assignee) => assignee.id === currentUserId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, status: Status) {
    if (!drag) return;
    if (drag.status !== status && !canChangeStatus(drag)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    // Measure against the cards that would remain: the dragged card is left out so
    // the slot does not depend on where it currently sits.
    const cards = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("[data-issue-id]"),
    ].filter((card) => card.dataset.issueId !== drag.id);
    let index = cards.length;
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    setOver((prev) =>
      prev && prev.status === status && prev.index === index ? prev : { status, index }
    );
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>, status: Status) {
    event.preventDefault();
    const issue = drag;
    const target = over;
    setDrag(null);
    setOver(null);
    if (!issue || !target || target.status !== status) return;
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

    const result = await moveIssueAction(workspaceId, issue.id, { status, beforeId, afterId });
    if (result.ok) startTransition(() => router.refresh());
  }

  return (
    // min-h-0 keeps the board inside the card: without it the columns' content height
    // wins over the flex budget and the last cards get clipped by the card's overflow.
    <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-10 py-3 lg:px-20 xl:px-32">
      {columns.map(({ status, items }) => {
        let slot = 0;
        return (
          <section key={status} className="flex min-h-0 min-w-[100px] flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-1 pb-2">
              <StatusIcon status={status} size={13} />
              <span className="truncate text-small font-medium text-muted">
                {t(STATUS_META[status].label)}
              </span>
              <span className="text-small text-faint">{items.length}</span>
              <AddIssueButton status={status} />
            </header>
            <div
              onDragOver={(event) => handleDragOver(event, status)}
              onDrop={(event) => void handleDrop(event, status)}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3"
            >
              {items.map((issue) => {
                const isDragging = drag?.id === issue.id;
                const showLine =
                  over?.status === status && over.index === slot && !isDragging && !!drag;
                if (!isDragging) slot += 1;
                return (
                  <Fragment key={issue.id}>
                    {showLine && <DropLine />}
                    <BoardCard
                      issue={issue}
                      dragging={isDragging}
                      onDragStart={setDrag}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    />
                  </Fragment>
                );
              })}
              {over?.status === status && over.index === slot && !!drag && <DropLine />}
              {items.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-small text-faint">
                  {t("No {status} issues", { status: t(STATUS_META[status].label) })}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
