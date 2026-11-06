// #80: types, defaults and labels for internal automation rules.
// No database imports: Settings › Automations is a client component and imports this.
import { PRIORITY_META, STATUS_META, type Priority, type Status } from "@/lib/constants";
import { TacosError } from "@/lib/tacos-error";

export const AUTOMATION_TRIGGER_TYPES = [
  "task.created",
  "task.status_changed",
  "task.assigned",
  "task.claimed",
  "task.released",
  "task.delegated",
  "task.due_soon",
  "task.comment_added",
  "task.mention",
  "agent.run_finished",
  "agent.run_failed",
  "document.updated",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export type AutomationTriggerSpec = {
  type: AutomationTriggerType;
  // Only task.due_soon uses it: the rule fires when the task is this many days away.
  days: number | null;
};

export const DUE_SOON_DAY_OPTIONS = [1, 2, 3, 5, 7] as const;

export function parseAutomationTrigger(value: unknown): AutomationTriggerSpec | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const [type, days] = text.split(":");
  if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(type)) return null;
  if (type === "task.due_soon") {
    const count = Number(days);
    if (!Number.isInteger(count) || count < 1 || count > 30) return null;
    return { type: type as AutomationTriggerType, days: count };
  }
  if (days !== undefined) return null;
  return { type: type as AutomationTriggerType, days: null };
}

export function serializeAutomationTrigger(spec: AutomationTriggerSpec): string {
  return spec.type === "task.due_soon" ? `task.due_soon:${spec.days ?? 2}` : spec.type;
}

export function automationTriggerType(spec: AutomationTriggerSpec): AutomationTriggerType {
  return spec.type;
}

export type AutomationCondition =
  | { kind: "project"; projectId: string }
  | { kind: "label"; label: string }
  | { kind: "priority"; priority: Priority }
  | { kind: "assignee"; present: boolean }
  | { kind: "status"; status: Status }
  | { kind: "text"; contains: string };

export type AutomationConditionKind = AutomationCondition["kind"];

export type AutomationAction =
  | { kind: "set_status"; status: Status }
  | { kind: "set_assignees"; assigneeIds: string[] }
  | { kind: "set_labels"; labels: string[] }
  | { kind: "add_comment"; body: string }
  | { kind: "notify_users"; userIds: string[]; message: string }
  | { kind: "delegate_agent"; agentId: string; note: string }
  | { kind: "create_document"; title: string; doc: string }
  | { kind: "create_task"; title: string; description: string };

export type AutomationActionKind = AutomationAction["kind"];

export const MAX_AUTOMATION_CONDITIONS = 12;
export const MAX_AUTOMATION_ACTIONS = 20;
// A rule's own actions never re-enter it; this bounds two rules that trigger each other.
export const MAX_AUTOMATION_DEPTH = 3;

const TEXT_LIMITS = {
  comment: 5_000,
  message: 1_000,
  note: 2_000,
  doc: 20_000,
  description: 20_000,
} as const;

function text(value: unknown, field: string, max: number, required = true): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result && required) throw new TacosError(`${field} is required`);
  if (result.length > max) throw new TacosError(`${field} must be at most ${max} characters`);
  return result;
}

function ids(value: unknown, field: string, max = 50): string[] {
  if (!Array.isArray(value)) throw new TacosError(`${field} must be a list`);
  const out = [...new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))];
  if (out.length === 0) throw new TacosError(`Choose at least one ${field.toLowerCase()}`);
  if (out.length > max) throw new TacosError(`${field} must have at most ${max} entries`);
  return out;
}

function names(value: unknown, field: string): string[] {
  const out = ids(value, field, 20);
  return out.map((name) => name.trim()).filter(Boolean);
}

export function normalizeAutomationCondition(value: unknown): AutomationCondition {
  if (!value || typeof value !== "object") throw new TacosError("Condition is invalid");
  const row = value as Record<string, unknown>;
  switch (row.kind) {
    case "project":
      return { kind: "project", projectId: text(row.projectId, "Project", 100) };
    case "label":
      return { kind: "label", label: text(row.label, "Label", 100) };
    case "priority": {
      const priority = Number(row.priority);
      if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
        throw new TacosError("Priority must be between 0 and 4");
      }
      return { kind: "priority", priority: priority as Priority };
    }
    case "assignee":
      if (typeof row.present !== "boolean") throw new TacosError("Assignee condition is invalid");
      return { kind: "assignee", present: row.present };
    case "status":
      if (!(row.status === "todo" || row.status === "in_progress" || row.status === "done" || row.status === "canceled")) {
        throw new TacosError("Status condition is invalid");
      }
      return { kind: "status", status: row.status };
    case "text":
      return { kind: "text", contains: text(row.contains, "Text to match", 200) };
    default:
      throw new TacosError("Unknown condition");
  }
}

export function normalizeAutomationAction(value: unknown): AutomationAction {
  if (!value || typeof value !== "object") throw new TacosError("Action is invalid");
  const row = value as Record<string, unknown>;
  switch (row.kind) {
    case "set_status":
      if (!(row.status === "todo" || row.status === "in_progress" || row.status === "done" || row.status === "canceled")) {
        throw new TacosError("Choose a status");
      }
      return { kind: "set_status", status: row.status };
    case "set_assignees":
      return { kind: "set_assignees", assigneeIds: ids(row.assigneeIds, "Assignees") };
    case "set_labels":
      return { kind: "set_labels", labels: names(row.labels, "Labels") };
    case "add_comment":
      return { kind: "add_comment", body: text(row.body, "Comment", TEXT_LIMITS.comment) };
    case "notify_users":
      return {
        kind: "notify_users",
        userIds: ids(row.userIds, "People to notify"),
        message: text(row.message, "Notification message", TEXT_LIMITS.message),
      };
    case "delegate_agent":
      return {
        kind: "delegate_agent",
        agentId: text(row.agentId, "Agent", 100),
        note: text(row.note, "Note", TEXT_LIMITS.note, false),
      };
    case "create_document":
      return {
        kind: "create_document",
        title: text(row.title, "Document title", 120),
        doc: text(row.doc, "Document text", TEXT_LIMITS.doc, false),
      };
    case "create_task":
      return {
        kind: "create_task",
        title: text(row.title, "Task title", 500),
        description: text(row.description, "Task description", TEXT_LIMITS.description, false),
      };
    default:
      throw new TacosError("Unknown action");
  }
}

export type AutomationRuleInput = {
  name: string;
  trigger: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

/** Shape validation for a create/update call. Membership and project checks live in store.ts. */
export function normalizeAutomationRuleInput(input: {
  name?: unknown;
  trigger?: unknown;
  conditions?: unknown;
  actions?: unknown;
}): AutomationRuleInput {
  const name = text(input.name, "Rule name", 120);
  const rawTrigger =
    typeof input.trigger === "string"
      ? input.trigger
      : input.trigger && typeof input.trigger === "object"
        ? serializeAutomationTrigger(input.trigger as AutomationTriggerSpec)
        : "";
  const trigger = parseAutomationTrigger(rawTrigger);
  if (!trigger) throw new TacosError("Choose a trigger");
  if (!Array.isArray(input.conditions)) throw new TacosError("Conditions must be a list");
  if (input.conditions.length > MAX_AUTOMATION_CONDITIONS) {
    throw new TacosError(`A rule can have at most ${MAX_AUTOMATION_CONDITIONS} conditions`);
  }
  if (!Array.isArray(input.actions)) throw new TacosError("Actions must be a list");
  if (input.actions.length === 0) throw new TacosError("Add at least one action");
  if (input.actions.length > MAX_AUTOMATION_ACTIONS) {
    throw new TacosError(`A rule can have at most ${MAX_AUTOMATION_ACTIONS} actions`);
  }
  return {
    name,
    trigger: serializeAutomationTrigger(trigger),
    conditions: input.conditions.map(normalizeAutomationCondition),
    actions: input.actions.map(normalizeAutomationAction),
  };
}

/** A translated string plus the values for its `{placeholders}`. */
export type AutomationText = { key: string; params?: Record<string, string> };

const TRIGGER_TEXT: Record<AutomationTriggerType, string> = {
  "task.created": "When a task is created",
  "task.status_changed": "When a task's status changes",
  "task.assigned": "When a task is assigned",
  "task.claimed": "When a task is claimed",
  "task.released": "When a task is released",
  "task.delegated": "When a task is delegated to an agent",
  "task.due_soon": "When a task is due in {days} days",
  "task.comment_added": "When a comment is added",
  "task.mention": "When a member is mentioned",
  "agent.run_finished": "When an agent run finishes",
  "agent.run_failed": "When an agent run fails",
  "document.updated": "When a document is updated",
};

const SHORT_TRIGGER_TEXT: Record<AutomationTriggerType, string> = {
  "task.created": "Task created",
  "task.status_changed": "Status changed",
  "task.assigned": "Assigned",
  "task.claimed": "Claimed",
  "task.released": "Released",
  "task.delegated": "Delegated",
  "task.due_soon": "Due in {days} days",
  "task.comment_added": "Comment added",
  "task.mention": "Mentioned",
  "agent.run_finished": "Agent run finished",
  "agent.run_failed": "Agent run failed",
  "document.updated": "Document updated",
};

export function triggerSummary(spec: AutomationTriggerSpec): AutomationText {
  return {
    key: TRIGGER_TEXT[spec.type],
    params: spec.type === "task.due_soon" ? { days: String(spec.days ?? 2) } : undefined,
  };
}

export function triggerShortSummary(spec: AutomationTriggerSpec): AutomationText {
  return {
    key: SHORT_TRIGGER_TEXT[spec.type],
    params: spec.type === "task.due_soon" ? { days: String(spec.days ?? 2) } : undefined,
  };
}

export function conditionSummary(
  condition: AutomationCondition,
  names: { projects: Record<string, string> }
): AutomationText {
  switch (condition.kind) {
    case "project":
      return {
        key: "Project is {project}",
        params: { project: names.projects[condition.projectId] ?? "Unknown project" },
      };
    case "label":
      return { key: "Label is {label}", params: { label: condition.label } };
    case "priority":
      return { key: "Priority is {priority}", params: { priority: PRIORITY_META[condition.priority].label } };
    case "assignee":
      return { key: condition.present ? "Has an assignee" : "Has no assignee" };
    case "status":
      return { key: "Status is {status}", params: { status: STATUS_META[condition.status].label } };
    case "text":
      return { key: "Text contains “{contains}”", params: { contains: condition.contains } };
  }
}

export function actionSummary(
  action: AutomationAction,
  names: { projects: Record<string, string>; members: Record<string, string>; agents: Record<string, string> }
): AutomationText {
  switch (action.kind) {
    case "set_status":
      return { key: "Set status to {status}", params: { status: STATUS_META[action.status].label } };
    case "set_assignees":
      return {
        key: "Set assignees to {names}",
        params: {
          names: action.assigneeIds.map((id) => names.members[id] ?? "Unknown member").join(", "),
        },
      };
    case "set_labels":
      return { key: "Set labels to {names}", params: { names: action.labels.join(", ") } };
    case "add_comment":
      return { key: "Add comment “{preview}”", params: { preview: preview(action.body, 60) } };
    case "notify_users":
      return {
        key: "Notify {names}: “{message}”",
        params: {
          names: action.userIds.map((id) => names.members[id] ?? "Unknown member").join(", "),
          message: preview(action.message, 60),
        },
      };
    case "delegate_agent":
      return {
        key: "Delegate to {agent}",
        params: { agent: names.agents[action.agentId] ?? "Unknown agent" },
      };
    case "create_document":
      return { key: "Create document “{title}”", params: { title: action.title } };
    case "create_task":
      return { key: "Create task “{title}”", params: { title: action.title } };
  }
}

function preview(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export type AutomationTemplate = {
  id: string;
  name: string;
  description: string;
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "delegate-assigned",
    name: "Delegate assigned tasks",
    description: "When a task is assigned, hand it to an agent and keep the humans in review.",
  },
  {
    id: "comment-when-done",
    name: "Comment when a task is done",
    description: "When a task moves to Done, add a comment and notify the rule owner.",
  },
  {
    id: "nudge-due-soon",
    name: "Nudge tasks due in 2 days",
    description: "When a task is two days from its due date, add a comment and notify the rule owner.",
  },
];

/** The starting draft for a template. The owner is the default recipient of its notice. */
export function automationTemplateDraft(
  id: string,
  ownerId: string
): { name: string; trigger: AutomationTriggerSpec; conditions: AutomationCondition[]; actions: AutomationAction[] } | null {
  switch (id) {
    case "delegate-assigned":
      return {
        name: "Delegate assigned tasks",
        trigger: { type: "task.assigned", days: null },
        conditions: [],
        actions: [{ kind: "delegate_agent", agentId: "", note: "Work on this task." }],
      };
    case "comment-when-done":
      return {
        name: "Comment when a task is done",
        trigger: { type: "task.status_changed", days: null },
        conditions: [{ kind: "status", status: "done" }],
        actions: [
          { kind: "add_comment", body: "Done. Review the result before closing." },
          { kind: "notify_users", userIds: [ownerId], message: "A task moved to Done." },
        ],
      };
    case "nudge-due-soon":
      return {
        name: "Nudge tasks due in 2 days",
        trigger: { type: "task.due_soon", days: 2 },
        conditions: [],
        actions: [
          { kind: "add_comment", body: "This task is due in 2 days." },
          { kind: "notify_users", userIds: [ownerId], message: "A task is due in 2 days." },
        ],
      };
    default:
      return null;
  }
}

export function defaultAction(kind: AutomationActionKind, ownerId: string): AutomationAction {
  switch (kind) {
    case "set_status":
      return { kind, status: "in_progress" };
    case "set_assignees":
      return { kind, assigneeIds: [ownerId] };
    case "set_labels":
      return { kind, labels: [] };
    case "add_comment":
      return { kind, body: "" };
    case "notify_users":
      return { kind, userIds: [ownerId], message: "" };
    case "delegate_agent":
      return { kind, agentId: "", note: "" };
    case "create_document":
      return { kind, title: "", doc: "" };
    case "create_task":
      return { kind, title: "", description: "" };
  }
}

export function defaultCondition(kind: AutomationConditionKind, projectId: string): AutomationCondition {
  switch (kind) {
    case "project":
      return { kind, projectId };
    case "label":
      return { kind, label: "" };
    case "priority":
      return { kind, priority: 2 };
    case "assignee":
      return { kind, present: true };
    case "status":
      return { kind, status: "in_progress" };
    case "text":
      return { kind, contains: "" };
  }
}

export const AUTOMATION_CONDITION_KINDS: { kind: AutomationConditionKind; label: string }[] = [
  { kind: "project", label: "Project" },
  { kind: "label", label: "Label" },
  { kind: "priority", label: "Priority" },
  { kind: "assignee", label: "Assignee" },
  { kind: "status", label: "Status" },
  { kind: "text", label: "Text contains" },
];

export const AUTOMATION_ACTION_KINDS: { kind: AutomationActionKind; label: string }[] = [
  { kind: "set_status", label: "Set status" },
  { kind: "set_assignees", label: "Set assignees" },
  { kind: "set_labels", label: "Set labels" },
  { kind: "add_comment", label: "Add comment" },
  { kind: "notify_users", label: "Notify people" },
  { kind: "delegate_agent", label: "Delegate to an agent" },
  { kind: "create_document", label: "Create a document" },
  { kind: "create_task", label: "Create a task" },
];

export type AutomationEvent = {
  id: string;
  type: AutomationTriggerType;
  workspaceId: string;
  issueId?: string;
  issueIdentifier?: string;
  pageId?: string;
  actorUserId?: string;
  actorName: string;
  occurredAt: string;
  data: Record<string, unknown>;
  // Set when a rule action caused this event. The rule that caused it never re-runs.
  originRuleId?: string;
  // How many rule actions deep this event is; bounds two rules that trigger each other.
  depth?: number;
  // Stable across a retry or a scheduler restart; defaults to the event id.
  idempotencyKey?: string;
};

export type AutomationActionResult = {
  index: number;
  kind: AutomationActionKind;
  status: "ok" | "failed" | "skipped";
  error?: string;
  output?: string;
  attempts: number;
};

export type AutomationRunStatus = "running" | "success" | "partial" | "failed";

export type AutomationDryRun = {
  matched: boolean;
  trigger: AutomationTriggerSpec;
  event: AutomationEvent;
  issue: { id: string; identifier: string; title: string } | null;
  conditions: { text: AutomationText; passed: boolean }[];
  actions: AutomationText[];
};
