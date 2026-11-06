// Pure helpers for notification payloads. No database imports: client.ts and the
// notifications UI both use this module.

export type NotificationData = {
  actorName?: string;
  title?: string;
  task?: string;
  date?: string;
  workspaceName?: string;
  ownerName?: string;
  // View subscriptions: which saved view matched, and the task's new status.
  viewName?: string;
  statusLabel?: string;
};

export function parseNotificationData(raw: string | null | undefined): NotificationData | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const data: NotificationData = {};
    for (const key of ["actorName", "title", "task", "date", "workspaceName", "ownerName", "viewName", "statusLabel"] as const) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item === "string" && item) data[key] = item;
    }
    return Object.keys(data).length ? data : null;
  } catch {
    return null;
  }
}

/** Parses the English sentences stored before `data` existed. Unknown rows stay null. */
export function parseLegacyNotificationBody(type: string, body: string): NotificationData | null {
  switch (type) {
    case "assigned": {
      const match = body.match(/^(.*?) assigned you to “(.*)”$/);
      return match ? { actorName: match[1], title: match[2] } : null;
    }
    case "commented": {
      const match = body.match(/^(.*?) commented on “(.*)”$/);
      return match ? { actorName: match[1], title: match[2] } : null;
    }
    case "workspace_deleted": {
      const match = body.match(/^(.*?) deleted the workspace "(.*)"\.$/);
      return match ? { ownerName: match[1], workspaceName: match[2] } : null;
    }
    case "doc_mentioned":
    case "doc_commented":
    case "mentioned":
    case "claimed":
    case "released":
    case "claim_transferred":
    case "blocker":
      return body ? { actorName: body } : null;
    case "due_soon":
      return body ? { date: body } : null;
    case "handoff_done":
    case "handoff_failed":
    case "handoff_waiting":
    case "delegation_started":
    case "delegation_review":
    case "delegation_failed":
    case "delegation_changes_requested":
      return body ? { task: body } : null;
    default:
      return null;
  }
}
