// U-02: Insights types and pure helpers shared by the server aggregation module and
// the browser page. No database imports here — this file is safe in a client component.
import { addDays, daysBetween, isDay } from "@/lib/planning/dates";

export const INSIGHT_STATUS_FILTERS = ["all", "active", "done", "canceled"] as const;
export type InsightStatusFilter = (typeof INSIGHT_STATUS_FILTERS)[number];

export const INSIGHT_STATUS_LABELS: Record<InsightStatusFilter, string> = {
  all: "All statuses",
  active: "Active",
  done: "Completed",
  canceled: "Canceled",
};

/** The default window is eight weeks: long enough for cycle and throughput trends. */
export const INSIGHT_DEFAULT_DAYS = 56;
/** On-demand aggregation scans at most one year, so a wide range cannot page forever. */
export const INSIGHT_MAX_DAYS = 366;
/** The newest slice of a very large workspace; the page says when it is partial. */
export const INSIGHT_MAX_TASKS = 5000;
/** The table is the CSV export's source of truth; both stop at the same rows. */
export const INSIGHT_MAX_ROWS = 1000;

export type InsightSavedConfig = {
  from: string;
  to: string;
  projectId: string | null;
  assigneeId: string | null;
  label: string;
  status: InsightStatusFilter;
};

export type InsightNotice =
  | { kind: "range-clamped" }
  | { kind: "range-swapped" }
  | { kind: "dataset-truncated"; limit: number }
  | { kind: "table-truncated"; limit: number }
  | { kind: "legacy-completion"; count: number }
  | { kind: "view-unavailable" }
  | { kind: "automation-own-runs" };

export function defaultInsightConfig(today: string): InsightSavedConfig {
  return {
    from: addDays(today, -(INSIGHT_DEFAULT_DAYS - 1)),
    to: today,
    projectId: null,
    assigneeId: null,
    label: "",
    status: "all",
  };
}

/**
 * A saved view is stored as JSON in a task view definition, so every field is read
 * defensively. An invalid row is not an insight view.
 */
export function parseInsightSavedConfig(raw: unknown): InsightSavedConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (!isDay(input.from) || !isDay(input.to)) return null;
  if (input.from > input.to) return null;
  const status = (INSIGHT_STATUS_FILTERS as readonly string[]).includes(String(input.status))
    ? (input.status as InsightStatusFilter)
    : "all";
  const id = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= 120 ? value : null;
  const label = typeof input.label === "string" ? input.label.slice(0, 120) : "";
  return {
    from: input.from,
    to: input.to,
    projectId: id(input.projectId),
    assigneeId: id(input.assigneeId),
    label,
    status,
  };
}

/**
 * Date boundaries are calendar days in the workspace display timezone. A range may be
 * at most one year; a backwards range is swapped rather than rejected so a hand-edited
 * URL still opens a report.
 */
export function normalizeInsightConfig(
  input: Partial<InsightSavedConfig>,
  today: string
): { config: InsightSavedConfig; notices: InsightNotice[] } {
  const notices: InsightNotice[] = [];
  const fallback = defaultInsightConfig(today);
  let from = isDay(input.from) ? input.from : fallback.from;
  let to = isDay(input.to) ? input.to : fallback.to;
  if (from > to) {
    [from, to] = [to, from];
    notices.push({ kind: "range-swapped" });
  }
  if (daysBetween(from, to) > INSIGHT_MAX_DAYS - 1) {
    from = addDays(to, -(INSIGHT_MAX_DAYS - 1));
    notices.push({ kind: "range-clamped" });
  }
  const status = (INSIGHT_STATUS_FILTERS as readonly string[]).includes(String(input.status))
    ? (input.status as InsightStatusFilter)
    : "all";
  const id = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= 120 ? value : null;
  return {
    config: {
      from,
      to,
      projectId: id(input.projectId),
      assigneeId: id(input.assigneeId),
      label: typeof input.label === "string" ? input.label.slice(0, 120) : "",
      status,
    },
    notices,
  };
}

/** "from=…&to=…" for a report link, saved view or CSV export. */
export function insightQuery(config: InsightSavedConfig): string {
  const params = new URLSearchParams();
  params.set("from", config.from);
  params.set("to", config.to);
  if (config.projectId) params.set("project", config.projectId);
  if (config.assigneeId) params.set("assignee", config.assigneeId);
  if (config.label) params.set("label", config.label);
  if (config.status !== "all") params.set("status", config.status);
  return params.toString();
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Days are shown with one decimal until they pass ten, then as whole days. */
export function formatInsightDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days < 0.01) return "0d";
  return days < 10 ? `${days.toFixed(1)}d` : `${Math.round(days)}d`;
}

/** Review latency is often under a day, so it reads in hours. */
export function formatInsightHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatInsightPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

export function formatInsightCount(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "0";
}

/** The Monday that starts the calendar week containing `day`. */
export function weekStartDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  return addDays(day, 1 - weekday);
}
