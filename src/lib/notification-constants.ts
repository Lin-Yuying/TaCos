// Shared with client components: no database imports.
export type NotificationPrefGroup =
  | "assigned"
  | "comments"
  | "mentions"
  | "reviews"
  | "claims"
  | "blockers"
  | "handoff"
  | "reminders"
  | "views"
  | "automations";

export const NOTIFICATION_EVENT_GROUPS: {
  id: NotificationPrefGroup;
  label: string;
  types: string[];
}[] = [
  { id: "assigned", label: "Assignments", types: ["assigned"] },
  { id: "comments", label: "Comments", types: ["commented"] },
  { id: "mentions", label: "Mentions", types: ["mentioned", "doc_mentioned", "doc_commented"] },
  { id: "reviews", label: "Review decisions", types: ["review_decision"] },
  { id: "claims", label: "Claims and handovers", types: ["claimed", "released", "claim_transferred"] },
  { id: "blockers", label: "Blockers", types: ["blocker"] },
  {
    id: "handoff",
    label: "Agent handoffs and delegation",
    types: [
      "handoff_done",
      "handoff_failed",
      "handoff_waiting",
      "delegation_started",
      "delegation_review",
      "delegation_failed",
      "delegation_changes_requested",
    ],
  },
  { id: "reminders", label: "Due reminders", types: ["due_soon"] },
  { id: "views", label: "View subscriptions", types: ["view_added", "view_completed"] },
  { id: "automations", label: "Automations", types: ["automation"] },
];

// Workspace-deletion notices are always delivered; they have no preference group.
export function prefGroupForType(type: string): NotificationPrefGroup | null {
  for (const group of NOTIFICATION_EVENT_GROUPS) {
    if (group.types.includes(type)) return group.id;
  }
  return null;
}
