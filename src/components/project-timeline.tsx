"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { Modal } from "@/components/ui/modal";
import { useT, useLocale } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import { useDetailSource } from "@/components/detail-navigation";
import { issueRef } from "@/lib/format";
import { PAGE_INSET } from "@/lib/page-chrome";
import { STATUS_META } from "@/lib/constants";
import type { IssueWithLabels } from "@/lib/issues";
import type { Milestone } from "@/lib/planning/milestones";
import {
  addDays,
  addMonths,
  daysBetween,
  formatDay,
  monthKey,
  monthLabel,
  monthStart,
  todayDay,
} from "@/lib/planning/dates";
import {
  FieldLabel,
  Pill,
  ProgressBar,
  inputClass,
  primaryButton,
  quietButton,
} from "@/components/planning-ui";
import {
  createMilestoneAction,
  deleteMilestoneAction,
  moveMilestoneAction,
  setIssueMilestoneAction,
  updateMilestoneAction,
} from "@/app/planning-actions";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  targetDate: string;
};

/**
 * U-03 project Timeline: milestone stages in plan order, their progress, a simple
 * date track, and the project's tasks grouped by milestone. Moving a task between
 * milestones writes through the task business layer, so the task timeline records it.
 */
export function ProjectTimeline({
  workspaceId,
  projectId,
  project,
  milestones,
  issues,
}: {
  workspaceId: string;
  projectId: string;
  project: { name: string; color: string; icon: string | null };
  milestones: Milestone[];
  issues: IssueWithLabels[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue, confirm } = useUI();
  useDetailSource("task", issues.map((issue) => issue.id));
  const [filter, setFilter] = useState<string>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);

  const dated = useMemo(
    () =>
      milestones
        .filter((milestone) => milestone.targetDate)
        .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? "")),
    [milestones]
  );
  const groups = useMemo(() => {
    const rows: Array<{ id: string | null; name: string; milestone: Milestone | null; tasks: IssueWithLabels[] }> = [];
    if (filter === "all" || filter === "none") {
      if (filter === "none") {
        rows.push({ id: null, name: t("No milestone"), milestone: null, tasks: [] });
      }
    }
    for (const milestone of milestones) {
      if (filter !== "all" && filter !== milestone.id) continue;
      rows.push({
        id: milestone.id,
        name: milestone.name,
        milestone,
        tasks: issues.filter((issue) => issue.milestoneId === milestone.id),
      });
    }
    if (filter === "all") {
      rows.push({
        id: null,
        name: t("No milestone"),
        milestone: null,
        tasks: issues.filter((issue) => !issue.milestoneId),
      });
    } else if (filter === "none") {
      const row = rows.find((entry) => entry.id === null);
      if (row) row.tasks = issues.filter((issue) => !issue.milestoneId);
    }
    // An empty "No milestone" group is noise; keep it only when it holds tasks or the
    // filter asked for it explicitly.
    return rows.filter((row) => row.id !== null || row.tasks.length > 0 || filter === "none");
  }, [filter, issues, milestones, t]);

  const currentMilestone = milestones.find((milestone) => milestone.current) ?? null;

  function openCreate() {
    setDraft({ id: null, name: "", description: "", targetDate: "" });
    setError(null);
  }

  function openEdit(milestone: Milestone) {
    setDraft({
      id: milestone.id,
      name: milestone.name,
      description: milestone.description,
      targetDate: milestone.targetDate ?? "",
    });
    setError(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError(t("Name is required"));
      return;
    }
    setSaving(true);
    const input = {
      name: draft.name,
      description: draft.description,
      targetDate: draft.targetDate || null,
    };
    const result = draft.id
      ? await updateMilestoneAction(workspaceId, projectId, draft.id, input)
      : await createMilestoneAction(workspaceId, projectId, input);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    const ok = await confirm(t("Delete this milestone?"), { body: t("Its tasks stay in the project and lose the milestone."), action: t("Delete") });
    if (!ok) return;
    setSaving(true);
    const result = await deleteMilestoneAction(workspaceId, projectId, draft.id);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    router.refresh();
  }

  async function move(milestone: Milestone, direction: "up" | "down") {
    setMovingId(milestone.id);
    const result = await moveMilestoneAction(workspaceId, projectId, milestone.id, direction);
    setMovingId(null);
    if (result.ok) router.refresh();
  }

  async function setMilestone(issue: IssueWithLabels, milestoneId: string) {
    setUpdatingTask(issue.id);
    const result = await setIssueMilestoneAction(
      workspaceId,
      issue.id,
      milestoneId || null
    );
    setUpdatingTask(null);
    if (result.ok) router.refresh();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="project-timeline">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`space-y-4 py-4 ${PAGE_INSET}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-body font-medium text-muted">
              <CalendarDays size={14} />
              {t("Milestones")}
            </span>
            <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-muted tabular-nums">
              {milestones.length}
            </span>
            {currentMilestone && (
              <span className="text-small text-faint" data-testid="milestone-current">
                {t("Current: {name}", { name: currentMilestone.name })}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label={t("Filter tasks by milestone")}
                data-testid="milestone-filter"
                className="rounded-md border border-border bg-bg px-2 py-1.5 text-body"
              >
                <option value="all">{t("All milestones")}</option>
                {milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
                <option value="none">{t("No milestone")}</option>
              </select>
              <button type="button" onClick={openCreate} className={`${primaryButton} flex items-center gap-1`} data-testid="milestone-new">
                <Plus size={13} /> {t("New milestone")}
              </button>
            </div>
          </div>

          {milestones.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center" data-testid="milestone-empty">
              <p className="text-body text-faint">
                {t("No milestones yet. Add a stage with an optional target date, then attach tasks.")}
              </p>
              <button type="button" onClick={openCreate} className={`${primaryButton} mt-3`}>
                {t("New milestone")}
              </button>
            </div>
          ) : (
            <>
              {dated.length > 0 && <MilestoneTrack milestones={dated} locale={locale} />}
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {milestones.map((milestone, index) => (
                  <article
                    key={milestone.id}
                    data-testid="milestone-card"
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="mt-0.5 text-caption text-faint tabular-nums">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <h3 className="min-w-0 truncate text-body font-semibold">{milestone.name}</h3>
                          {milestone.current && (
                            <Pill color="#f2c94c" dataTestId="milestone-current-badge">
                              {t("Current")}
                            </Pill>
                          )}
                          {milestone.targetDate && (
                            <span className="text-caption text-faint">
                              {formatDay(milestone.targetDate, locale)}
                            </span>
                          )}
                        </div>
                        {milestone.description && (
                          <p className="mt-0.5 line-clamp-2 text-small leading-relaxed text-muted">
                            {milestone.description}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <ProgressBar percent={milestone.progress.percent} className="max-w-[180px] flex-1" />
                          <span className="text-caption text-faint tabular-nums" data-testid="milestone-progress">
                            {t("{done}/{total} done", {
                              done: milestone.progress.done,
                              total: milestone.progress.total,
                            })}{" "}
                            · {milestone.progress.percent}%
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={t("Move {name} up", { name: milestone.name })}
                          title={t("Move up")}
                          disabled={index === 0 || movingId === milestone.id}
                          onClick={() => move(milestone, "up")}
                          className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text disabled:opacity-30"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("Move {name} down", { name: milestone.name })}
                          title={t("Move down")}
                          disabled={index === milestones.length - 1 || movingId === milestone.id}
                          onClick={() => move(milestone, "down")}
                          className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text disabled:opacity-30"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("Edit {name}", { name: milestone.name })}
                          title={t("Edit")}
                          onClick={() => openEdit(milestone)}
                          className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          <section className="rounded-lg border border-border" data-testid="milestone-tasks">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <ProjectIcon color={project.color} icon={project.icon} size={13} />
              <h3 className="text-body font-semibold">{t("Tasks by milestone")}</h3>
              <span className="text-caption text-faint tabular-nums">{issues.length}</span>
            </div>
            {groups.length === 0 ? (
              <p className="px-3 py-4 text-small text-faint">{t("No tasks in this project yet.")}</p>
            ) : (
              groups.map((group) => (
                <div key={group.id ?? "none"}>
                  <div className="flex items-center gap-2 border-y border-border bg-surface px-3 py-1.5 first:border-t-0">
                    <span className="text-small font-medium">
                      {group.milestone?.name ?? t("No milestone")}
                    </span>
                    {group.milestone && (
                      <span className="text-caption text-faint tabular-nums">
                        {t("{done}/{total} done", {
                          done: group.milestone.progress.done,
                          total: group.milestone.progress.total,
                        })}
                      </span>
                    )}
                    <span className="ml-auto text-caption text-faint tabular-nums">
                      {group.tasks.length}
                    </span>
                  </div>
                  {group.tasks.length === 0 ? (
                    <p className="px-3 py-2 text-caption text-faint">{t("No tasks here yet.")}</p>
                  ) : (
                    group.tasks.map((task) => (
                      <div
                        key={task.id}
                        data-testid="milestone-task-row"
                        className="flex items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-elevated/40"
                      >
                        <button
                          type="button"
                          onClick={() => openIssue(task.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          <span className="mt-[2px] shrink-0">
                            <StatusIcon status={task.status} size={14} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="shrink-0 text-small text-faint">{issueRef(task)}</span>
                              <span className="truncate text-body">{task.title}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-faint">
                              <span>{t(STATUS_META[task.status].label)}</span>
                              {task.assignees.length > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  {task.assignees.map((assignee) => (
                                    <AssigneeAvatar
                                      key={assignee.id}
                                      displayName={assignee.displayName}
                                      avatar={assignee.avatar}
                                      size={14}
                                    />
                                  ))}
                                  <span className="truncate">
                                    {task.assignees.map((assignee) => assignee.displayName).join(", ")}
                                  </span>
                                </span>
                              )}
                              {task.estimate !== null && (
                                <span className="tabular-nums">
                                  {t("{points} pts", { points: task.estimate })}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                        <select
                          value={task.milestoneId ?? ""}
                          onChange={(event) => setMilestone(task, event.target.value)}
                          disabled={milestones.length === 0 || updatingTask === task.id}
                          aria-label={t("Milestone for {task}", { task: issueRef(task) })}
                          data-testid="milestone-select"
                          className="mt-0.5 max-w-[150px] shrink-0 rounded border border-border bg-bg px-1 py-0.5 text-caption text-muted disabled:opacity-50"
                        >
                          <option value="">{t("No milestone")}</option>
                          {milestones.map((milestone) => (
                            <option key={milestone.id} value={milestone.id}>
                              {milestone.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      <Modal
        open={draft !== null}
        onClose={() => {
          if (!saving) setDraft(null);
        }}
        title={draft?.id ? t("Edit milestone") : t("New milestone")}
        className="max-w-[520px]"
      >
        {draft && (
          <div className="space-y-3" data-testid="milestone-editor">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lead font-semibold">
                {draft.id ? t("Edit milestone") : t("New milestone")}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label={t("Close")}
                className="text-faint hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
            {error && <div className="rounded border border-danger/40 p-2 text-small text-danger">{error}</div>}
            <label className="block space-y-1">
              <FieldLabel>{t("Name")}</FieldLabel>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={inputClass}
                autoFocus
                data-testid="milestone-name"
              />
            </label>
            <label className="block space-y-1">
              <FieldLabel>{t("Description")}</FieldLabel>
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={3}
                className={inputClass}
              />
            </label>
            <label className="block space-y-1">
              <FieldLabel>{t("Target date")}</FieldLabel>
              <input
                type="date"
                value={draft.targetDate}
                onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
                className={inputClass}
                data-testid="milestone-target"
              />
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              {draft.id && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={saving}
                  className="mr-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-small text-faint transition-colors hover:bg-elevated hover:text-danger"
                  data-testid="milestone-delete"
                >
                  <Trash2 size={12} /> {t("Delete")}
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)} className={quietButton} disabled={saving}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className={primaryButton}
                data-testid="milestone-save"
              >
                {saving ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MilestoneTrack({
  milestones,
  locale,
}: {
  milestones: Milestone[];
  locale: "en" | "zh";
}) {
  const t = useT();
  const today = todayDay();
  const dates = milestones.map((milestone) => milestone.targetDate!).sort();
  const start = addDays(dates[0] < today ? dates[0] : today, -7);
  const end = addDays(dates[dates.length - 1] > today ? dates[dates.length - 1] : today, 7);
  const totalDays = Math.max(1, daysBetween(start, end));
  const left = (day: string) =>
    Math.max(0, Math.min(100, (daysBetween(start, day) / totalDays) * 100));
  const months: string[] = [];
  for (let month = monthKey(start); monthStart(month) <= end; month = addMonths(month, 1)) {
    months.push(month);
    if (months.length > 36) break;
  }
  const todayVisible = today >= start && today <= end;
  // In a short range the first two month labels sit only a few percent apart and
  // overlap; keep the first label and skip any month whose label would collide.
  const monthMarkers: { month: string; position: number }[] = [];
  let lastLabelPosition = -Infinity;
  for (const month of months) {
    const position = left(monthStart(month) > start ? monthStart(month) : start);
    if (monthMarkers.length > 0 && position - lastLabelPosition < 6) continue;
    monthMarkers.push({ month, position });
    lastLabelPosition = position;
  }
  return (
    <div className="rounded-lg border border-border p-3" data-testid="milestone-timeline">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold">{t("Schedule")}</h3>
        <span className="text-caption text-faint">{t("Target dates, not drag scheduling")}</span>
      </div>
      <div className="mt-2 flex">
        <div className="w-36 shrink-0" />
        <div className="relative h-5 flex-1 overflow-hidden border-b border-border text-caption text-faint">
          {monthMarkers.map(({ month, position }) => (
            <span
              key={month}
              className="absolute top-0 whitespace-nowrap"
              style={{ left: `${position}%` }}
            >
              {monthLabel(month, locale)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 flex">
        <div className="w-36 shrink-0">
          {milestones.map((milestone) => (
            <div key={milestone.id} className="flex h-6 items-center gap-1 truncate pr-2 text-small text-muted">
              <span className="truncate">{milestone.name}</span>
              {milestone.targetDate && (
                <span className="shrink-0 text-caption text-faint">
                  {formatDay(milestone.targetDate, locale)}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="relative flex-1">
          {todayVisible && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-l border-dashed border-accent/60"
              style={{ left: `${left(today)}%` }}
              aria-hidden
            />
          )}
          {milestones.map((milestone) => (
            <div key={milestone.id} className="relative h-6">
              <div className="absolute inset-x-0 top-1/2 border-t border-border" />
              {milestone.targetDate && (
                <span
                  title={formatDay(milestone.targetDate, locale)}
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
                  style={{ left: `${left(milestone.targetDate)}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

