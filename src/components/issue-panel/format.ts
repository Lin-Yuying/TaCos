import { PRIORITY_META, REMINDER_META, STATUS_META } from "@/lib/constants";
import type { Priority, ReminderPreset, Status } from "@/lib/constants";
import type { ActivityEvent, Comment } from "@/lib/issues";
import type { Locale, Translate } from "@/lib/i18n";

const DATE_LOCALE: Record<Locale, string> = { en: "en-US", zh: "zh-CN" };

export function actorName(
  entry: {
    actor: { displayName: string } | null;
    agentActor: string | null;
  },
  t: Translate
): string {
  if (entry.actor) return entry.actor.displayName;
  if (entry.agentActor === "mcp") return t("MCP agent");
  if (entry.agentActor?.startsWith("api:")) return `API · ${entry.agentActor.slice(4)}`;
  return entry.agentActor ? t("Agent") : t("Deleted user");
}

export function commentAuthorName(comment: Comment, t: Translate): string {
  return actorName({ actor: comment.author, agentActor: comment.agentAuthor }, t);
}

export function fullTimestamp(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(DATE_LOCALE[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// The metadata row has to hold properties and two timestamps on one line, so the year
// is dropped while it is the current one; the full value stays in the hover title.
export function shortDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  const currentYear = new Date().getFullYear();
  return date.toLocaleDateString(DATE_LOCALE[locale], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === currentYear ? {} : { year: "numeric" }),
  });
}

// Due dates are stored as plain calendar days, so they are parsed at local midnight —
// passing the bare string to Date would read it as UTC and shift a day westward.
export function dueDateLabel(value: string, locale: Locale): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(DATE_LOCALE[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function eventText(event: ActivityEvent, t: Translate, locale: Locale): string | null {
  const label = (meta: { label: string } | undefined, raw: unknown) =>
    meta ? t(meta.label) : String(raw);
  switch (event.type) {
    case "created":
      return t("created the task");
    case "review_approved":
      return t("approved the task");
    case "review_rejected":
      return t("rejected the task");
    case "claimed":
      return t("claimed the task");
    case "released":
      return t("released the task");
    case "claim_transferred":
      return t("handed the task to another member");
    case "blocker_reported":
      return t("reported a blocker");
    case "parent_changed":
      return event.data.to
        ? t("made a subtask of {parent}", { parent: String(event.data.to) })
        : t("removed the parent task");
    case "status_changed": {
      const from = event.data.from as Status;
      const to = event.data.to as Status;
      return t("moved {from} → {to}", {
        from: label(STATUS_META[from], from),
        to: label(STATUS_META[to], to),
      });
    }
    case "reordered":
      return t("reordered the board");
    case "priority_changed": {
      const to = event.data.to as Priority;
      return t("set priority to {priority}", { priority: label(PRIORITY_META[to], to) });
    }
    case "field_changed": {
      const field = String(event.data.field);
      const to = event.data.to as string | null;
      return to ? t("set {field} to {value}", { field, value: to }) : t("cleared {field}", { field });
    }
    case "due_changed": {
      const to = event.data.to as string | null;
      return to
        ? t("set the due date to {date}", { date: dueDateLabel(to, locale) })
        : t("removed the due date");
    }
    case "reminder_changed": {
      const to = event.data.to as ReminderPreset | null;
      return to
        ? t("set a reminder {when}", { when: label(REMINDER_META[to], to) })
        : t("turned the reminder off");
    }
    case "title_changed":
      return t("renamed to “{title}”", { title: String(event.data.to ?? "").slice(0, 48) });
    case "description_changed":
      return t("updated the description");
    case "assignee_changed": {
      const to = event.data.to;
      const names = Array.isArray(to) ? to.map(String) : [String(to ?? "")];
      const assignees = names.filter(Boolean).join(", ");
      return assignees ? t("assigned to {names}", { names: assignees }) : t("unassigned");
    }
    case "labels_changed": {
      const added = (event.data.added as string[]) ?? [];
      const removed = (event.data.removed as string[]) ?? [];
      const parts = [
        ...added.map((name) => `+${name}`),
        ...removed.map((name) => `−${name}`),
      ];
      return parts.length > 0 ? t("labels {changes}", { changes: parts.join(", ") }) : null;
    }
    default:
      return null;
  }
}
