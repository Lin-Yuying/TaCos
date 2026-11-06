// Search scopes shared by the palette, the search page and the server. No DB imports:
// client components import these values and `src/lib/search.ts` reuses them.
import type { Status } from "./constants";

export const SEARCH_KINDS = [
  "task",
  "task_comment",
  "doc",
  "doc_comment",
  "project",
  "person",
  "label",
  "agent_thread",
  "attachment",
  "automation",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

// A tab or a palette prefix always names a group, never a bare table: comments belong
// to the thing they comment on, and agent messages belong to their thread.
export const SEARCH_GROUPS = [
  "all",
  "task",
  "doc",
  "comment",
  "project",
  "person",
  "label",
  "agent",
  "attachment",
  "automation",
] as const;

export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export const GROUP_KINDS: Record<Exclude<SearchGroup, "all">, SearchKind[]> = {
  task: ["task"],
  doc: ["doc"],
  comment: ["task_comment", "doc_comment"],
  project: ["project"],
  person: ["person"],
  label: ["label"],
  agent: ["agent_thread"],
  attachment: ["attachment"],
  automation: ["automation"],
};

export const GROUP_ORDER: SearchGroup[] = [
  "task",
  "doc",
  "comment",
  "project",
  "person",
  "label",
  "agent",
  "attachment",
  "automation",
];

export const GROUP_LABELS: Record<SearchGroup, string> = {
  all: "All",
  task: "Tasks",
  doc: "Documents",
  comment: "Comments",
  project: "Projects",
  person: "People",
  label: "Labels",
  agent: "Agent",
  attachment: "Attachments",
  automation: "Automations",
};

export const KIND_GROUP: Record<SearchKind, Exclude<SearchGroup, "all">> = {
  task: "task",
  task_comment: "comment",
  doc: "doc",
  doc_comment: "comment",
  project: "project",
  person: "person",
  label: "label",
  agent_thread: "agent",
  attachment: "attachment",
  automation: "automation",
};

export function isSearchGroup(value: string | null | undefined): value is SearchGroup {
  return !!value && (SEARCH_GROUPS as readonly string[]).includes(value);
}

export function kindsForGroup(group: SearchGroup): SearchKind[] {
  return group === "all"
    ? SEARCH_KINDS.slice()
    : GROUP_KINDS[group].slice();
}

export const SEARCH_SORTS = ["relevance", "updated", "created"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export function isSearchSort(value: string | null | undefined): value is SearchSort {
  return !!value && (SEARCH_SORTS as readonly string[]).includes(value);
}

export type SearchFilters = {
  projectId?: string;
  // "me" and "none" are resolved by the server; a user id narrows to that assignee.
  assignee?: string;
  status?: Status;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type SearchInput = {
  // What is sent to the server; prefix and @ tokens are removed.
  text: string;
  group: SearchGroup;
  prefix: string | null;
  filters: SearchFilters;
};

export const PREFIXES = [
  { key: "i", group: "task", label: "Tasks" },
  { key: "p", group: "project", label: "Projects" },
  { key: "u", group: "person", label: "People" },
  { key: "d", group: "doc", label: "Documents" },
  { key: "a", group: "agent", label: "Agent" },
  { key: "f", group: "attachment", label: "Attachments" },
] as const satisfies ReadonlyArray<{ key: string; group: SearchGroup; label: string }>;

const PREFIX_GROUPS = new Map<string, SearchGroup>(
  PREFIXES.map((entry) => [entry.key, entry.group])
);

const STATUS_VALUES: readonly Status[] = ["todo", "in_progress", "done", "canceled"];

/**
 * One input grammar for both surfaces: `i login` scopes to tasks, `pricing @me @done`
 * scopes to open work assigned to the viewer. Unknown `@words` stay in the query, so
 * an email address is still searchable.
 */
export function parseSearchInput(input: string): SearchInput {
  let text = input.trim();
  let prefix: string | null = null;
  let group: SearchGroup = "all";
  const scoped = /^([ipudaf])(?::\s*|\s+)([\s\S]*)$/i.exec(text);
  if (scoped) {
    prefix = scoped[1].toLowerCase();
    group = PREFIX_GROUPS.get(prefix) ?? "all";
    text = scoped[2].trim();
  }
  const filters: SearchFilters = {};
  const kept: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const qualifier = /^@([a-z_]+)$/i.exec(token);
    if (qualifier) {
      const value = qualifier[1].toLowerCase();
      if (value === "me") {
        filters.assignee = "me";
        continue;
      }
      if (value === "none" || value === "unassigned") {
        filters.assignee = "none";
        continue;
      }
      if ((STATUS_VALUES as readonly string[]).includes(value)) {
        filters.status = value as Status;
        continue;
      }
    }
    kept.push(token);
  }
  return { text: kept.join(" "), group, prefix, filters };
}

/** Drop one parsed qualifier from the raw input, used by the palette's filter chips. */
export function removeSearchToken(input: string, token: string): string {
  return input
    .split(/\s+/)
    .filter((part) => part.toLowerCase() !== token.toLowerCase())
    .join(" ");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates arrive as YYYY-MM-DD from the filter row; full ISO timestamps pass through. */
export function dateBound(value: string | undefined, end: boolean): string | undefined {
  if (!value) return undefined;
  if (DATE.test(value)) return `${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
