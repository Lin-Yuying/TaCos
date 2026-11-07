"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Copy, Download, RotateCcw, Save } from "lucide-react";
import { useT } from "@/components/i18n-context";
import { useDetailSource } from "@/components/detail-navigation";
import { PAGE_INSET } from "@/lib/page-chrome";
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
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  const weeks = data.weeks.length;
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
        className={`flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border py-2 ${PAGE_INSET}`}
      >
        <h1 className="text-body font-semibold">{t("Insights")}</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-faint">
          {filters.from} – {filters.to}
        </span>
        <span className="text-caption text-faint" data-testid="insight-timezone">
          {t("Days use {zone}", { zone: data.range.timeZone })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSaveError(null);
              setSaveOpen(true);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
            data-testid="insight-save-view"
          >
            <Save size={12} />
            {t("Save view")}
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
            data-testid="insight-copy-link"
          >
            <Copy size={12} />
            {copyState === "copied" ? t("Copied") : t("Copy link")}
          </button>
          {copyState === "error" ? (
            <span className="text-caption text-danger" role="alert">
              {t("Could not copy. Copy the address bar.")}
            </span>
          ) : null}
          <a
            href={exportHref}
            download
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
            data-testid="insight-export-csv"
          >
            <Download size={12} />
            {t("Export CSV")}
          </a>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`space-y-3 py-3 pb-10 ${PAGE_INSET}`}>
          {/* Filters are their own full-width row; charts never compete with them for width. */}
          <div
            className="flex flex-wrap items-end gap-x-2 gap-y-1.5 rounded-lg border border-border px-3 py-2"
            data-testid="insight-filters"
          >
            <label className="flex flex-col gap-0.5 text-caption text-faint">
              {t("From")}
              <input
                type="date"
                value={filters.from}
                onChange={(event) => patch({ from: event.target.value || filters.from })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-date-from"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-caption text-faint">
              {t("To")}
              <input
                type="date"
                value={filters.to}
                onChange={(event) => patch({ to: event.target.value || filters.to })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-date-to"
              />
            </label>
            <label className="flex min-w-[150px] flex-1 flex-col gap-0.5 text-caption text-faint">
              {t("Project")}
              <select
                value={filters.projectId ?? ""}
                onChange={(event) => patch({ projectId: event.target.value || null })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-project-filter"
              >
                <option value="">{t("All projects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[130px] flex-1 flex-col gap-0.5 text-caption text-faint">
              {t("Assignee")}
              <select
                value={filters.assigneeId ?? ""}
                onChange={(event) => patch({ assigneeId: event.target.value || null })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-assignee-filter"
              >
                <option value="">{t("Anyone")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[120px] flex-1 flex-col gap-0.5 text-caption text-faint">
              {t("Label")}
              <select
                value={filters.label}
                onChange={(event) => patch({ label: event.target.value })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-label-filter"
              >
                <option value="">{t("All labels")}</option>
                {labels.map((label) => (
                  <option key={label.id} value={label.name}>
                    {label.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-[120px] flex-col gap-0.5 text-caption text-faint">
              {t("Status")}
              <select
                value={filters.status}
                onChange={(event) => patch({ status: event.target.value as InsightStatusFilter })}
                className="rounded-md border border-border bg-bg px-2 py-1 text-body text-text"
                data-testid="insight-status-filter"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => navigate(defaults)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
              data-testid="insight-reset-filters"
            >
              <RotateCcw size={12} />
              {t("Reset")}
            </button>
            <span className="ml-auto text-caption text-faint" aria-live="polite">
              {pending ? t("Updating…") : null}
            </span>
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5 text-small"
            data-testid="insight-saved-views"
          >
            <span className="text-caption uppercase tracking-[0.06em] text-faint">{t("Saved views")}</span>
            {savedViews.length === 0 ? (
              <span className="text-caption text-faint">{t("No saved views yet.")}</span>
            ) : (
              savedViews.map((view) => (
                <Link
                  key={view.id}
                  href={`${pathname}?viewId=${view.id}`}
                  data-testid={`insight-saved-view-${view.id}`}
                  aria-current={activeView?.id === view.id ? "page" : undefined}
                  className={`rounded-full border px-2 py-0.5 text-caption transition-colors ${
                    activeView?.id === view.id
                      ? "border-border-strong bg-elevated text-text"
                      : "border-border text-muted hover:border-border-strong hover:text-text"
                  }`}
                >
                  {view.name}
                </Link>
              ))
            )}
            {activeView ? (
              <button
                type="button"
                onClick={() =>
                  startTransition(() => {
                    router.replace(`${pathname}?${insightQuery(filters)}`, { scroll: false });
                  })
                }
                className="ml-1 text-caption text-faint underline-offset-2 hover:text-text hover:underline"
                data-testid="insight-clear-view"
              >
                {t("Clear view")}
              </button>
            ) : null}
          </div>

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
                className="mt-3 rounded-md border border-border px-3 py-1.5 text-small text-muted hover:border-border-strong hover:text-text"
                data-testid="insight-empty-reset"
              >
                {t("Reset filters")}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4" data-testid="insight-metrics">
            <MetricCard
              label={t("Created")}
              value={String(metrics.created)}
              caption={t("{count} subtasks", { count: metrics.subtaskCreated })}
              testId="insight-metric-created"
            />
            <MetricCard
              label={t("Completed")}
              value={String(metrics.completed)}
              caption={t("{rate} per week", { rate: metrics.throughputPerWeek.toFixed(1) })}
              testId="insight-metric-completed"
            />
            <MetricCard
              label={t("Canceled")}
              value={String(metrics.canceled)}
              caption={t("Excluded from time measures")}
              testId="insight-metric-canceled"
            />
            <MetricCard
              label={t("WIP")}
              value={String(metrics.wip)}
              caption={t("{count} blocked", { count: metrics.blockedActive })}
              testId="insight-metric-wip"
            />
            <MetricCard
              label={t("Lead time")}
              value={formatInsightDays(metrics.leadTimeDays)}
              caption={t("median · {count} tasks", { count: metrics.leadSample })}
              testId="insight-metric-lead-time"
            />
            <MetricCard
              label={t("Cycle time")}
              value={formatInsightDays(metrics.cycleTimeDays)}
              caption={t("median · {count} tasks", { count: metrics.cycleSample })}
              testId="insight-metric-cycle-time"
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

          <div className="grid gap-3 @4xl:grid-cols-2">
            <Section
              title={t("Throughput by week")}
              caption={t("{count} completed over {weeks} weeks", {
                count: metrics.completed,
                weeks: Math.max(1, weeks),
              })}
              testId="insight-throughput-section"
            >
              <ThroughputChart weeks={data.weeks} />
            </Section>
            <Section
              title={t("Cycle time vs lead time")}
              caption={t("One dot per completed task")}
              testId="insight-scatter-section"
            >
              <ScatterChart rows={data.rows} />
            </Section>
          </div>

          <Section
            title={t("Burn-up")}
            caption={t("Cumulative created, completed and canceled tasks")}
            testId="insight-burnup-section"
          >
            <BurnupChart points={data.burnup} />
          </Section>

          <div className="grid gap-3 @4xl:grid-cols-2">
            <Section
              title={t("Workload")}
              caption={t("Active work at the end and completed work in range")}
              testId="insight-workload-section"
            >
              <WorkloadChart rows={data.workload} />
            </Section>
            <Section
              title={t("Projects")}
              caption={t("Select a project to filter the report")}
              testId="insight-projects-section"
            >
              <ProjectPanel rows={data.projects} onPickProject={(id) => patch({ projectId: id })} />
            </Section>
          </div>

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
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text"
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
              className="rounded-md border border-border px-3 py-1.5 text-body text-muted hover:border-border-strong hover:text-text"
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              disabled={!saveName.trim() || saving}
              className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
