// Shared and personal task views. A view is a saved definition (filters, sort,
// layout, display options) plus who may see it:
//   shared=0  personal: only its owner, scoped to the URL context it was saved in
//   shared=1  every member of the workspace, or every member of one project
// There is deliberately no per-user sharing and no guest access.
import crypto from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { projectMembers, projects, taskViewPrefs, taskViews, workspaceMembers, workspaces } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import {
  DEFAULT_DISPLAY,
  EMPTY_DEFINITION,
  FILTER_OPS,
  VIEW_LAYOUTS,
  normalizeDisplay,
  type TaskView,
  type TaskViewDisplay,
  type ViewLayout,
} from "@/lib/task-view";
import {
  parseInsightSavedConfig,
  type InsightSavedConfig,
} from "@/lib/insights.shared";

export const VIEW_SCOPES = ["workspace", "project"] as const;
export type ViewScope = (typeof VIEW_SCOPES)[number];

export type TaskViewDefinition = TaskView & {
  layout: ViewLayout;
  display: TaskViewDisplay;
  // Personal views: the URL context they belong to. Shared views leave it empty.
  context?: string;
  // U-02: a shared Insights report stored in the same view table, so members and
  // permissions are the ones U-09 already defines. Task lists skip these rows.
  insight?: InsightSavedConfig;
};

const definitionSchema = z.object({
  filters: z
    .array(
      z.object({
        key: z.string().max(120),
        op: z.enum(FILTER_OPS),
        value: z.string().max(2000).optional(),
      })
    )
    .max(40),
  sort: z
    .array(z.object({ key: z.string().max(120), dir: z.enum(["asc", "desc"]) }))
    .max(10),
  layout: z.enum(VIEW_LAYOUTS),
  display: z.unknown().optional(),
  context: z.string().max(600).optional(),
  insight: z.unknown().optional(),
});

function insightOf(raw: unknown): InsightSavedConfig | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseInsightSavedConfig(raw);
  if (!parsed) throw new TacosError("Enter a valid report range and filters", 400);
  return parsed;
}

/** Validates a client-sent definition; a bad layout/filter is a 400, not a saved view. */
export function parseTaskViewDefinition(raw: unknown): TaskViewDefinition {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) throw new TacosError("Enter a view name and valid filters", 400);
  return {
    filters: parsed.data.filters,
    sort: parsed.data.sort,
    layout: parsed.data.layout,
    display: normalizeDisplay(parsed.data.display),
    ...(parsed.data.context ? { context: parsed.data.context } : {}),
    ...(parsed.data.insight === undefined ? {} : { insight: insightOf(parsed.data.insight) }),
  };
}

/** Stored definitions are read defensively: a bad row degrades to an empty view. */
export function parseStoredDefinition(raw: string): TaskViewDefinition {
  try {
    const value = JSON.parse(raw) as unknown;
    const parsed = definitionSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid");
    const insight =
      parsed.data.insight === undefined ? undefined : (parseInsightSavedConfig(parsed.data.insight) ?? undefined);
    return {
      filters: parsed.data.filters,
      sort: parsed.data.sort,
      layout: parsed.data.layout,
      display: normalizeDisplay(parsed.data.display),
      ...(parsed.data.context ? { context: parsed.data.context } : {}),
      ...(insight ? { insight } : {}),
    };
  } catch {
    return { ...EMPTY_DEFINITION, display: DEFAULT_DISPLAY };
  }
}

export type TaskViewSummary = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  scope: ViewScope;
  name: string;
  definition: TaskViewDefinition;
  shared: boolean;
  ownerId: string;
  position: number;
  isDefault: boolean;
  favorite: boolean;
  // The requester may rename, share/unshare, delete and save the shared definition.
  canManage: boolean;
  // The requester may set this shared view as the scope default.
  canSetDefault: boolean;
  // True when a personal display override is in effect (shared views only).
  hasPersonalOverride: boolean;
};

type ViewRow = typeof taskViews.$inferSelect;
type PrefRow = typeof taskViewPrefs.$inferSelect;

function managerOf(workspaceId: string, userId: string): boolean {
  const db = getDb();
  const workspace = db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (workspace?.createdBy === userId) return true;
  const member = db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    )
    .get();
  return member?.role === "admin";
}

function canManage(row: ViewRow, userId: string, manager: boolean): boolean {
  if (row.ownerId === userId) return true;
  return Boolean(row.shared) && manager;
}

function mergeDefinition(row: ViewRow, pref: PrefRow | undefined): TaskViewDefinition {
  const base = parseStoredDefinition(row.definition);
  if (!pref?.displayOverride) return base;
  try {
    const override = JSON.parse(pref.displayOverride) as {
      display?: unknown;
      layout?: unknown;
      filters?: unknown;
      sort?: unknown;
    };
    // A personal override may carry display, layout, filters or sort; anything that
    // does not validate falls back to the shared definition.
    return parseTaskViewDefinition({
      filters: Array.isArray(override.filters) ? override.filters : base.filters,
      sort: Array.isArray(override.sort) ? override.sort : base.sort,
      layout: (VIEW_LAYOUTS as readonly string[]).includes(String(override.layout))
        ? override.layout
        : base.layout,
      display: override.display === undefined ? base.display : override.display,
      ...(base.context ? { context: base.context } : {}),
      ...(base.insight ? { insight: base.insight } : {}),
    });
  } catch {
    return base;
  }
}

function prefsFor(workspaceId: string, userId: string, viewIds: string[]): Map<string, PrefRow> {
  if (viewIds.length === 0) return new Map();
  const rows = getDb()
    .select()
    .from(taskViewPrefs)
    .where(
      and(
        eq(taskViewPrefs.workspaceId, workspaceId),
        eq(taskViewPrefs.userId, userId),
        inArray(taskViewPrefs.viewId, viewIds)
      )
    )
    .all();
  return new Map(rows.map((row) => [row.viewId, row]));
}

function summarise(
  row: ViewRow,
  pref: PrefRow | undefined,
  userId: string,
  manager: boolean
): TaskViewSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    scope: row.scope as ViewScope,
    name: row.name,
    definition: mergeDefinition(row, pref),
    shared: Boolean(row.shared),
    ownerId: row.ownerId,
    position: row.position,
    isDefault: Boolean(row.isDefault),
    favorite: Boolean(pref?.favorite),
    canManage: canManage(row, userId, manager),
    canSetDefault: Boolean(row.shared) && canManage(row, userId, manager),
    hasPersonalOverride: Boolean(pref?.displayOverride),
  };
}

function sortSummaries(rows: TaskViewSummary[]): TaskViewSummary[] {
  return [...rows].sort((a, b) => {
    if (a.shared !== b.shared) return a.shared ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The workspace's task-visibility switch still decides who may open a project view.
 * Members who cannot see the project must not receive its view (or its notifications).
 */
export function canSeeProject(workspaceId: string, userId: string, projectId: string): boolean {
  const db = getDb();
  const workspace = db
    .select({ seeAll: workspaces.membersSeeAllTasks, ownerId: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (!workspace) return false;
  const member = db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    )
    .get();
  if (workspace.seeAll || workspace.ownerId === userId || member?.role === "admin") return true;
  return Boolean(
    db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
          sql`${projects.deletedAt} IS NULL`,
          or(
            eq(projects.createdBy, userId),
            sql`EXISTS (SELECT 1 FROM project_members WHERE project_members.project_id = ${projects.id} AND project_members.user_id = ${userId})`
          )
        )
      )
      .get()
  );
}

function projectIsOpen(workspaceId: string, projectId: string): boolean {
  return Boolean(
    getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
          sql`${projects.deletedAt} IS NULL`
        )
      )
      .get()
  );
}

export type ListTaskViewsOptions = {
  // The page asking. A project page sees workspace shared views plus that project's.
  scope?: ViewScope;
  projectId?: string | null;
  // Personal views are only listed for the context they were saved in.
  context?: string;
  // The sidebar wants shared views only.
  sharedOnly?: boolean;
  // Insights lists its own reports; task lists never show them.
  insightOnly?: boolean;
};

/** Everything this member can open from the current page, shared first. */
export function listTaskViews(
  workspaceId: string,
  userId: string,
  options: ListTaskViewsOptions = {}
): TaskViewSummary[] {
  const db = getDb();
  const sharedCondition = options.scope === "project" && options.projectId
    ? or(
        eq(taskViews.scope, "workspace"),
        and(eq(taskViews.scope, "project"), eq(taskViews.projectId, options.projectId))
      )!
    : and(eq(taskViews.scope, "workspace"), sql`${taskViews.projectId} IS NULL`)!;
  const where = options.sharedOnly
    ? and(eq(taskViews.workspaceId, workspaceId), eq(taskViews.shared, 1), sharedCondition)!
    : or(
        and(eq(taskViews.workspaceId, workspaceId), eq(taskViews.shared, 1), sharedCondition),
        and(
          eq(taskViews.workspaceId, workspaceId),
          eq(taskViews.shared, 0),
          eq(taskViews.ownerId, userId)
        )
      )!;
  let rows = db.select().from(taskViews).where(where).all();
  // A project view follows its project into the Trash: hide both the row and the view.
  const projectIds = [...new Set(rows.map((row) => row.projectId).filter((id): id is string => !!id))];
  const openProjects = new Set(
    projectIds.length === 0
      ? []
      : db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              inArray(projects.id, projectIds),
              eq(projects.workspaceId, workspaceId),
              sql`${projects.deletedAt} IS NULL`
            )
          )
          .all()
          .map((row) => row.id)
  );
  rows = rows.filter(
    (row) =>
      !row.projectId ||
      (openProjects.has(row.projectId) && canSeeProject(workspaceId, userId, row.projectId))
  );
  // Insight reports and task views share the table but never each other's lists.
  rows = rows.filter((row) => {
    const insight = Boolean(parseStoredDefinition(row.definition).insight);
    return options.insightOnly ? insight : !insight;
  });
  if (!options.sharedOnly) {
    rows = rows.filter((row) => {
      if (row.shared) return true;
      if (options.context === undefined) return false;
      return parseStoredDefinition(row.definition).context === options.context;
    });
  }
  const prefs = prefsFor(workspaceId, userId, rows.map((row) => row.id));
  const manager = managerOf(workspaceId, userId);
  return sortSummaries(rows.map((row) => summarise(row, prefs.get(row.id), userId, manager)));
}

function visibleRow(workspaceId: string, userId: string, id: string): ViewRow {
  const row = getDb()
    .select()
    .from(taskViews)
    .where(and(eq(taskViews.id, id), eq(taskViews.workspaceId, workspaceId)))
    .get();
  if (!row) throw new TacosError("View not found", 404);
  const visible = Boolean(row.shared) || row.ownerId === userId;
  if (!visible) throw new TacosError("View not found", 404);
  if (row.projectId && !projectIsOpen(workspaceId, row.projectId)) {
    throw new TacosError("View not found", 404);
  }
  if (row.projectId && !canSeeProject(workspaceId, userId, row.projectId)) {
    throw new TacosError("View not found", 404);
  }
  return row;
}

export function getTaskView(workspaceId: string, userId: string, id: string): TaskViewSummary {
  const row = visibleRow(workspaceId, userId, id);
  const prefs = prefsFor(workspaceId, userId, [row.id]);
  return summarise(row, prefs.get(row.id), userId, managerOf(workspaceId, userId));
}

/** The scope's default view, when a manager has set one. */
export function defaultTaskView(
  workspaceId: string,
  userId: string,
  scope: ViewScope,
  projectId?: string | null
): TaskViewSummary | null {
  const db = getDb();
  const row = db
    .select()
    .from(taskViews)
    .where(
      and(
        eq(taskViews.workspaceId, workspaceId),
        eq(taskViews.shared, 1),
        eq(taskViews.isDefault, 1),
        eq(taskViews.scope, scope),
        scope === "project" && projectId
          ? eq(taskViews.projectId, projectId)
          : sql`${taskViews.projectId} IS NULL`
      )
    )
    .get();
  if (!row || (row.projectId && !projectIsOpen(workspaceId, row.projectId))) return null;
  if (parseStoredDefinition(row.definition).insight) return null;
  const prefs = prefsFor(workspaceId, userId, [row.id]);
  return summarise(row, prefs.get(row.id), userId, managerOf(workspaceId, userId));
}

function validateName(raw: string): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new TacosError("Enter a view name", 400);
  if (name.length > 80) throw new TacosError("View names are at most 80 characters", 400);
  return name;
}

function nextPosition(workspaceId: string, ownerId: string): number {
  const [row] = getDb()
    .select({ max: sql<number>`COALESCE(MAX(position), 0)` })
    .from(taskViews)
    .where(and(eq(taskViews.workspaceId, workspaceId), eq(taskViews.ownerId, ownerId)))
    .all();
  return Number(row?.max ?? 0) + 1000;
}

export type SaveTaskViewInput = {
  name: string;
  scope: ViewScope;
  projectId?: string | null;
  shared?: boolean;
  definition: unknown;
  // Only personal views carry a context.
  context?: string;
};

export function createTaskView(
  workspaceId: string,
  userId: string,
  input: SaveTaskViewInput
): TaskViewSummary {
  const name = validateName(input.name);
  const scope = VIEW_SCOPES.includes(input.scope) ? input.scope : null;
  if (!scope) throw new TacosError("Choose where this view belongs", 400);
  const projectId = scope === "project" ? (input.projectId ?? null) : null;
  if (scope === "project") {
    if (!projectId || !projectIsOpen(workspaceId, projectId)) {
      throw new TacosError("Project not found", 404);
    }
  }
  const definition = parseTaskViewDefinition(input.definition);
  const shared = Boolean(input.shared);
  if (!shared && input.context) definition.context = input.context.slice(0, 600);
  // Personal views keep the old save-by-name behaviour: saving "Focus" again updates
  // that view instead of stacking a second row with the same name.
  if (!shared && definition.context) {
    const existing = getDb()
      .select()
      .from(taskViews)
      .where(
        and(
          eq(taskViews.workspaceId, workspaceId),
          eq(taskViews.ownerId, userId),
          eq(taskViews.shared, 0),
          eq(taskViews.name, name)
        )
      )
      .all()
      .find((row) => parseStoredDefinition(row.definition).context === definition.context);
    if (existing) {
      getDb()
        .update(taskViews)
        .set({ definition: JSON.stringify(definition), updatedAt: new Date().toISOString() })
        .where(eq(taskViews.id, existing.id))
        .run();
      return getTaskView(workspaceId, userId, existing.id);
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .insert(taskViews)
    .values({
      id,
      workspaceId,
      projectId,
      scope,
      name,
      definition: JSON.stringify(definition),
      shared: shared ? 1 : 0,
      ownerId: userId,
      position: nextPosition(workspaceId, userId),
      isDefault: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return getTaskView(workspaceId, userId, id);
}

/**
 * U-02: save the current report as a shared workspace view. It reuses U-09's view
 * table and permissions, so every member who can see the workspace can open it and
 * guests do not exist.
 */
export function createInsightView(
  workspaceId: string,
  userId: string,
  name: string,
  insight: InsightSavedConfig
): TaskViewSummary {
  return createTaskView(workspaceId, userId, {
    name,
    scope: "workspace",
    shared: true,
    definition: {
      filters: [],
      sort: [],
      layout: "list",
      display: DEFAULT_DISPLAY,
      insight,
    },
  });
}

export function listInsightViews(workspaceId: string, userId: string): TaskViewSummary[] {
  return listTaskViews(workspaceId, userId, {
    scope: "workspace",
    sharedOnly: true,
    insightOnly: true,
  });
}

export function updateTaskView(
  workspaceId: string,
  userId: string,
  id: string,
  patch: { name?: string; shared?: boolean }
): TaskViewSummary {
  const row = visibleRow(workspaceId, userId, id);
  const manager = managerOf(workspaceId, userId);
  if (!canManage(row, userId, manager)) {
    throw new TacosError("Only the view owner or a workspace admin can change this view", 403);
  }
  const sets: Partial<typeof taskViews.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) sets.name = validateName(patch.name);
  if (patch.shared !== undefined) {
    const shared = Boolean(patch.shared);
    sets.shared = shared ? 1 : 0;
  }
  getDb().update(taskViews).set(sets).where(eq(taskViews.id, id)).run();
  return getTaskView(workspaceId, userId, id);
}

/**
 * Saving the definition changes the shared view for its manager. Any other member's
 * save becomes a personal override, so their display choices never reach anyone else.
 * The grid's filter/sort is shared state too, so only managers may change it there.
 */
export function saveTaskViewDefinition(
  workspaceId: string,
  userId: string,
  id: string,
  raw: unknown
): TaskViewSummary {
  const row = visibleRow(workspaceId, userId, id);
  const manager = managerOf(workspaceId, userId);
  const definition = parseTaskViewDefinition(raw);
  const db = getDb();
  if (canManage(row, userId, manager)) {
    const stored = parseStoredDefinition(row.definition);
    // A personal view keeps the context it was saved under, whatever the editor sends.
    if (!row.shared && stored.context) definition.context = stored.context;
    // A report's range and filters are not part of the task-view editor, so a generic
    // save keeps them instead of turning the row back into a task view.
    if (!definition.insight && stored.insight) definition.insight = stored.insight;
    db.transaction((tx) => {
      tx.update(taskViews)
        .set({ definition: JSON.stringify(definition), updatedAt: new Date().toISOString() })
        .where(eq(taskViews.id, id))
        .run();
      // The new shared definition is now the default look for everyone.
      tx.delete(taskViewPrefs)
        .where(
          and(
            eq(taskViewPrefs.workspaceId, workspaceId),
            eq(taskViewPrefs.viewId, id),
            sql`${taskViewPrefs.displayOverride} IS NOT NULL`
          )
        )
        .run();
    });
    return getTaskView(workspaceId, userId, id);
  }
  // A non-manager stores a personal copy of the definition; the shared row is untouched.
  const override = JSON.stringify({
    display: definition.display,
    layout: definition.layout,
    filters: definition.filters,
    sort: definition.sort,
  });
  const now = new Date().toISOString();
  db.insert(taskViewPrefs)
    .values({
      workspaceId,
      userId,
      viewId: id,
      favorite: 0,
      displayOverride: override,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [taskViewPrefs.workspaceId, taskViewPrefs.userId, taskViewPrefs.viewId],
      set: { displayOverride: override, updatedAt: now },
    })
    .run();
  return getTaskView(workspaceId, userId, id);
}

/** A member can reset their personal display override without touching the view. */
export function resetTaskViewOverride(workspaceId: string, userId: string, id: string) {
  visibleRow(workspaceId, userId, id);
  getDb()
    .update(taskViewPrefs)
    .set({ displayOverride: null, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(taskViewPrefs.workspaceId, workspaceId),
        eq(taskViewPrefs.userId, userId),
        eq(taskViewPrefs.viewId, id)
      )
    )
    .run();
  return getTaskView(workspaceId, userId, id);
}

/** Managers set the one view a scope opens by default. */
export function setDefaultTaskView(workspaceId: string, userId: string, id: string): TaskViewSummary {
  const row = visibleRow(workspaceId, userId, id);
  if (!row.shared) throw new TacosError("Only a shared view can be a default", 400);
  const manager = managerOf(workspaceId, userId);
  if (!canManage(row, userId, manager)) {
    throw new TacosError("Only the view owner or a workspace admin can set the default", 403);
  }
  const db = getDb();
  db.transaction((tx) => {
    tx.update(taskViews)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(taskViews.workspaceId, workspaceId),
          eq(taskViews.scope, row.scope),
          row.scope === "project" && row.projectId
            ? eq(taskViews.projectId, row.projectId)
            : sql`${taskViews.projectId} IS NULL`
        )
      )
      .run();
    tx.update(taskViews)
      .set({ isDefault: 1, updatedAt: new Date().toISOString() })
      .where(eq(taskViews.id, id))
      .run();
  });
  return getTaskView(workspaceId, userId, id);
}

export function clearDefaultTaskView(workspaceId: string, userId: string, id: string) {
  const row = visibleRow(workspaceId, userId, id);
  const manager = managerOf(workspaceId, userId);
  if (!canManage(row, userId, manager)) {
    throw new TacosError("Only the view owner or a workspace admin can clear the default", 403);
  }
  getDb()
    .update(taskViews)
    .set({ isDefault: 0, updatedAt: new Date().toISOString() })
    .where(eq(taskViews.id, id))
    .run();
  return getTaskView(workspaceId, userId, id);
}

export function deleteTaskView(workspaceId: string, userId: string, id: string) {
  const row = visibleRow(workspaceId, userId, id);
  const manager = managerOf(workspaceId, userId);
  if (!canManage(row, userId, manager)) {
    throw new TacosError("Only the view owner or a workspace admin can delete this view", 403);
  }
  getDb().transaction((tx) => {
    tx.delete(taskViewPrefs)
      .where(and(eq(taskViewPrefs.workspaceId, workspaceId), eq(taskViewPrefs.viewId, id)))
      .run();
    tx.delete(taskViews).where(eq(taskViews.id, id)).run();
  });
}

/** Duplicates always land as a private copy, so duplicating never shares by accident. */
export function duplicateTaskView(
  workspaceId: string,
  userId: string,
  id: string,
  options: { context?: string } = {}
): TaskViewSummary {
  const row = visibleRow(workspaceId, userId, id);
  const stored = parseStoredDefinition(row.definition);
  const name = `${row.name} copy`.slice(0, 80);
  const definition: TaskViewDefinition = {
    filters: stored.filters,
    sort: stored.sort,
    layout: stored.layout,
    display: stored.display,
  };
  if (options.context) definition.context = options.context;
  else if (stored.context) definition.context = stored.context;
  return createTaskView(workspaceId, userId, {
    name,
    scope: row.scope as ViewScope,
    projectId: row.projectId,
    shared: false,
    definition,
    context: definition.context,
  });
}

export function setTaskViewFavorite(
  workspaceId: string,
  userId: string,
  id: string,
  favorite: boolean
): TaskViewSummary {
  visibleRow(workspaceId, userId, id);
  const now = new Date().toISOString();
  getDb()
    .insert(taskViewPrefs)
    .values({ workspaceId, userId, viewId: id, favorite: favorite ? 1 : 0, updatedAt: now })
    .onConflictDoUpdate({
      target: [taskViewPrefs.workspaceId, taskViewPrefs.userId, taskViewPrefs.viewId],
      set: { favorite: favorite ? 1 : 0, updatedAt: now },
    })
    .run();
  return getTaskView(workspaceId, userId, id);
}

export function toggleTaskViewFavorite(
  workspaceId: string,
  userId: string,
  id: string
): TaskViewSummary {
  const view = getTaskView(workspaceId, userId, id);
  return setTaskViewFavorite(workspaceId, userId, id, !view.favorite);
}

// --- personal views (the legacy API, now backed by task_views) ---

export type PersonalView = { name: string; view: TaskViewDefinition };

export function listPersonalViews(workspaceId: string, userId: string, context: string): PersonalView[] {
  const rows = getDb()
    .select()
    .from(taskViews)
    .where(
      and(
        eq(taskViews.workspaceId, workspaceId),
        eq(taskViews.ownerId, userId),
        eq(taskViews.shared, 0)
      )
    )
    .all();
  const prefs = prefsFor(workspaceId, userId, rows.map((row) => row.id));
  return rows
    .filter((row) => parseStoredDefinition(row.definition).context === context)
    .map((row) => ({ name: row.name, view: mergeDefinition(row, prefs.get(row.id)) }));
}

/** Save by name in one context, the same way the old personal_task_views upsert worked. */
export function savePersonalView(
  workspaceId: string,
  userId: string,
  context: string,
  name: string,
  raw: unknown
): PersonalView[] {
  const clean = validateName(name);
  if (context.length > 600) throw new TacosError("Invalid view context", 400);
  const definition = parseTaskViewDefinition(raw);
  definition.context = context;
  const db = getDb();
  const existing = db
    .select()
    .from(taskViews)
    .where(
      and(
        eq(taskViews.workspaceId, workspaceId),
        eq(taskViews.ownerId, userId),
        eq(taskViews.shared, 0),
        eq(taskViews.name, clean)
      )
    )
    .all()
    .find((row) => parseStoredDefinition(row.definition).context === context);
  if (existing) {
    db.update(taskViews)
      .set({ definition: JSON.stringify(definition), updatedAt: new Date().toISOString() })
      .where(eq(taskViews.id, existing.id))
      .run();
  } else {
    createTaskView(workspaceId, userId, {
      name: clean,
      scope: /\/projects\//.test(context) ? "project" : "workspace",
      projectId: context.match(/\/projects\/([^/?#]+)/)?.[1]
        ? decodeURIComponent(context.match(/\/projects\/([^/?#]+)/)![1])
        : null,
      shared: false,
      definition,
      context,
    });
  }
  return listPersonalViews(workspaceId, userId, context);
}

export function deletePersonalView(
  workspaceId: string,
  userId: string,
  context: string,
  name: string
): PersonalView[] {
  const rows = getDb()
    .select()
    .from(taskViews)
    .where(
      and(
        eq(taskViews.workspaceId, workspaceId),
        eq(taskViews.ownerId, userId),
        eq(taskViews.shared, 0),
        eq(taskViews.name, name)
      )
    )
    .all()
    .filter((row) => parseStoredDefinition(row.definition).context === context);
  for (const row of rows) {
    getDb().transaction((tx) => {
      tx.delete(taskViewPrefs)
        .where(and(eq(taskViewPrefs.workspaceId, workspaceId), eq(taskViewPrefs.viewId, row.id)))
        .run();
      tx.delete(taskViews).where(eq(taskViews.id, row.id)).run();
    });
  }
  return listPersonalViews(workspaceId, userId, context);
}
