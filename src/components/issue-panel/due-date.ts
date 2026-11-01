export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function todayValue(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function dateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// A task without a deadline starts from its own creation month and lands a week out,
// so opening the picker always shows a sensible day rather than today's date.
export function defaultDueDate(createdAt: string): string {
  const created = new Date(createdAt);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const year = created.getFullYear();
  const month = created.getMonth() + 1;
  return isoDate(year, month, Math.min(soon.getDate(), daysInMonth(year, month)));
}
