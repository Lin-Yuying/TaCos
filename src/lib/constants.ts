export type Status = "todo" | "in_progress" | "done" | "canceled";
export type Recurrence = "daily" | "weekly" | "monthly";
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Via = "web" | "api" | "mcp";

// U-11: a comment thread can be closed as resolved. The fixed set keeps the reaction
// picker small; no free emoji picker (plan decision 2).
export const COMMENT_REACTIONS = ["👍", "❤️", "🎉", "👀", "🙌"] as const;
export type CommentReaction = (typeof COMMENT_REACTIONS)[number];
export const COMMENT_REACTION_META: Record<CommentReaction, { label: string }> = {
  "👍": { label: "Thumbs up" },
  "❤️": { label: "Heart" },
  "🎉": { label: "Celebrate" },
  "👀": { label: "Eyes" },
  "🙌": { label: "Raise hands" },
};

// Follow scopes. "issue" matches the notification-mute vocabulary; the UI says Task.
export type WatchScopeType = "issue" | "project" | "page";
export const WATCH_SCOPE_META: Record<WatchScopeType, { label: string; noun: string }> = {
  issue: { label: "task", noun: "task" },
  project: { label: "project", noun: "project" },
  page: { label: "document", noun: "document" },
};

export const STATUS_ORDER: Status[] = ["in_progress", "todo", "done", "canceled"];
export const BOARD_STATUS_ORDER: Status[] = ["todo", "in_progress", "done", "canceled"];

export const STATUS_META: Record<Status, { label: string; color: string }> = {
  todo: { label: "Todo", color: "#8a8f98" },
  in_progress: { label: "In Progress", color: "#f2c94c" },
  done: { label: "Done", color: "#4cb782" },
  canceled: { label: "Canceled", color: "#5f636b" },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  0: { label: "No priority", color: "#5f636b" },
  1: { label: "Low", color: "#8a8f98" },
  2: { label: "Medium", color: "#f2c94c" },
  3: { label: "High", color: "#f2994a" },
  4: { label: "Urgent", color: "#f2994a" },
};

export const PRIORITY_NAMES: Record<Priority, string> = {
  0: "No priority",
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

export const RECURRENCES: Recurrence[] = ["daily", "weekly", "monthly"];
export const RECURRENCE_META: Record<Recurrence, { label: string }> = {
  daily: { label: "Daily" },
  weekly: { label: "Weekly" },
  monthly: { label: "Monthly" },
};

export const LABEL_COLORS = [
  "#eb5757",
  "#ec4899",
  "#a78bfa",
  "#5e6ad2",
  "#3b82f6",
  "#0ea5a4",
  "#4cb782",
  "#eab308",
  "#f97316",
  "#94a3b8",
];

// Cube colour per project: adjacent projects in a workspace should read apart at a glance.
export const PROJECT_COLORS = [
  "#8b5cf6",
  "#0ea5a4",
  "#5e6ad2",
  "#4cb782",
  "#f97316",
  "#ec4899",
  "#3b82f6",
  "#eab308",
  "#eb5757",
  "#94a3b8",
];

export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0];

// How long before a task's due date it should remind. Stored as the preset so the
// reminder keeps sliding with the due date instead of pinning an absolute moment.
export type ReminderPreset = "12h" | "1d" | "3d" | "5d" | "7d";
export const REMINDER_PRESETS: ReminderPreset[] = ["12h", "1d", "3d", "5d", "7d"];
export const REMINDER_META: Record<ReminderPreset, { label: string; hours: number }> = {
  "12h": { label: "12 hours before", hours: 12 },
  "1d": { label: "1 day before", hours: 24 },
  "3d": { label: "3 days before", hours: 72 },
  "5d": { label: "5 days before", hours: 120 },
  "7d": { label: "7 days before", hours: 168 },
};

// U-03 planning. Cycles are workspace-level, 1-8 weeks, starting on one weekday.
export type CycleStatus = "upcoming" | "active" | "completed";
export const CYCLE_STATUSES: CycleStatus[] = ["active", "upcoming", "completed"];
export const CYCLE_STATUS_META: Record<CycleStatus, { label: string }> = {
  active: { label: "Active" },
  upcoming: { label: "Upcoming" },
  completed: { label: "Completed" },
};
export const CYCLE_WEEK_RANGE = { min: 1, max: 8 } as const;
export const CYCLE_UPCOMING_RANGE = { min: 0, max: 15 } as const;
export const CYCLE_COOLDOWN_RANGE = { min: 0, max: 8 } as const;
// ISO weekday: 1 Monday ... 7 Sunday. The stored value is normalized to this range.
export const CYCLE_START_DAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

// U-03 initiatives: a workspace objective grouping projects. The name is Initiative,
// not Goal or OKR (plan decision 3).
export type InitiativeStatus = "proposed" | "planned" | "active" | "completed" | "canceled";
export const INITIATIVE_STATUSES: InitiativeStatus[] = [
  "proposed",
  "planned",
  "active",
  "completed",
  "canceled",
];
export const INITIATIVE_STATUS_META: Record<InitiativeStatus, { label: string; color: string }> = {
  proposed: { label: "Proposed", color: "#8a8f98" },
  planned: { label: "Planned", color: "#3b82f6" },
  active: { label: "Active", color: "#f2c94c" },
  completed: { label: "Completed", color: "#4cb782" },
  canceled: { label: "Canceled", color: "#5f636b" },
};

