"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { ChevronDown, Download, Plus, X } from "lucide-react";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu } from "@/components/menu";
import { Modal } from "@/components/ui/modal";
import { useT, useLocale } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import { useDetailSource } from "@/components/detail-navigation";
import { issueRef } from "@/lib/format";
import { BOX, BTN, CHIP, FILTER_BAR, ICON_BTN, LINE, LINE_SUB, NARROW_PAGE, PAGE_HEADER, PAGE_INSET, PAGE_TITLE, SEC, SEC_TITLE } from "@/lib/page-chrome";
import {
  CYCLE_START_DAYS,
  CYCLE_STATUSES,
  CYCLE_STATUS_META,
} from "@/lib/constants";
import type { Label, IssueWithLabels } from "@/lib/issues";
import type {
  CycleCapacity,
  CycleDetail,
  CycleSettings,
  CycleSummary,
} from "@/lib/planning/cycles";
import type { Initiative, RoadmapGroup } from "@/lib/planning/initiatives";
import { completeCycleAction, planIssuesAction, saveCycleSettingsAction } from "@/app/planning-actions";
import { eachDay, formatDay, formatDayRange } from "@/lib/planning/dates";
import { primaryButton, quietButton } from "@/components/planning-ui";
import { PlanningRoadmap } from "@/components/planning-roadmap";
import { PlanningInitiatives } from "@/components/planning-initiatives";

export type PlanningTab = "cycles" | "roadmap" | "initiatives";

const TABS: Array<{ key: PlanningTab; label: string }> = [
  { key: "cycles", label: "Cycles" },
  { key: "roadmap", label: "Roadmap" },
  { key: "initiatives", label: "Initiatives" },
];

type MemberOption = { id: string; displayName: string; avatar: string | null };
type ProjectOption = { id: string; name: string; key: string; color: string; icon: string | null };
type CandidateTask = IssueWithLabels;

export function PlanningView({
  workspaceId,
  tab,
  isAdmin,
  currentUserId,
  settings,
  cycles,
  selectedCycle,
  selectedCycleId,
  candidates,
  initiatives,
  roadmap,
  members,
  projects,
  labels,
}: {
  workspaceId: string;
  tab: PlanningTab;
  isAdmin: boolean;
  currentUserId: string;
  settings: CycleSettings;
  cycles: CycleSummary[];
  selectedCycle: CycleDetail | null;
  selectedCycleId: string;
  candidates: CandidateTask[];
  initiatives: Initiative[];
  roadmap: RoadmapGroup[];
  members: MemberOption[];
  projects: ProjectOption[];
  labels: Label[];
}) {
  const t = useT();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function tabHref(next: PlanningTab): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    params.delete("cycle");
    return `${pathname}?${params.toString()}`;
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="planning-page">
      <header
        className={`${PAGE_HEADER} ${PAGE_INSET}`}
      >
        <h1 className={PAGE_TITLE}>{t("Planning")}</h1>
        <nav aria-label={t("Planning sections")} className="ml-auto flex flex-wrap items-center gap-0.5">
          {TABS.map(({ key, label }) => (
            <Link
              key={key}
              href={tabHref(key)}
              scroll={false}
              aria-current={tab === key ? "page" : undefined}
              data-testid={`planning-tab-${key}`}
              className={`rounded-md px-2.5 py-1 text-small transition-colors ${
                tab === key ? "bg-elevated text-text" : "text-muted hover:bg-elevated/60 hover:text-text"
              }`}
            >
              {t(label)}
            </Link>
          ))}
        </nav>
        <span id="planning-header-tools" className="contents" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={tab === "cycles" ? "" : `${PAGE_INSET} py-5`}>
          {tab === "cycles" && (
            <CyclesTab
              workspaceId={workspaceId}
              isAdmin={isAdmin}
              settings={settings}
              cycles={cycles}
              selected={selectedCycle}
              selectedCycleId={selectedCycleId}
              candidates={candidates}
            />
          )}
          {tab === "roadmap" && <PlanningRoadmap workspaceId={workspaceId} groups={roadmap} />}
          {tab === "initiatives" && (
            <PlanningInitiatives
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              initiatives={initiatives}
              members={members}
              projects={projects}
              labels={labels}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CyclesTab({
  workspaceId,
  isAdmin,
  settings,
  cycles,
  selected,
  selectedCycleId,
  candidates,
}: {
  workspaceId: string;
  isAdmin: boolean;
  settings: CycleSettings;
  cycles: CycleSummary[];
  selected: CycleDetail | null;
  selectedCycleId: string;
  candidates: CandidateTask[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { confirm, toast } = useUI();
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useDetailSource("task", selected?.tasks.map((task) => task.id) ?? []);

  function cycleHref(cycleId: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "cycles");
    params.set("cycle", cycleId);
    return `${pathname}?${params.toString()}`;
  }

  async function enableCycles() {
    setBusy(true);
    const result = await saveCycleSettingsAction(workspaceId, {
      enabled: true,
      durationWeeks: settings.durationWeeks,
      startDay: settings.startDay,
      cooldownWeeks: settings.cooldownWeeks,
      upcomingCount: settings.upcomingCount,
      autoAdd: settings.autoAdd,
    });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function completeCycle() {
    if (!selected) return;
    const ok = await confirm(
      t("Complete {cycle}?", { cycle: selected.cycle.name }),
      {
        body: t("{count} unfinished tasks will move to the next cycle. Done and canceled tasks stay in {cycle}.", {
          count: selected.cycle.progress.open,
          cycle: selected.cycle.name,
        }),
        action: t("Complete cycle"),
        tone: "primary",
      }
    );
    if (!ok) return;
    setBusy(true);
    const result = await completeCycleAction(workspaceId, selected.cycle.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast(
      t("Moved {count} unfinished tasks to the next cycle.", {
        count: result.data.moved,
      })
    );
    router.refresh();
  }

  if (cycles.length === 0) {
    return (
      <div className="mx-auto max-w-md py-12 text-center" data-testid="planning-empty-cycles">
        <div className="text-lead font-medium">{t("Plan work in cycles")}</div>
        <p className="mt-1 text-body text-muted">
          {t("Cycles add a start and end date to the tasks the team pulls in. Unfinished tasks move to the next cycle; done and canceled tasks stay.")}
        </p>
        {isAdmin ? (
          <button
            type="button"
            onClick={enableCycles}
            disabled={busy}
            className={`${primaryButton} mt-4`}
            data-testid="cycles-enable"
          >
            {t("Turn on cycles")}
          </button>
        ) : (
          <p className="mt-4 text-small text-faint">
            {t("Ask a workspace admin to turn on cycles in Settings.")}
          </p>
        )}
        {error && <div className="mt-3 text-small text-danger">{error}</div>}
      </div>
    );
  }

  const grouped = CYCLE_STATUSES.map((status) => ({
    status,
    rows: cycles.filter((cycle) => cycle.status === status),
  })).filter((group) => group.rows.length > 0);
  const current = cycles.find((cycle) => cycle.id === selectedCycleId);
  const startLabel = CYCLE_START_DAYS.find((day) => day.value === settings.startDay)?.label ?? "Monday";

  return (
    <div>
      <div className={`${FILTER_BAR} sticky top-0 z-10 bg-bg`}>
        <Menu
          width={300}
          triggerClassName={CHIP}
          trigger={
            <>
              {current
                ? `${current.name} · ${formatDayRange(current.startsAt, current.endsAt, locale)}`
                : t("Pick a cycle")}
              <ChevronDown size={12} className="text-faint" />
            </>
          }
        >
          {(close) => (
            <div data-testid="cycle-list">
              {grouped.map((group) => (
                <section key={group.status}>
                  <div className="px-2 pb-0.5 pt-1.5 text-caption text-faint">
                    {t(CYCLE_STATUS_META[group.status].label)}
                  </div>
                  {group.rows.map((cycle) => (
                    <Link
                      key={cycle.id}
                      href={cycleHref(cycle.id)}
                      scroll={false}
                      onClick={close}
                      data-testid={`cycle-row-${cycle.number}`}
                      aria-current={cycle.id === selectedCycleId ? "true" : undefined}
                      className={`flex items-baseline gap-2 rounded-md px-2 py-1.5 text-small transition-colors hover:bg-elevated ${
                        cycle.id === selectedCycleId ? "bg-elevated" : ""
                      }`}
                    >
                      <span className="truncate text-text">{cycle.name}</span>
                      <span className="truncate text-caption text-faint">
                        {formatDayRange(cycle.startsAt, cycle.endsAt, locale)}
                      </span>
                      <span className="ml-auto shrink-0 text-caption text-faint tabular-nums">
                        {cycle.progress.done}/{cycle.progress.total - cycle.progress.canceled}
                      </span>
                    </Link>
                  ))}
                </section>
              ))}
            </div>
          )}
        </Menu>
        <span className={`ml-1.5 ${LINE_SUB}`} data-testid="planning-cycle-summary">
          {settings.cooldownWeeks > 0
            ? t("{weeks} weeks · starts {day} · {cooldown} week cooldown", {
                weeks: settings.durationWeeks,
                day: t(startLabel),
                cooldown: settings.cooldownWeeks,
              })
            : t("{weeks} weeks · starts {day}", {
                weeks: settings.durationWeeks,
                day: t(startLabel),
              })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {selected && (
            <a
              href={`/api/cycles/${selected.cycle.id}/calendar`}
              aria-label={t("Download this cycle as a calendar file")}
              title={t("Download this cycle as a calendar file")}
              className={ICON_BTN}
              data-testid="cycle-ics"
            >
              <Download size={14} />
            </a>
          )}
          <Link href={`/${workspaceId}/settings#cycles`} className={BTN} data-testid="cycle-settings-link">
            {t("Cycle settings")}
          </Link>
          {selected && (
            <button type="button" onClick={() => setAddOpen(true)} className={BTN} data-testid="cycle-add-tasks">
              <Plus size={14} />
              {t("Add tasks")}
            </button>
          )}
          {selected && isAdmin && selected.cycle.status !== "completed" && (
            <button type="button" onClick={completeCycle} disabled={busy} className={BTN} data-testid="cycle-complete">
              {t("Complete cycle")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className={`border-b border-border py-2 text-small text-danger ${PAGE_INSET}`} role="alert">
          {error}
        </div>
      )}
      {selected ? (
        <CycleDetailPanel
          workspaceId={workspaceId}
          detail={selected}
          candidates={candidates}
          addOpen={addOpen}
          onAddOpen={setAddOpen}
          onError={setError}
          onToast={toast}
        />
      ) : (
        <p className={`py-6 text-body text-faint ${PAGE_INSET}`}>{t("Pick a cycle to see its tasks.")}</p>
      )}
    </div>
  );
}

function CycleDetailPanel({
  workspaceId,
  detail,
  candidates,
  addOpen,
  onAddOpen,
  onError,
  onToast,
}: {
  workspaceId: string;
  detail: CycleDetail;
  candidates: CandidateTask[];
  addOpen: boolean;
  onAddOpen: (open: boolean) => void;
  onError: (message: string | null) => void;
  onToast: (message: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue } = useUI();
  const [removing, setRemoving] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const cycle = detail.cycle;
  const candidatesShown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (task) =>
        task.title.toLowerCase().includes(needle) ||
        issueRef(task).toLowerCase().includes(needle) ||
        task.projectName.toLowerCase().includes(needle)
    );
  }, [candidates, query]);

  async function removeTask(issueId: string) {
    setRemoving(issueId);
    const result = await planIssuesAction(workspaceId, null, [issueId]);
    setRemoving(null);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onError(null);
    router.refresh();
  }

  async function addTasks() {
    if (picked.size === 0) return;
    setSaving(true);
    const result = await planIssuesAction(workspaceId, cycle.id, [...picked]);
    setSaving(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onToast(
      t("Added {count} tasks to {cycle}.", {
        count: result.data.moved,
        cycle: cycle.name,
      })
    );
    setPicked(new Set());
    setQuery("");
    onAddOpen(false);
    router.refresh();
  }

  return (
    <div className={`${NARROW_PAGE} min-w-0 max-w-[1000px]`} data-testid={`cycle-detail-${cycle.number}`}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        <Stat
          testId="cycle-progress"
          label={t("Progress")}
          value={t("{done} of {total} done", {
            done: cycle.progress.done,
            total: cycle.progress.total - cycle.progress.canceled,
          })}
          caption={t("{open} open tasks", { open: cycle.progress.open })}
        />
        <Stat
          testId="cycle-committed"
          label={t("Committed")}
          value={
            cycle.progress.unsized === 0 && cycle.progress.estimate > 0
              ? t("{points} pts", { points: cycle.progress.estimate })
              : t("{count} tasks", { count: cycle.progress.total - cycle.progress.canceled })
          }
          caption={t("{count} tasks", { count: cycle.progress.total - cycle.progress.canceled })}
        />
        <Stat
          testId="cycle-capacity"
          label={t("Capacity")}
          value={capacityLabel(detail.capacity, t)}
          caption={
            detail.capacity.samples > 0
              ? t("Last {count} completed cycles", { count: detail.capacity.samples })
              : t("Needs one completed cycle")
          }
        />
        <Stat
          testId="cycle-remaining"
          label={t("Remaining tasks")}
          value={String(cycle.progress.open)}
          caption={t("{count} at the start", {
            count: detail.burndown[0]?.remaining ?? cycle.progress.total - cycle.progress.canceled,
          })}
        />
      </div>

      <section className={SEC} data-testid="cycle-burndown">
        <h2 className={SEC_TITLE}>{t("Burndown")}</h2>
        <div className="rounded-[10px] border border-border p-3.5">
          <BurndownChart points={detail.burndown} endsAt={cycle.endsAt} />
        </div>
      </section>

      <section className={SEC} data-testid="cycle-tasks">
        <h2 className={SEC_TITLE}>{t("Tasks")}</h2>
        {detail.tasks.length === 0 ? (
          <p className="rounded-[10px] border border-border px-5 py-6 text-body text-faint" data-testid="cycle-tasks-empty">
            {t("No tasks in this cycle yet. Add active tasks the team will finish in this period.")}
          </p>
        ) : (
          <div className={BOX}>
            {detail.tasks.map((task) => (
              <div key={task.id} className={LINE}>
                <button
                  type="button"
                  onClick={() => openIssue(task.id)}
                  data-testid="cycle-task-row"
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <StatusIcon status={task.status} size={14} />
                  <span className={`shrink-0 ${LINE_SUB}`}>{issueRef(task)}</span>
                  <span className="min-w-0 flex-1 truncate text-body">{task.title}</span>
                  <span className={`flex min-w-0 max-w-[30%] items-center gap-1 ${LINE_SUB}`}>
                    <ProjectIcon color={task.projectColor} icon={task.projectIcon} size={12} />
                    <span className="truncate">{task.projectName}</span>
                  </span>
                  {task.assignees.map((assignee) => (
                    <AssigneeAvatar key={assignee.id} displayName={assignee.displayName} avatar={assignee.avatar} size={22} />
                  ))}
                  {task.dueDate && (
                    <span className={`shrink-0 tabular-nums ${LINE_SUB}`}>{formatDay(task.dueDate, locale)}</span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t("Remove {task} from this cycle", { task: issueRef(task) })}
                  title={t("Remove from cycle")}
                  disabled={removing === task.id}
                  onClick={() => removeTask(task.id)}
                  className={ICON_BTN}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal open={addOpen} onClose={() => onAddOpen(false)} title={t("Add tasks to {cycle}", { cycle: cycle.name })} className="max-w-[480px] !p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-lead font-semibold">{t("Add tasks to {cycle}", { cycle: cycle.name })}</h2>
          <button type="button" onClick={() => onAddOpen(false)} aria-label={t("Close")} className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text">
            <X size={14} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search tasks")}
            aria-label={t("Search tasks")}
            className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body"
            data-testid="cycle-add-search"
          />
          <div className="max-h-[46vh] divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="cycle-candidates">
            {candidatesShown.length === 0 ? (
              <p className="px-3 py-4 text-small text-faint">{t("Every active task is already in a cycle.")}</p>
            ) : (
              candidatesShown.map((task) => {
                const checked = picked.has(task.id);
                return (
                  <label
                    key={task.id}
                    data-testid="cycle-candidate"
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-elevated/50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(task.id);
                          else next.add(task.id);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-body">{task.title}</span>
                    <span className="flex shrink-0 items-center gap-1 text-small text-faint">
                      <ProjectIcon color={task.projectColor} icon={task.projectIcon} size={12} />
                      {issueRef(task)}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={() => onAddOpen(false)} className={quietButton}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={addTasks}
            disabled={saving || picked.size === 0}
            className={primaryButton}
            data-testid="cycle-add-submit"
          >
            {t("Add {count} tasks", { count: picked.size })}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  testId,
}: {
  label: string;
  value: string;
  caption: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-border px-3.5 py-3" data-testid={testId}>
      <div className="text-caption text-faint">{label}</div>
      <div className="text-title font-semibold tabular-nums">{value}</div>
      <div className={LINE_SUB}>{caption}</div>
    </div>
  );
}

function capacityLabel(
  capacity: CycleCapacity,
  t: (text: string, params?: Record<string, string | number>) => string
): string {
  if (capacity.average === null) return "—";
  return capacity.unit === "points"
    ? t("{value} pts", { value: capacity.average })
    : t("{value} tasks", { value: capacity.average });
}

function BurndownChart({ points, endsAt }: { points: CycleDetail["burndown"]; endsAt: string }) {
  const t = useT();
  const locale = useLocale();
  if (points.length === 0) {
    return <p className="text-small text-faint">{t("The burndown starts when the cycle starts.")}</p>;
  }
  const last = points[points.length - 1];
  // Days still to come slope from today's remaining count down to zero at the cycle end.
  const future = eachDay(last.day, endsAt).slice(1);
  const bars = [
    ...points.map((point) => ({ day: point.day, value: point.remaining, future: false })),
    ...future.map((day, index) => ({
      day,
      value: Math.round(last.remaining * (1 - (index + 1) / future.length)),
      future: true,
    })),
  ];
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <div>
      <div
        className="flex h-[120px] items-end gap-1 border-b border-border-strong"
        role="img"
        aria-label={t("Remaining tasks per day: {remaining} now, {total} at the start", {
          remaining: last.remaining,
          total: points[0].remaining,
        })}
      >
        {bars.map((bar) => (
          <i
            key={bar.day}
            title={`${formatDay(bar.day, locale)} · ${bar.value}`}
            className={`block min-w-0 flex-1 rounded-t-[3px] ${bar.future ? "bg-border-strong" : "bg-text"}`}
            style={{ height: `${(bar.value / max) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-small text-faint">
        {t("Dark bars show remaining tasks, light bars show days to come · Remaining per day: {remaining} now, {total} at the start", {
          remaining: last.remaining,
          total: points[0].remaining,
        })}
      </p>
    </div>
  );
}
