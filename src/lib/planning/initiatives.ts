import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "../../db/client";
import {
  initiativeLabels,
  initiativeProjects,
  initiatives,
  issues,
  labels,
  projectMilestones,
  projects,
  users,
  workspaceMembers,
} from "../../db/schema";
import {
  INITIATIVE_STATUSES,
  type InitiativeStatus,
  type Priority,
} from "../constants";
import { listProjects, type Label } from "../issues";
import { TacosError } from "../tacos-error";
import { normalizeDay } from "./dates";

/**
 * U-03 initiatives: workspace objectives grouping projects (plan decision 3: the name is
 * Initiative, not Goal or OKR). Progress is computed from the tasks of the attached
 * projects; there is no stored percentage, health score or forecast.
 */

export type InitiativeResource = { title: string; url: string };

export type InitiativeProgress = {
  total: number;
  done: number;
  canceled: number;
  percent: number;
};

export type InitiativeProjectView = {
  id: string;
  name: string;
  key: string;
  color: string;
  icon: string | null;
  progress: InitiativeProgress;
};

export type Initiative = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  status: InitiativeStatus;
  priority: Priority;
  ownerId: string | null;
  ownerName: string | null;
  ownerAvatar: string | null;
  targetDate: string | null;
  labels: Label[];
  resources: InitiativeResource[];
  projects: InitiativeProjectView[];
  progress: InitiativeProgress;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InitiativeInput = {
  name?: string;
  description?: string;
  status?: InitiativeStatus;
  priority?: Priority;
  ownerId?: string | null;
  targetDate?: string | null;
  labelIds?: string[];
  resources?: InitiativeResource[];
};

export type InitiativeFilters = {
  status?: InitiativeStatus | "all";
  ownerId?: string;
  q?: string;
};

export type RoadmapMilestone = {
  id: string;
  projectId: string;
  name: string;
  targetDate: string | null;
  done: number;
  total: number;
};

export type RoadmapProject = InitiativeProjectView & { milestones: RoadmapMilestone[] };

export type RoadmapGroup = {
  // null is the "No initiative" group: visible projects not on any initiative.
  initiative: Initiative | null;
  projects: RoadmapProject[];
};

const STATUS_RANK: Record<InitiativeStatus, number> = {
  active: 0,
  planned: 1,
  proposed: 2,
  completed: 3,
  canceled: 4,
};

function emptyProgress(): InitiativeProgress {
  return { total: 0, done: 0, canceled: 0, percent: 0 };
}

function addProgress(target: InitiativeProgress, rows: Array<{ status: string }>): void {
  for (const row of rows) {
    if (row.status === "canceled") {
      target.canceled += 1;
      continue;
    }
    target.total += 1;
    if (row.status === "done") target.done += 1;
  }
}

function finishProgress(progress: InitiativeProgress): InitiativeProgress {
  progress.percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return progress;
}

function asStatus(value: unknown): InitiativeStatus {
  const text = String(value ?? "").trim();
  if (!(INITIATIVE_STATUSES as string[]).includes(text)) {
    throw new TacosError(`Status must be one of ${INITIATIVE_STATUSES.join(", ")}`);
  }
  return text as InitiativeStatus;
}

function asPriority(value: unknown): Priority {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 4) {
    throw new TacosError("Priority must be between 0 and 4");
  }
  return number as Priority;
}

function asName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new TacosError("Initiative name is required");
  if (name.length > 200) throw new TacosError("Initiative name must be at most 200 characters");
  return name;
}

function asDescription(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length > 20_000) throw new TacosError("Initiative description is too long");
  return text;
}

function asTargetDate(value: unknown): string | null {
  try {
    return normalizeDay(value);
  } catch {
    throw new TacosError("Target date must be a calendar date (YYYY-MM-DD)");
  }
}

export function parseResources(value: string | null | undefined): InitiativeResource[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { title?: unknown; url?: unknown } =>
          Boolean(item) && typeof item === "object"
      )
      .map((item) => ({ title: String(item.title ?? ""), url: String(item.url ?? "") }))
      .filter((item) => item.url.startsWith("http://") || item.url.startsWith("https://"));
  } catch {
    return [];
  }
}

function normalizeResources(value: unknown): InitiativeResource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TacosError("Resources must be a list of links");
  if (value.length > 20) throw new TacosError("At most 20 resources per initiative");
  return value.map((item) => {
    const title = String((item as { title?: unknown })?.title ?? "").trim();
    const url = String((item as { url?: unknown })?.url ?? "").trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new TacosError("A resource link must start with http:// or https://");
    }
    if (title.length > 120) throw new TacosError("Resource title must be at most 120 characters");
    return { title: title || url, url };
  });
}

async function assertOwner(workspaceId: string, ownerId: string | null | undefined): Promise<void> {
  if (!ownerId) return;
  const [row] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ownerId)))
    .limit(1);
  if (!row) throw new TacosError("Owner must be a member of this workspace");
}

async function assertLabelIds(workspaceId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await getDb()
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), inArray(labels.id, unique)));
  if (rows.length !== unique.length) throw new TacosError("A label was not found in this workspace");
  return unique;
}

async function projectProgress(
  workspaceId: string,
  projectIds: string[]
): Promise<Map<string, InitiativeProgress>> {
  const result = new Map<string, InitiativeProgress>();
  if (projectIds.length === 0) return result;
  const rows = await getDb()
    .select({ projectId: issues.projectId, status: issues.status })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        inArray(issues.projectId, projectIds),
        isNull(issues.deletedAt)
      )
    )
    .all();
  const grouped = new Map<string, Array<{ status: string }>>();
  for (const row of rows) {
    const list = grouped.get(row.projectId) ?? [];
    list.push({ status: row.status });
    grouped.set(row.projectId, list);
  }
  for (const projectId of projectIds) {
    const progress = emptyProgress();
    addProgress(progress, grouped.get(projectId) ?? []);
    result.set(projectId, finishProgress(progress));
  }
  return result;
}

export async function listInitiatives(
  workspaceId: string,
  filters: InitiativeFilters = {},
  viewerId?: string
): Promise<Initiative[]> {
  const db = getDb();
  const conditions = [eq(initiatives.workspaceId, workspaceId)];
  if (filters.status && filters.status !== "all") conditions.push(eq(initiatives.status, filters.status));
  if (filters.ownerId) conditions.push(eq(initiatives.ownerId, filters.ownerId));
  if (filters.q?.trim()) {
    const needle = `%${filters.q.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      sql`(${initiatives.name} LIKE ${needle} ESCAPE '\\' OR ${initiatives.description} LIKE ${needle} ESCAPE '\\')`
    );
  }
  const rows = db
    .select()
    .from(initiatives)
    .where(and(...conditions))
    .orderBy(asc(initiatives.createdAt))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  // Visibility: a viewer who does not see all tasks only gets the projects they may
  // open, and the roll-up counts only those projects.
  const visibleProjects = await listProjects(workspaceId, viewerId);
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const projectById = new Map(visibleProjects.map((project) => [project.id, project]));

  const [projectLinks, labelLinks, ownerRows, progressByProject] = await Promise.all([
    db
      .select({ initiativeId: initiativeProjects.initiativeId, projectId: initiativeProjects.projectId })
      .from(initiativeProjects)
      .where(inArray(initiativeProjects.initiativeId, ids))
      .all(),
    db
      .select({ initiativeId: initiativeLabels.initiativeId, id: labels.id, name: labels.name, color: labels.color })
      .from(initiativeLabels)
      .innerJoin(labels, eq(labels.id, initiativeLabels.labelId))
      .where(inArray(initiativeLabels.initiativeId, ids))
      .all(),
    db
      .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .all(),
    projectProgress(workspaceId, visibleProjects.map((project) => project.id)),
  ]);
  const ownerById = new Map(ownerRows.map((row) => [row.id, row]));

  const initiativeProjectsById = new Map<string, string[]>();
  for (const link of projectLinks) {
    if (!visibleProjectIds.has(link.projectId)) continue;
    const list = initiativeProjectsById.get(link.initiativeId) ?? [];
    list.push(link.projectId);
    initiativeProjectsById.set(link.initiativeId, list);
  }
  const labelsById = new Map<string, Label[]>();
  for (const link of labelLinks) {
    const list = labelsById.get(link.initiativeId) ?? [];
    list.push({ id: link.id, name: link.name, color: link.color });
    labelsById.set(link.initiativeId, list);
  }

  const result: Initiative[] = [];
  for (const row of rows) {
    const linkedProjects = (initiativeProjectsById.get(row.id) ?? [])
      .map((projectId) => projectById.get(projectId))
      .filter((project): project is NonNullable<typeof project> => Boolean(project));
    const progress = emptyProgress();
    const projectViews: InitiativeProjectView[] = linkedProjects.map((project) => {
      const projectStat = progressByProject.get(project.id) ?? emptyProgress();
      progress.total += projectStat.total;
      progress.done += projectStat.done;
      progress.canceled += projectStat.canceled;
      return {
        id: project.id,
        name: project.name,
        key: project.key,
        color: project.color,
        icon: project.icon,
        progress: projectStat,
      };
    });
    finishProgress(progress);
    const owner = row.ownerId ? ownerById.get(row.ownerId) : undefined;
    result.push({
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      description: row.description,
      status: row.status as InitiativeStatus,
      priority: row.priority as Priority,
      ownerId: row.ownerId ?? null,
      ownerName: owner?.displayName ?? null,
      ownerAvatar: owner?.avatar ?? null,
      targetDate: row.targetDate ?? null,
      labels: (labelsById.get(row.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      resources: parseResources(row.resources),
      projects: projectViews,
      progress,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  // Roadmap and list order: what is running first, then what is planned, then history.
  result.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31") ||
      a.name.localeCompare(b.name)
  );
  return result;
}

export async function getInitiative(
  workspaceId: string,
  initiativeId: string,
  viewerId?: string
): Promise<Initiative | null> {
  const rows = await listInitiatives(workspaceId, {}, viewerId);
  return rows.find((row) => row.id === initiativeId) ?? null;
}

export async function createInitiative(
  workspaceId: string,
  input: InitiativeInput,
  createdBy: string
): Promise<Initiative> {
  const name = asName(input.name);
  const status = input.status ? asStatus(input.status) : "proposed";
  const priority = asPriority(input.priority ?? 0);
  await assertOwner(workspaceId, input.ownerId);
  const labelIds = await assertLabelIds(workspaceId, input.labelIds ?? []);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const db = getDb();
  db.transaction((tx) => {
    tx.insert(initiatives)
      .values({
        id,
        workspaceId,
        name,
        description: asDescription(input.description),
        status,
        priority,
        ownerId: input.ownerId || null,
        targetDate: asTargetDate(input.targetDate),
        resources: JSON.stringify(normalizeResources(input.resources)),
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const labelId of labelIds) {
      tx.insert(initiativeLabels).values({ initiativeId: id, labelId }).run();
    }
  });
  const created = await getInitiative(workspaceId, id);
  if (!created) throw new TacosError("Initiative was not created", 500);
  return created;
}

export async function updateInitiative(
  workspaceId: string,
  initiativeId: string,
  input: InitiativeInput
): Promise<Initiative> {
  const [row] = await getDb()
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspaceId), eq(initiatives.id, initiativeId)))
    .limit(1);
  if (!row) throw new TacosError("Initiative not found", 404);
  if (input.ownerId !== undefined) await assertOwner(workspaceId, input.ownerId);
  const labelIds = input.labelIds === undefined ? null : await assertLabelIds(workspaceId, input.labelIds);
  const sets: Partial<typeof initiatives.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.name !== undefined) sets.name = asName(input.name);
  if (input.description !== undefined) sets.description = asDescription(input.description);
  if (input.status !== undefined) sets.status = asStatus(input.status);
  if (input.priority !== undefined) sets.priority = asPriority(input.priority);
  if (input.ownerId !== undefined) sets.ownerId = input.ownerId || null;
  if (input.targetDate !== undefined) sets.targetDate = asTargetDate(input.targetDate);
  if (input.resources !== undefined) sets.resources = JSON.stringify(normalizeResources(input.resources));
  const db = getDb();
  db.transaction((tx) => {
    tx.update(initiatives).set(sets).where(eq(initiatives.id, initiativeId)).run();
    if (labelIds !== null) {
      tx.delete(initiativeLabels).where(eq(initiativeLabels.initiativeId, initiativeId)).run();
      for (const labelId of labelIds) {
        tx.insert(initiativeLabels).values({ initiativeId, labelId }).run();
      }
    }
  });
  const updated = await getInitiative(workspaceId, initiativeId);
  if (!updated) throw new TacosError("Initiative not found", 404);
  return updated;
}

export async function deleteInitiative(workspaceId: string, initiativeId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspaceId), eq(initiatives.id, initiativeId)))
    .limit(1);
  if (!row) throw new TacosError("Initiative not found", 404);
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(initiativeProjects).where(eq(initiativeProjects.initiativeId, initiativeId)).run();
    tx.delete(initiativeLabels).where(eq(initiativeLabels.initiativeId, initiativeId)).run();
    tx.delete(initiatives).where(eq(initiatives.id, initiativeId)).run();
  });
}

/** Replace the initiative's projects as a full set, like task assignees. */
export async function setInitiativeProjects(
  workspaceId: string,
  initiativeId: string,
  projectIds: string[]
): Promise<void> {
  const [row] = await getDb()
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(and(eq(initiatives.workspaceId, workspaceId), eq(initiatives.id, initiativeId)))
    .limit(1);
  if (!row) throw new TacosError("Initiative not found", 404);
  const unique = [...new Set(projectIds)];
  if (unique.length > 0) {
    const found = await getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          inArray(projects.id, unique),
          isNull(projects.deletedAt)
        )
      );
    if (found.length !== unique.length) throw new TacosError("A project was not found in this workspace");
  }
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(initiativeProjects).where(eq(initiativeProjects.initiativeId, initiativeId)).run();
    for (const projectId of unique) {
      tx.insert(initiativeProjects).values({ initiativeId, projectId }).run();
    }
  });
}

/** Milestone markers for the roadmap, with their computed task counts. */
export async function listWorkspaceMilestones(
  workspaceId: string,
  projectIds?: string[]
): Promise<Array<RoadmapMilestone & { projectName: string; projectColor: string }>> {
  const db = getDb();
  const visible = projectIds ? new Set(projectIds) : null;
  const rows = db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      name: projectMilestones.name,
      targetDate: projectMilestones.targetDate,
      position: projectMilestones.position,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(
      and(eq(projectMilestones.workspaceId, workspaceId), isNull(projects.deletedAt))
    )
    .orderBy(asc(projectMilestones.position), asc(projectMilestones.targetDate))
    .all();
  const filtered = visible ? rows.filter((row) => visible.has(row.projectId)) : rows;
  if (filtered.length === 0) return [];
  const taskRows = db
    .select({ milestoneId: issues.milestoneId, status: issues.status })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        isNull(issues.deletedAt),
        sql`${issues.milestoneId} IS NOT NULL`
      )
    )
    .all();
  const grouped = new Map<string, Array<{ status: string }>>();
  for (const row of taskRows) {
    if (!row.milestoneId) continue;
    const list = grouped.get(row.milestoneId) ?? [];
    list.push({ status: row.status });
    grouped.set(row.milestoneId, list);
  }
  return filtered.map((row) => {
    const progress = emptyProgress();
    addProgress(progress, grouped.get(row.id) ?? []);
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      targetDate: row.targetDate ?? null,
      done: progress.done,
      total: progress.total,
      projectName: row.projectName,
      projectColor: row.projectColor,
    };
  });
}

/**
 * Compose the roadmap. Groups are initiatives in list order; visible projects without an
 * initiative land in one trailing group instead of disappearing from the plan.
 */
export function buildRoadmap(
  initiatives: Initiative[],
  projectViews: InitiativeProjectView[],
  milestones: Array<RoadmapMilestone & { projectName?: string; projectColor?: string }>
): RoadmapGroup[] {
  const milestonesByProject = new Map<string, RoadmapMilestone[]>();
  for (const milestone of milestones) {
    const list = milestonesByProject.get(milestone.projectId) ?? [];
    list.push({
      id: milestone.id,
      projectId: milestone.projectId,
      name: milestone.name,
      targetDate: milestone.targetDate,
      done: milestone.done,
      total: milestone.total,
    });
    milestonesByProject.set(milestone.projectId, list);
  }
  const withMilestones = (project: InitiativeProjectView): RoadmapProject => ({
    ...project,
    milestones: milestonesByProject.get(project.id) ?? [],
  });
  const linked = new Set<string>();
  const groups: RoadmapGroup[] = initiatives.map((initiative) => {
    for (const project of initiative.projects) linked.add(project.id);
    return {
      initiative,
      projects: initiative.projects.map(withMilestones),
    };
  });
  const unlinked = projectViews.filter((project) => !linked.has(project.id));
  if (unlinked.length > 0) {
    groups.push({ initiative: null, projects: unlinked.map(withMilestones) });
  }
  return groups;
}

/** Projects and their progress for the roadmap (visible to the viewer). */
export async function projectViewsForRoadmap(
  workspaceId: string,
  viewerId?: string
): Promise<InitiativeProjectView[]> {
  const visible = await listProjects(workspaceId, viewerId);
  const progress = await projectProgress(workspaceId, visible.map((project) => project.id));
  return visible.map((project) => ({
    id: project.id,
    name: project.name,
    key: project.key,
    color: project.color,
    icon: project.icon,
    progress: progress.get(project.id) ?? emptyProgress(),
  }));
}
