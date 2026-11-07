"use client";

import { useLocale, useT } from "@/components/i18n-context";
import { STATUS_META } from "@/lib/constants";
import { formatDay } from "@/lib/planning/dates";
import {
  formatInsightDays,
  type InsightBurnupPoint,
  type InsightTaskRow,
  type InsightWeekPoint,
  type InsightWorkloadRow,
} from "@/lib/insights.shared";
import { EmptyNote } from "@/components/insights/insights-ui";

const DONE_COLOR = STATUS_META.done.color;
const CANCELED_COLOR = STATUS_META.canceled.color;

export function ThroughputChart({ weeks }: { weeks: InsightWeekPoint[] }) {
  const t = useT();
  const locale = useLocale();
  if (!weeks.some((week) => week.created || week.completed || week.canceled)) {
    return <EmptyNote testId="insight-throughput-empty">{t("No created, completed or canceled tasks in this range.")}</EmptyNote>;
  }
  const max = Math.max(1, ...weeks.map((week) => week.completed));
  return (
    <div data-testid="insight-throughput-chart">
      <div
        className="flex h-[170px] items-end gap-0.5 border-b border-border-strong"
        role="img"
        aria-label={t("Bar chart of completed tasks per week.")}
      >
        {weeks.map((week) => {
          const label = t("{week}: {count} completed", { week: formatDay(week.weekStart, locale), count: week.completed });
          return (
            <div key={week.weekStart} className="flex h-full min-w-0 flex-1 items-end" title={label}>
              <i
                className="mx-auto block w-full max-w-[26px] rounded-t bg-text transition-colors hover:bg-muted"
                style={{ height: `${(week.completed / max) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between pt-1 text-caption text-faint">
        <span>{formatDay(weeks[0].weekStart, locale)}</span>
        <span>{formatDay(weeks[weeks.length - 1].weekStart, locale)}</span>
      </div>
    </div>
  );
}

export function ScatterChart({ rows }: { rows: InsightTaskRow[] }) {
  const t = useT();
  const points = rows.filter(
    (row) => row.completedInRange && row.cycleDays !== null && row.leadDays !== null
  );
  if (points.length === 0) {
    return (
      <EmptyNote testId="insight-scatter-empty">
        {t("No completed tasks with a start time in this range.")}
      </EmptyNote>
    );
  }
  const width = 600;
  const height = 180;
  const pad = 12;
  const maxX = Math.max(1, ...points.map((row) => row.cycleDays as number));
  const maxY = Math.max(1, ...points.map((row) => row.leadDays as number));
  const x = (value: number) => pad + (value / maxX) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxY) * (height - pad * 2);
  const projects = new Map<string, { name: string; color: string }>();
  for (const row of points) projects.set(row.projectId, { name: row.projectName, color: row.projectColor });
  return (
    <div data-testid="insight-scatter-chart">
      <div className="mb-1 flex items-center justify-between text-caption text-faint">
        <span>{t("Lead time →")}</span>
        <span>{t("max {days}", { days: formatInsightDays(maxY) })}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label={t(
          "Scatter plot of {count} completed tasks: cycle time on the horizontal axis, lead time on the vertical axis.",
          { count: points.length }
        )}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <g key={ratio}>
            <line
              x1={pad}
              x2={width - pad}
              y1={pad + ratio * (height - pad * 2)}
              y2={pad + ratio * (height - pad * 2)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <line
              x1={pad + ratio * (width - pad * 2)}
              x2={pad + ratio * (width - pad * 2)}
              y1={pad}
              y2={height - pad}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
          </g>
        ))}
        {points.map((row) => (
          <circle
            key={row.id}
            cx={x(row.cycleDays as number)}
            cy={y(row.leadDays as number)}
            r={4}
            fill={row.projectColor}
            fillOpacity={0.85}
            stroke="var(--color-bg)"
            strokeWidth={1}
          >
            <title>
              {`${row.identifier}: ${t("cycle {cycle}, lead {lead}", {
                cycle: formatInsightDays(row.cycleDays),
                lead: formatInsightDays(row.leadDays),
              })}`}
            </title>
          </circle>
        ))}
      </svg>
      <div className="flex items-center justify-between text-caption text-faint">
        <span>{t("Cycle time →")}</span>
        <span>{formatInsightDays(maxX)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
        {[...projects.values()].map((project) => (
          <span key={project.name} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
            {project.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BurnupChart({ points }: { points: InsightBurnupPoint[] }) {
  const t = useT();
  const locale = useLocale();
  if (points.length === 0) {
    return <EmptyNote testId="insight-burnup-empty">{t("No days in this range.")}</EmptyNote>;
  }
  const last = points[points.length - 1];
  if (last.scope === 0 && last.completed === 0 && last.canceled === 0) {
    return (
      <EmptyNote testId="insight-burnup-empty">
        {t("No tasks have been created for this filter yet.")}
      </EmptyNote>
    );
  }
  const width = 600;
  const height = 180;
  const pad = 10;
  const max = Math.max(1, ...points.map((point) => Math.max(point.scope, point.completed, point.canceled)));
  const x = (index: number) =>
    pad + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - pad * 2));
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const line = (read: (point: InsightBurnupPoint) => number) =>
    points.map((point, index) => `${x(index)},${y(read(point))}`).join(" ");
  const series = [
    { key: "scope", label: "Scope", color: "var(--color-accent)" },
    { key: "completed", label: "Completed", color: DONE_COLOR },
    { key: "canceled", label: "Canceled", color: CANCELED_COLOR },
  ] as const;
  return (
    <div data-testid="insight-burnup-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-44 w-full"
        role="img"
        aria-label={t(
          "Burn-up chart: scope {scope}, completed {completed}, canceled {canceled} at the end of the range.",
          { scope: last.scope, completed: last.completed, canceled: last.canceled }
        )}
      >
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={pad}
            x2={width - pad}
            y1={pad + ratio * (height - pad * 2)}
            y2={pad + ratio * (height - pad * 2)}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}
        {series.map((item) => (
          <polyline
            key={item.key}
            points={line((point) => point[item.key])}
            fill="none"
            stroke={item.color}
            strokeWidth={item.key === "scope" ? 2 : 1.5}
            strokeDasharray={item.key === "canceled" ? "4 4" : undefined}
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-caption text-faint">
        <span>{formatDay(points[0].day, locale)}</span>
        <span className="flex flex-wrap items-center gap-3 text-muted">
          {series.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1">
              <span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />
              {t(item.label)} {item.key === "scope" ? last.scope : item.key === "completed" ? last.completed : last.canceled}
            </span>
          ))}
        </span>
        <span>{formatDay(last.day, locale)}</span>
      </div>
    </div>
  );
}

export function WorkloadChart({ rows }: { rows: InsightWorkloadRow[] }) {
  const t = useT();
  if (rows.length === 0) {
    return <EmptyNote testId="insight-workload-empty">{t("No workload in this range.")}</EmptyNote>;
  }
  const max = Math.max(1, ...rows.map((row) => Math.max(row.active, row.completed)));
  return (
    <div className="space-y-2.5" data-testid="insight-workload-chart" role="list">
      {rows.map((row) => (
        <div key={row.assigneeId ?? "unassigned"} role="listitem" data-testid={`insight-workload-${row.assigneeId ?? "unassigned"}`}>
          <div className="flex items-baseline justify-between gap-2 text-small">
            <span className="min-w-0 truncate text-text">{row.name}</span>
            <span className="shrink-0 font-variant-numeric tabular-nums text-caption text-muted">
              {t("{active} active · {completed} completed", {
                active: row.active,
                completed: row.completed,
              })}
            </span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full bg-accent"
              style={{ width: `${(row.active / max) * 100}%` }}
              title={t("{count} active", { count: row.active })}
            />
            <div
              className="h-full"
              style={{
                width: `${(row.completed / max) * 100}%`,
                backgroundColor: DONE_COLOR,
                opacity: 0.55,
              }}
              title={t("{count} completed in range", { count: row.completed })}
            />
          </div>
          <div className="mt-0.5 text-caption text-faint">
            {row.estimateActive !== null
              ? t("{points} pts active", { points: row.estimateActive })
              : row.active > 0
                ? t("Unsized active work")
                : ""}
            {row.unsizedActive > 0 && row.estimateActive !== null
              ? ` · ${t("{count} unsized", { count: row.unsizedActive })}`
              : ""}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1 text-caption text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-accent" /> {t("Active at the end")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: DONE_COLOR, opacity: 0.55 }} />
          {t("Completed in range")}
        </span>
      </div>
    </div>
  );
}
