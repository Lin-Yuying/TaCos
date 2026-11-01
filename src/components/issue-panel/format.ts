import { PRIORITY_META, REMINDER_META, STATUS_META } from "@/lib/constants";
import type { Priority, ReminderPreset, Status } from "@/lib/constants";
import type { ActivityEvent, Comment } from "@/lib/issues";

export function actorName(entry: {
  actor: { displayName: string } | null;
  agentActor: string | null;
}): string {
  if (entry.actor) return entry.actor.displayName;
  if (entry.agentActor === "mcp") return "MCP agent";
  if (entry.agentActor?.startsWith("api:")) return `API · ${entry.agentActor.slice(4)}`;
  return entry.agentActor ? "Agent" : "Deleted user";
}

export function commentAuthorName(comment: Comment): string {
  return actorName({ actor: comment.author, agentActor: comment.agentAuthor });
}

export function fullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// The metadata row has to hold properties and two timestamps on one line, so the year
// is dropped while it is the current one; the full value stays in the hover title.
export function shortDate(iso: string): string {
  const date = new Date(iso);
  const currentYear = new Date().getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === currentYear ? {} : { year: "numeric" }),
  });
}

// Due dates are stored as plain calendar days, so they are parsed at local midnight —
// passing the bare string to Date would read it as UTC and shift a day westward.
export function dueDateLabel(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function eventText(event: ActivityEvent): string | null {
  switch (event.type) {
    case "created":
      return "created the task";
    case "status_changed": {
      const from = event.data.from as Status;
      const to = event.data.to as Status;
      return `moved ${STATUS_META[from]?.label ?? from} → ${STATUS_META[to]?.label ?? to}`;
    }
    case "reordered":
      return "reordered the board";
    case "priority_changed": {
      const to = event.data.to as Priority;
      return `set priority to ${PRIORITY_META[to]?.label ?? to}`;
    }
    case "due_changed": {
      const to = event.data.to as string | null;
      return to ? `set the due date to ${dueDateLabel(to)}` : "removed the due date";
    }
    case "reminder_changed": {
      const to = event.data.to as ReminderPreset | null;
      return to
        ? `set a reminder ${REMINDER_META[to]?.label ?? to}`
        : "turned the reminder off";
    }
    case "title_changed":
      return `renamed to “${String(event.data.to ?? "").slice(0, 48)}”`;
    case "description_changed":
      return "updated the description";
    case "assignee_changed": {
      const to = event.data.to;
      const names = Array.isArray(to) ? to.map(String) : [String(to ?? "")];
      const label = names.filter(Boolean).join(", ");
      return label ? `assigned to ${label}` : "unassigned";
    }
    case "labels_changed": {
      const added = (event.data.added as string[]) ?? [];
      const removed = (event.data.removed as string[]) ?? [];
      const parts = [
        ...added.map((name) => `+${name}`),
        ...removed.map((name) => `−${name}`),
      ];
      return parts.length > 0 ? `labels ${parts.join(", ")}` : null;
    }
    default:
      return null;
  }
}
