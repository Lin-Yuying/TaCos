// U-03: planning dates are calendar days ("YYYY-MM-DD"), never instants. A cycle that
// ends on the 14th ends for everyone on the 14th, whatever the server timezone does.
// Arithmetic runs in UTC so a daylight-saving change cannot move a date.

export function dayFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The server's local calendar day; the team server runs in one timezone. */
export function todayDay(): string {
  return dayFromDate(new Date());
}

export function isDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

export function normalizeDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isDay(String(value))) throw new Error("Date must be a calendar date (YYYY-MM-DD)");
  return String(value);
}

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, days: number): string {
  const date = utc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** ISO weekday: 1 Monday ... 7 Sunday. */
export function isoWeekday(day: string): number {
  return utc(day).getUTCDay() || 7;
}

/** The first `weekday` on or after `day`. */
export function onOrAfterWeekday(day: string, weekday: number): string {
  const delta = (weekday - isoWeekday(day) + 7) % 7;
  return addDays(day, delta);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let at = start; at <= end; at = addDays(at, 1)) days.push(at);
  return days;
}

export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Nov 10" in the viewer's language; the year appears only when it is not this one. */
export function formatDay(day: string, locale: "en" | "zh", withYear = false): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function formatDayRange(start: string, end: string, locale: "en" | "zh"): string {
  return `${formatDay(start, locale)} – ${formatDay(end, locale)}`;
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function addMonths(month: string, count: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

export function monthLabel(month: string, locale: "en" | "zh"): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    year: "numeric",
  });
}

export function quarterKey(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return `${year}-Q${Math.ceil(month / 3)}`;
}

export function quarterLabel(quarter: string, locale: "en" | "zh"): string {
  const [year, q] = quarter.split("-Q");
  return locale === "zh" ? `${year} 年 Q${q}` : `Q${q} ${year}`;
}

/** Quarter start day from a "YYYY-Qn" key. */
export function quarterStart(quarter: string): string {
  const [year, q] = quarter.split("-Q").map(Number);
  return `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
}

export function addQuarters(quarter: string, count: number): string {
  const [year, q] = quarter.split("-Q").map(Number);
  const index = year * 4 + (q - 1) + count;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}
