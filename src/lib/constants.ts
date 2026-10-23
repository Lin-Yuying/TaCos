export type Status = "todo" | "in_progress" | "done" | "canceled";
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Via = "web" | "api" | "mcp";

export const STATUS_ORDER: Status[] = ["in_progress", "todo", "done", "canceled"];

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
