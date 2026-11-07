"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Box, Calendar, Check, ChevronDown, Download, Link2, RotateCcw, Star, User, type LucideIcon } from "lucide-react";
import { useLocale, useT } from "@/components/i18n-context";
import { Menu } from "@/components/menu";
import { useDetailSource } from "@/components/detail-navigation";
import { BTN, CHIP, FILTER_BAR, ICON_BTN, NARROW_PAGE, PAGE_HEADER, PAGE_INSET, PAGE_TITLE, SEC, SEC_TITLE, SEGMENTED, segment } from "@/lib/page-chrome";
import { addDays, formatDay } from "@/lib/planning/dates";
import {
  formatInsightDays,
  formatInsightHours,
  formatInsightPercent,
  insightQuery,
  type InsightSavedConfig,
  type InsightStatusFilter,
  type InsightData,
} from "@/lib/insights.shared";
import { saveInsightViewAction } from "@/app/insight-actions";
import { Modal } from "@/components/ui/modal";
import {
  AgentPanel,
  AutomationPanel,
  CyclePanel,
  DataNotes,
  MilestonePanel,
  ProjectPanel,
  TaskTable,
} from "@/components/insights/insights-panels";
import {
  BurnupChart,
  ScatterChart,
  ThroughputChart,
  WorkloadChart,
} from "@/components/insights/insights-charts";
import { EmptyNote, MetricCard, Section } from "@/components/insights/insights-ui";

type ProjectOption = { id: string; name: string; color: string; icon: string | null };
type MemberOption = { id: string; displayName: string; avatar: string | null };
type LabelOption = { id: string; name: string; color: string };

const RANGE_WEEKS = [4, 8, 12];

type InsightChart = "output" | "time" | "total" | "workload" | "projects";
const CHARTS: Array<{ id: InsightChart; label: string; title: string }> = [
  { id: "output", label: "Delivered", title: "Tasks completed per week" },
  { id: "time", label: "Time", title: "Cycle time vs lead time" },
  { id: "total", label: "Cumulative", title: "Burn-up" },
  { id: "workload", label: "Workload", title: "Workload" },
  { id: "projects", label: "Projects", title: "Projects" },
];

const TABLE_CELL = "border-b border-border px-2 py-1.5 text-left font-normal first:pl-0 last:pr-0";

function ChartTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="overflow-x-auto" data-testid="insight-chart-table">
      <table className="w-full text-small tabular-nums">
        <thead className="text-faint">
          <tr>
            {head.map((cell) => (
              <th key={cell} className={TABLE_CELL}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className={TABLE_CELL}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A filter chip over a native select: the first option names the field while nothing is picked.
function ChipSelect({
  icon: Icon,
  active,
  value,
  onChange,
  label,
  testId,
  children,
}: {
  icon?: LucideIcon;
  active: boolean;
  value: string;
  onChange: (value: string) => void;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`${CHIP} relative max-w-[180px] ${active ? "border-border-strong text-text" : ""}`}>
      {Icon ? <Icon size={14} /> : null}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 appearance-none bg-transparent text-small outline-none field-sizing-content"
        data-testid={testId}
      >
        {children}
      </select>
    </label>
  );
}

const STATUS_OPTIONS: Array<{ value: InsightStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "done", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

export function InsightsView({
  workspaceId,
  data,
  projects,
  members,
  labels,
  defaults,
  savedViews,
  activeView,
}: {
  workspaceId: string;
  data: InsightData;
  projects: ProjectOption[];
  members: MemberOption[];
  labels: LabelOption[];
  defaults: InsightSavedConfig;
  savedViews: { id: string; name: string }[];
  activeView: { id: string; name: string } | null;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [chart, setChart] = useState<InsightChart>("output");
  const [chartView, setChartView] = useState<"chart" | "table">("chart");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  useDetailSource("task", data.rows.map((row) => row.id));
  const filters = data.filters;
  const metrics = data.metrics;
  const exportHref = `/${workspaceId}/insights/export?${insightQuery(filters)}`;

  function navigate(next: InsightSavedConfig) {
    const params = new URLSearchParams();
    params.set("from", next.from);
    params.set("to", next.to);
    if (next.projectId) params.set("project", next.projectId);
    if (next.assigneeId) params.set("assignee", next.assigneeId);
    if (next.label) params.set("label", next.label);
    if (next.status !== "all") params.set("status", next.status);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  async function copyLink() {
    const url = `${window.location.origin}${pathname}?${insightQuery(filters)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  const patch = (change: Partial<InsightSavedConfig>) => navigate({ ...filters, ...change });
  const hasFilters = Boolean(
    filters.projectId || filters.assigneeId || filters.label || filters.status !== "all"
  );
  const isDefaultRange = filters.from === defaults.from && filters.to === defaults.to;
  const presetWeeks = RANGE_WEEKS.find(
    (count) => filters.to === defaults.to && filters.from === addDays(defaults.to, -(count * 7 - 1))
  );
  const rangeLabel = presetWeeks
    ? t("Last {count} weeks", { count: presetWeeks })
    : `${formatDay(filters.from, locale)} – ${formatDay(filters.to, locale)}`;
  const activeChart = CHARTS.find((entry) => entry.id === chart) ?? CHARTS[0];
  const empty =
    data.rowTotal === 0 &&
    metrics.created === 0 &&
    metrics.completed === 0 &&
    metrics.canceled === 0 &&
    metrics.wip === 0;

  const reviewDecisions = useMemo(
    () => metrics.reviewApprovals + metrics.reviewChanges,
    [metrics.reviewApprovals, metrics.reviewChanges]
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="insights-page">
      <header
        className={`${PAGE_HEADER} ${PAGE_INSET}`}
      >
        <h1 className={PAGE_TITLE}>{t("Insights")}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Menu
            width={240}
            align="right"
            triggerClassName={BTN}
            trigger={
              <>
                <Star size={14} />
                {activeView ? activeView.name : t("Saved views")}
                <ChevronDown size={14} className="text-faint" />
              </>
            }
          >
            {(close) => (
              <div data-testid="insight-saved-views">
                {savedViews.length === 0 ? (
                  <p className="px-2 py-1.5 text-small text-faint">{t("No saved views yet.")}</p>
                ) : (
                  savedViews.map((view) => (
                    <Link
                      key={view.id}
                      href={`${pathname}?viewId=${view.id}`}
                      onClick={close}
                      data-testid={`insight-saved-view-${view.id}`}
                      aria-current={activeView?.id === view.id ? "page" : undefined}
                      className={`block truncate rounded-md px-2 py-1.5 text-body transition-colors hover:bg-elevated ${
                        activeView?.id === view.id ? "bg-elevated" : ""
                      }`}
                    >
                      {view.name}
                    </Link>
                  ))
                )}
                {activeView ? (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      startTransition(() => {
                        router.replace(`${pathname}?${insightQuery(filters)}`, { scroll: false });
                      });
                    }}
                    className="mt-1 w-full rounded-md border-t border-border px-2 py-1.5 text-left text-small text-muted hover:text-text"
                    data-testid="insight-clear-view"
                  >
                    {t("Clear view")}
                  </button>
                ) : null}
              </div>
            )}
          </Menu>
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setSaveOpen(true);
            }}
            className={BTN}
            data-testid="insight-save-view"
          >
            {t("Save view")}
          </button>
          <button
            type="button"
            onClick={copyLink}
            aria-label={copyState === "copied" ? t("Copied") : t("Copy link")}
            title={copyState === "copied" ? t("Copied") : t("Copy link")}
            className={ICON_BTN}
            data-testid="insight-copy-link"
          >
            {copyState === "copied" ? <Check size={14} /> : <Link2 size={14} />}
          </button>
          {copyState === "error" ? (
            <span className="text-caption text-danger" role="alert">
              {t("Could not copy. Copy the address bar.")}
            </span>
          ) : null}
          <a
            href={exportHref}
            download
            aria-label={t("Export CSV")}
            title={t("Export CSV")}
            className={ICON_BTN}
            data-testid="insight-export-csv"
          >
            <Download size={14} />
          </a>
        </div>
      </header>

      {/* Filters are their own full-width row; charts never compete with them for width. */}
      <div className={FILTER_BAR} data-testid="insight-filters">
        <Menu
          width={240}
          triggerClassName={`${CHIP} border-border-strong !text-text`}
          trigger={
            <>
              <Calendar size={14} />
              {rangeLabel}
              <ChevronDown size={14} className="text-faint" />
            </>
          }
        >
          {(close) => (
            <div className="space-y-1">
              {RANGE_WEEKS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => {
                    close();
                    patch({ from: addDays(defaults.to, -(count * 7 - 1)), to: defaults.to });
                  }}
                  data-testid={`insight-range-${count}`}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-body transition-colors hover:bg-elevated"
                >
                  {t("Last {count} weeks", { count })}
                </button>
              ))}
              <div className="grid grid-cols-2 gap-1.5 border-t border-border px-2 pb-1 pt-2">
                <label className="flex min-w-0 flex-col gap-0.5 text-caption text-faint">
                  {t("From")}
                  <input
                    type="date"
                    value={filters.from}
                    onChange={(event) => patch({ from: event.target.value || filters.from })}
                    className="h-[30px] min-w-0 rounded-lg border border-border bg-bg px-1.5 text-small text-text"
                    data-testid="insight-date-from"
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-0.5 text-caption text-faint">
                  {t("To")}
                  <input
                    type="date"
                    value={filters.to}
                    onChange={(event) => patch({ to: event.target.value || filters.to })}
                    className="h-[30px] min-w-0 rounded-lg border border-border bg-bg px-1.5 text-small text-text"
                    data-testid="insight-date-to"
                  />
                </label>
              </div>
            </div>
          )}
        </Menu>
        <ChipSelect
          icon={Box}
          label={t("Project")}
          active={Boolean(filters.projectId)}
          value={filters.projectId ?? ""}
          onChange={(value) => patch({ projectId: value || null })}
          testId="insight-project-filter"
        >
          <option value="">{t("Project")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </ChipSelect>
        <ChipSelect
          icon={User}
          label={t("Assignee")}
          active={Boolean(filters.assigneeId)}
          value={filters.assigneeId ?? ""}
          onChange={(value) => patch({ assigneeId: value || null })}
          testId="insight-assignee-filter"
        >
          <option value="">{t("Assignee")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </ChipSelect>
        <ChipSelect
          label={t("Label")}
          active={Boolean(filters.label)}
          value={filters.label}
          onChange={(value) => patch({ label: value })}
          testId="insight-label-filter"
        >
          <option value="">{t("Label")}</option>
          {labels.map((label) => (
            <option key={label.id} value={label.name}>
              {label.name}
            </option>
          ))}
        </ChipSelect>
        <ChipSelect
          label={t("Status")}
          active={filters.status !== "all"}
          value={filters.status}
          onChange={(value) => patch({ status: value as InsightStatusFilter })}
          testId="insight-status-filter"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "all" ? t("Status") : t(option.label)}
            </option>
          ))}
        </ChipSelect>
        {hasFilters || !isDefaultRange ? (
          <button type="button" onClick={() => navigate(defaults)} className={CHIP} data-testid="insight-reset-filters">
            <RotateCcw size={14} />
            {t("Reset")}
          </button>
        ) : null}
        <span className="ml-auto text-small text-faint" aria-live="polite" data-testid="insight-timezone">
          {pending ? t("Updating…") : t("Days use {zone}", { zone: data.range.timeZone })}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${NARROW_PAGE} max-w-[980px]`}>
          {pending ? (
            <div
              className="animate-pulse rounded-lg border border-border bg-surface px-3 py-2 text-small text-muted"
              data-testid="insight-loading"
              role="status"
            >
              {t("Loading the selected range…")}
            </div>
          ) : null}

          <DataNotes data={data} />

          {empty ? (
            <div
              className="rounded-lg border border-border px-4 py-6 text-center"
              data-testid="insight-empty"
            >
              <p className="text-body text-text">{t("No tasks match this range and filter.")}</p>
              <p className="mt-1 text-small text-faint">
                {t("Widen the date range, clear a filter, or reset to the last eight weeks.")}
              </p>
              <button
                type="button"
                onClick={() => navigate(defaults)}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small mt-3 border border-border bg-bg text-text hover:bg-active"
                data-testid="insight-empty-reset"
              >
                {t("Reset filters")}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5" data-testid="insight-metrics">
            <MetricCard
              label={t("Completed")}
              value={String(metrics.completed)}
              caption={t("{rate} per week", { rate: metrics.throughputPerWeek.toFixed(1) })}
              testId="insight-metric-completed"
            />
            <MetricCard
              label={t("WIP")}
              value={String(metrics.wip)}
              caption={t("{count} blocked", { count: metrics.blockedActive })}
              testId="insight-metric-wip"
            />
            <MetricCard
              label={t("Cycle time")}
              value={formatInsightDays(metrics.cycleTimeDays)}
              caption={t("median · {count} tasks", { count: metrics.cycleSample })}
              testId="insight-metric-cycle-time"
            />
            <MetricCard
              label={t("Lead time")}
              value={formatInsightDays(metrics.leadTimeDays)}
              caption={t("median · {count} tasks", { count: metrics.leadSample })}
              testId="insight-metric-lead-time"
            />
          </div>
          <details data-testid="insight-more-metrics">
            <summary className="cursor-pointer text-small text-faint">{t("Four more metrics")}</summary>
            <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
            <MetricCard
              label={t("Created")}
              value={String(metrics.created)}
              caption={t("{count} subtasks", { count: metrics.subtaskCreated })}
              testId="insight-metric-created"
            />
            <MetricCard
              label={t("Canceled")}
              value={String(metrics.canceled)}
              caption={t("Excluded from time measures")}
              testId="insight-metric-canceled"
            />
            <MetricCard
              label={t("Review latency")}
              value={formatInsightHours(metrics.reviewLatencyHours)}
              caption={t("median · {count} reviews", { count: metrics.reviewSample })}
              testId="insight-metric-review-latency"
            />
            <MetricCard
              label={t("Delegation coverage")}
              value={formatInsightPercent(metrics.delegationCoverage)}
              caption={t("{done} of {total} completed · {reviews} review decisions", {
                done: metrics.delegatedCompleted,
                total: metrics.completed,
                reviews: reviewDecisions,
              })}
              testId="insight-metric-delegation-coverage"
            />
            </div>
          </details>

          <section className={SEC} data-testid={`insight-chart-${chart}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`${SEC_TITLE} min-w-0 flex-1`}>{t(activeChart.title)}</h2>
              <div className={SEGMENTED} role="group" aria-label={t("Chart")}>
                {CHARTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setChart(entry.id)}
                    aria-pressed={chart === entry.id}
                    className={segment(chart === entry.id)}
                    data-testid={`insight-chart-tab-${entry.id}`}
                  >
                    {t(entry.label)}
                  </button>
                ))}
              </div>
              {chart !== "projects" ? (
                <div className={SEGMENTED} role="group" aria-label={t("View as")}>
                  {(["chart", "table"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setChartView(mode)}
                      aria-pressed={chartView === mode}
                      className={segment(chartView === mode)}
                      data-testid={`insight-view-${mode}`}
                    >
                      {mode === "chart" ? t("Chart") : t("Table")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {chart === "projects" ? (
              <div data-testid="insight-projects-section">
                <ProjectPanel rows={data.projects} onPickProject={(id) => patch({ projectId: id })} />
              </div>
            ) : chartView === "chart" ? (
              <>
                {chart === "output" ? <ThroughputChart weeks={data.weeks} /> : null}
                {chart === "time" ? <ScatterChart rows={data.rows} /> : null}
                {chart === "total" ? <BurnupChart points={data.burnup} /> : null}
                {chart === "workload" ? <WorkloadChart rows={data.workload} /> : null}
              </>
            ) : (
              <>
                {chart === "output" ? (
                  <ChartTable
                    head={[t("Week"), t("Created"), t("Completed"), t("Canceled")]}
                    rows={data.weeks.map((week) => [formatDay(week.weekStart, locale), week.created, week.completed, week.canceled])}
                  />
                ) : null}
                {chart === "time" ? (
                  <ChartTable
                    head={[t("Task"), t("Cycle time"), t("Lead time")]}
                    rows={data.rows
                      .filter((row) => row.completedInRange)
                      .map((row) => [row.title, formatInsightDays(row.cycleDays), formatInsightDays(row.leadDays)])}
                  />
                ) : null}
                {chart === "total" ? (
                  <ChartTable
                    head={[t("Date"), t("Created"), t("Completed"), t("Canceled")]}
                    rows={data.burnup.map((point) => [formatDay(point.day, locale), point.scope, point.completed, point.canceled])}
                  />
                ) : null}
                {chart === "workload" ? (
                  <ChartTable
                    head={[t("Assignee"), t("Active"), t("Completed")]}
                    rows={data.workload.map((row) => [row.name, row.active, row.completed])}
                  />
                ) : null}
              </>
            )}
          </section>

          <Section
            title={t("Tasks")}
            caption={t("{count} tasks in the report", { count: data.rowTotal })}
            testId="insight-tasks-section"
            action={
              <span className="text-caption text-faint">
                {hasFilters ? t("Filtered") : t("All visible tasks")}
              </span>
            }
          >
            <TaskTable
              rows={data.rows}
              rowTotal={data.rowTotal}
              onPickProject={(id) => patch({ projectId: id })}
            />
          </Section>

          <div className="grid gap-3 @4xl:grid-cols-2">
            <Section
              title={t("Cycles")}
              caption={t("Cycles that overlap this range")}
              testId="insight-cycles-section"
            >
              <CyclePanel rows={data.cycles} />
            </Section>
            <Section
              title={t("Milestones")}
              caption={t("Target dates and current progress")}
              testId="insight-milestones-section"
            >
              <MilestonePanel rows={data.milestones} />
            </Section>
          </div>

          <Section
            title={t("Agents")}
            caption={t("Delegation, runs and reported tokens")}
            testId="insight-agents-section"
          >
            <AgentPanel panel={data.agents} />
          </Section>

          <Section
            title={t("Automations")}
            caption={t("Rule runs in this range")}
            testId="insight-automations-section"
          >
            <AutomationPanel panel={data.automations} />
          </Section>

          <p className="text-caption text-faint">
            {t(
              "Sub-tasks are counted as separate tasks. Lead time runs from creation, cycle time from the first In Progress, and canceled tasks are left out of both."
            )}
          </p>
          {data.rows.length === 0 && !empty ? (
            <EmptyNote testId="insight-table-note">{t("No task rows to list.")}</EmptyNote>
          ) : null}
        </div>
      </div>

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title={t("Save as workspace view")}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!saveName.trim() || saving) return;
            setSaving(true);
            setSaveError(null);
            const result = await saveInsightViewAction(workspaceId, {
              name: saveName,
              config: filters,
            });
            setSaving(false);
            if (!result.ok) {
              setSaveError(result.error);
              return;
            }
            setSaveOpen(false);
            setSaveName("");
            startTransition(() => {
              router.replace(`${pathname}?viewId=${result.data.id}`, { scroll: false });
            });
          }}
          data-testid="insight-save-form"
        >
          <h2 className="text-title font-semibold">{t("Save as workspace view")}</h2>
          <p className="mt-1 text-small text-muted">
            {t("Every member of this workspace can open this report. Guests cannot.")}
          </p>
          <label className="mt-3 flex flex-col gap-1 text-small text-muted">
            {t("View name")}
            <input
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              maxLength={80}
              autoFocus
              className="h-[34px] rounded-lg px-2.5 border border-border-strong bg-bg text-body text-text"
              data-testid="insight-view-name"
            />
          </label>
          {saveError ? (
            <p className="mt-2 text-small text-danger" role="alert" data-testid="insight-save-error">
              {saveError}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSaveOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border bg-bg text-text hover:bg-active"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={!saveName.trim() || saving}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="insight-save-submit"
            >
              {saving ? t("Saving…") : t("Save")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
