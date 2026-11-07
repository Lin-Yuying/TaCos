"use client";

import { useState } from "react";
import { useT, useLocale } from "@/components/i18n-context";
import { AssigneeAvatar } from "@/components/issue-table";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { ProgressBar } from "@/components/planning-ui";
import { useUI } from "@/components/ui-context";
import { formatTokens } from "@/lib/agent-usage.shared";
import { STATUS_META } from "@/lib/constants";
import { formatDay, formatDayRange } from "@/lib/planning/dates";
import {
  formatInsightDays,
  formatInsightHours,
  formatInsightPercent,
  type InsightAgentPanel,
  type InsightAutomationPanel,
  type InsightCycleRow,
  type InsightData,
  type InsightMilestoneRow,
  type InsightProjectRow,
  type InsightTaskRow,
} from "@/lib/insights.shared";
import { EmptyNote, MetricCard } from "@/components/insights/insights-ui";

export function ProjectPanel({
  rows,
  onPickProject,
}: {
  rows: InsightProjectRow[];
  onPickProject: (projectId: string | null) => void;
}) {
  const t = useT();
  if (rows.length === 0) {
    return <EmptyNote testId="insight-projects-empty">{t("No projects match these filters.")}</EmptyNote>;
  }
  return (
    <div className="overflow-x-auto" data-testid="insight-project-panel">
      <table className="w-full min-w-[520px] text-small">
        <thead>
          <tr className="text-left text-caption uppercase tracking-[0.06em] text-faint">
            <th className="pb-1.5 pr-2 font-medium">{t("Project")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Created")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Completed")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Active")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Lead")}</th>
            <th className="pb-1.5 text-right font-medium">{t("Cycle")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.projectId}
              className="border-t border-border"
              data-testid={`insight-project-${row.projectId}`}
            >
              <td className="py-1.5 pr-2">
                <button
                  type="button"
                  onClick={() => onPickProject(row.projectId)}
                  className="flex max-w-[240px] items-center gap-1.5 text-left text-text hover:underline"
                >
                  <ProjectIcon color={row.color} icon={row.icon} size={12} />
                  <span className="truncate">{row.name}</span>
                </button>
              </td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.created}</td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.completed}</td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.active}</td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">
                {formatInsightDays(row.leadTimeDays)}
              </td>
              <td className="py-1.5 text-right font-variant-numeric tabular-nums text-muted">
                {formatInsightDays(row.cycleTimeDays)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CyclePanel({ rows }: { rows: InsightCycleRow[] }) {
  const t = useT();
  const locale = useLocale();
  if (rows.length === 0) {
    return (
      <EmptyNote testId="insight-cycles-empty">
        {t("No cycles overlap this range. Planning creates them when the workspace enables cycles.")}
      </EmptyNote>
    );
  }
  return (
    <div className="space-y-2.5" data-testid="insight-cycle-panel">
      {rows.map((cycle) => {
        const countable = cycle.tasks - cycle.canceled;
        return (
          <div key={cycle.id} className="rounded-md border border-border px-3 py-2" data-testid={`insight-cycle-${cycle.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-small font-medium text-text">{cycle.name}</span>
              <span className="text-caption text-faint">
                {formatDayRange(cycle.startsAt, cycle.endsAt, locale)}
              </span>
              <span className="ml-auto text-caption text-muted">
                {t("{done} of {total} done", { done: cycle.doneNow, total: Math.max(0, countable) })}
              </span>
            </div>
            <ProgressBar
              className="mt-1.5"
              percent={countable > 0 ? (cycle.doneNow / countable) * 100 : 100}
            />
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-faint">
              <span>{t("{count} completed in range", { count: cycle.completed })}</span>
              <span>{t("{count} active", { count: cycle.active })}</span>
              <span>
                {cycle.unsized === 0
                  ? t("{points} pts", { points: cycle.estimate })
                  : t("{points} pts · {count} unsized", { points: cycle.estimate, count: cycle.unsized })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MilestonePanel({ rows }: { rows: InsightMilestoneRow[] }) {
  const t = useT();
  const locale = useLocale();
  if (rows.length === 0) {
    return (
      <EmptyNote testId="insight-milestones-empty">
        {t("No project milestones match these filters.")}
      </EmptyNote>
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="insight-milestone-panel">
      <table className="w-full min-w-[480px] text-small">
        <thead>
          <tr className="text-left text-caption uppercase tracking-[0.06em] text-faint">
            <th className="pb-1.5 pr-2 font-medium">{t("Milestone")}</th>
            <th className="pb-1.5 pr-2 font-medium">{t("Target")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Done")}</th>
            <th className="pb-1.5 pr-2 text-right font-medium">{t("Active")}</th>
            <th className="pb-1.5 text-right font-medium">{t("Overdue")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border" data-testid={`insight-milestone-${row.id}`}>
              <td className="py-1.5 pr-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ProjectIcon color={row.projectColor} size={12} />
                  <span className="min-w-0">
                    <span className="block truncate text-text">{row.name}</span>
                    <span className="block truncate text-caption text-faint">{row.projectName}</span>
                  </span>
                </div>
              </td>
              <td className="py-1.5 pr-2 text-muted">
                {row.targetDate ? formatDay(row.targetDate, locale, true) : t("No date")}
              </td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">
                {row.doneNow}/{row.tasks}
              </td>
              <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.active}</td>
              <td
                className={`py-1.5 text-right font-variant-numeric tabular-nums ${
                  row.overdue > 0 ? "text-danger" : "text-muted"
                }`}
              >
                {row.overdue}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AgentPanel({ panel }: { panel: InsightAgentPanel }) {
  const t = useT();
  if (!panel.available) {
    return (
      <EmptyNote testId="insight-agents-empty">
        {t("No agent runs or token usage in this range.")}
      </EmptyNote>
    );
  }
  return (
    <div className="space-y-3" data-testid="insight-agent-panel">
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        <MetricCard label={t("Agent runs")} value={String(panel.runs)} caption={t("{count} failed", { count: panel.failed })} testId="insight-agent-runs" />
        <MetricCard
          label={t("Run completion")}
          value={formatInsightPercent(panel.completionRate)}
          caption={t("{done} done · {failed} failed", { done: panel.done, failed: panel.failed })}
          testId="insight-agent-completion"
        />
        <MetricCard
          label={t("Delegation coverage")}
          value={formatInsightPercent(panel.coverage)}
          caption={t("{done} completed · {active} active", { done: panel.delegatedCompleted, active: panel.delegatedActive })}
          testId="insight-agent-coverage"
        />
        <MetricCard
          label={t("Tokens")}
          value={formatTokens(panel.totalTokens)}
          caption={t("{input} in · {output} out", {
            input: formatTokens(panel.inputTokens),
            output: formatTokens(panel.outputTokens),
          })}
          testId="insight-agent-tokens"
        />
      </div>
      {!panel.usageAvailable ? (
        <p className="text-small text-faint" data-testid="insight-agent-usage-empty">
          {t("No token usage was reported in this range. A harness that reports nothing leaves no row.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-small" data-testid="insight-agent-table">
            <thead>
              <tr className="text-left text-caption uppercase tracking-[0.06em] text-faint">
                <th className="pb-1.5 pr-2 font-medium">{t("Agent")}</th>
                <th className="pb-1.5 pr-2 text-right font-medium">{t("Runs")}</th>
                <th className="pb-1.5 pr-2 text-right font-medium">{t("Input")}</th>
                <th className="pb-1.5 pr-2 text-right font-medium">{t("Output")}</th>
                <th className="pb-1.5 text-right font-medium">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {panel.byAgent.map((row) => (
                <tr key={row.agentId ?? "direct"} className="border-t border-border" data-testid={`insight-agent-${row.agentId ?? "direct"}`}>
                  <td className="py-1.5 pr-2 text-text">{row.agentName}</td>
                  <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.runs}</td>
                  <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{formatTokens(row.inputTokens)}</td>
                  <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{formatTokens(row.outputTokens)}</td>
                  <td className="py-1.5 text-right font-variant-numeric tabular-nums text-text">{formatTokens(row.totalTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {panel.byModel.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" data-testid="insight-agent-models">
          {panel.byModel.map((row) => (
            <span key={`${row.engine}|${row.model}`} className="rounded-full border border-border px-2 py-0.5 text-caption text-muted">
              {row.engine} · {row.model} · {formatTokens(row.totalTokens)}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-caption text-faint">
        {t("Usage is observe-only: TaCos shows reported tokens, never a price or a budget.")}
      </p>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function AutomationPanel({ panel }: { panel: InsightAutomationPanel }) {
  const t = useT();
  if (!panel.available) {
    return (
      <EmptyNote testId="insight-automations-empty">
        {t("No automation runs in this range.")}
      </EmptyNote>
    );
  }
  return (
    <div className="space-y-3" data-testid="insight-automation-panel">
      {panel.scopedToViewer ? (
        <p className="text-small text-faint" data-testid="insight-automation-scope">
          {t("You see the automation runs you triggered. Workspace admins see every run.")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        <MetricCard label={t("Runs")} value={String(panel.runs)} caption={t("{count} running", { count: panel.running })} testId="insight-automation-runs" />
        <MetricCard
          label={t("Failure rate")}
          value={formatInsightPercent(panel.failureRate)}
          caption={t("{success} success · {partial} partial", { success: panel.success, partial: panel.partial })}
          testId="insight-automation-failures"
        />
        <MetricCard
          label={t("Median duration")}
          value={formatDuration(panel.medianDurationMs)}
          caption={t("{count} finished runs", { count: panel.success + panel.partial + panel.failed })}
          testId="insight-automation-duration"
        />
        <MetricCard
          label={t("Failed runs")}
          value={String(panel.failed)}
          caption={t("Automation failures never roll back the task change.")}
          testId="insight-automation-failed"
        />
      </div>
      {panel.byRule.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-small" data-testid="insight-automation-table">
            <thead>
              <tr className="text-left text-caption uppercase tracking-[0.06em] text-faint">
                <th className="pb-1.5 pr-2 font-medium">{t("Rule")}</th>
                <th className="pb-1.5 pr-2 text-right font-medium">{t("Runs")}</th>
                <th className="pb-1.5 pr-2 text-right font-medium">{t("Success")}</th>
                <th className="pb-1.5 text-right font-medium">{t("Failed")}</th>
              </tr>
            </thead>
            <tbody>
              {panel.byRule.map((row) => (
                <tr key={row.ruleId} className="border-t border-border" data-testid={`insight-automation-${row.ruleId}`}>
                  <td className="max-w-[280px] truncate py-1.5 pr-2 text-text">{row.ruleName}</td>
                  <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.runs}</td>
                  <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">{row.success}</td>
                  <td className="py-1.5 text-right font-variant-numeric tabular-nums text-muted">{row.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function TaskTable({
  rows,
  rowTotal,
  onPickProject,
}: {
  rows: InsightTaskRow[];
  rowTotal: number;
  onPickProject: (projectId: string | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { openIssue } = useUI();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 200);
  if (rows.length === 0) {
    return (
      <EmptyNote testId="insight-table-empty">
        {t("No tasks match this range and filter. Widen the range or clear a filter.")}
      </EmptyNote>
    );
  }
  return (
    <div data-testid="insight-table">
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[760px] text-small">
          <thead className="sticky top-0 z-10 bg-bg">
            <tr className="text-left text-caption uppercase tracking-[0.06em] text-faint">
              <th className="py-1.5 pr-2 font-medium">{t("Task")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("Status")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("Project")}</th>
              <th className="py-1.5 pr-2 font-medium">{t("Assignees")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("Created")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("Completed")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("Lead")}</th>
              <th className="py-1.5 pr-2 text-right font-medium">{t("Cycle")}</th>
              <th className="py-1.5 font-medium">{t("Agent")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border align-top hover:bg-elevated/40"
                data-testid={`insight-row-${row.identifier}`}
              >
                <td className="min-w-[220px] py-1.5 pr-2">
                  <button
                    type="button"
                    onClick={() => openIssue(row.id)}
                    className="flex max-w-[340px] items-baseline gap-2 text-left"
                  >
                    <span className="shrink-0 text-caption text-faint">{row.identifier}</span>
                    <span className="truncate text-text">{row.title}</span>
                  </button>
                </td>
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1 text-muted">
                    <StatusIcon status={row.status} size={12} />
                    {t(STATUS_META[row.status].label)}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <button
                    type="button"
                    onClick={() => onPickProject(row.projectId)}
                    className="inline-flex max-w-[160px] items-center gap-1 text-left text-muted hover:text-text"
                  >
                    <ProjectIcon color={row.projectColor} size={11} />
                    <span className="truncate">{row.projectName}</span>
                  </button>
                </td>
                <td className="py-1.5 pr-2">
                  <span className="flex max-w-[160px] items-center gap-1">
                    {row.assignees.length === 0 ? (
                      <span className="text-faint">{t("Unassigned")}</span>
                    ) : (
                      row.assignees.map((assignee) => (
                        <AssigneeAvatar
                          key={assignee.id}
                          displayName={assignee.displayName}
                          avatar={assignee.avatar}
                          size={16}
                        />
                      ))
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right text-muted">
                  {formatDay(row.createdDay, locale)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-2 text-right text-muted">
                  {row.completedDay ? formatDay(row.completedDay, locale) : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">
                  {formatInsightDays(row.leadDays)}
                </td>
                <td className="py-1.5 pr-2 text-right font-variant-numeric tabular-nums text-muted">
                  {formatInsightDays(row.cycleDays)}
                </td>
                <td className="max-w-[140px] truncate py-1.5 text-muted">
                  {row.delegatedAgentName ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-faint">
        <span>
          {t("Showing {shown} of {total} tasks", { shown: visible.length, total: rowTotal })}
        </span>
        {rows.length > 200 ? (
          <button type="button" onClick={() => setShowAll((value) => !value)} className="text-muted hover:text-text">
            {showAll ? t("Show fewer") : t("Show all")}
          </button>
        ) : null}
        {rowTotal > rows.length ? (
          <span>{t("The export includes the same rows as this table.")}</span>
        ) : null}
      </div>
    </div>
  );
}

export function DataNotes({ data }: { data: InsightData }) {
  const t = useT();
  const notes = data.notices.filter(
    (notice) => notice.kind !== "automation-own-runs"
  );
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-small text-muted" data-testid="insight-partial">
      {notes.map((notice, index) => (
        <li key={`${notice.kind}-${index}`}>
          {notice.kind === "range-clamped"
            ? t("Ranges are limited to one year; the start date was moved forward.")
            : notice.kind === "range-swapped"
              ? t("The dates were in the wrong order, so they were swapped.")
              : notice.kind === "dataset-truncated"
                ? t("This workspace has more tasks than Insights scans on demand; the newest {count} are included.", { count: notice.limit })
                : notice.kind === "table-truncated"
                  ? t("Only the newest {count} matching tasks are listed and exported.", { count: notice.limit })
                  : notice.kind === "legacy-completion"
                    ? t("{count} completed tasks have no status event; their last update time is used.", { count: notice.count })
                    : notice.kind === "view-unavailable"
                      ? t("That saved view is no longer available.")
                      : ""}
        </li>
      ))}
      {data.partial ? (
        <li className="text-faint">
          {t("Some historical tasks predate event tracking, so time measures may be incomplete.")}
        </li>
      ) : null}
    </ul>
  );
}

export { formatInsightHours };
