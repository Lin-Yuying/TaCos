import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "../../db/client";
import { issues, projectMilestones, projects } from "../../db/schema";
import { listIssues, updateIssue, type IssueWithLabels, type MutationActor } from "../issues";
import { TacosError } from "../tacos-error";
import { normalizeDay } from "./dates";

/**
 * U-03 milestones are project-level only (plan decision 2). A milestone carries a name,
 * an optional target date and a plan order; its progress is always computed from the
 * tasks attached through `issues.milestone_id`, never stored.
 */

export type MilestoneProgress = {
  // Tasks counted in progress: everything except canceled.
  total: number;
  done: number;
  open: number;
  canceled: number;
  percent: number;
  estimate: number;
};

export type Milestone = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string;
  targetDate: string | null;
  position: number;
  createdAt: string;
  progress: MilestoneProgress;
  // The first milestone that is not finished yet, ordered by plan position.
  current: boolean;
};

export type MilestoneInput = {
  name: string;
  description?: string;
  targetDate?: string | null;
};

export type ProjectTimeline = {
  milestones: Milestone[];
  issues: IssueWithLabels[];
};

function emptyProgress(): MilestoneProgress {
  return { total: 0, done: 0, open: 0, canceled: 0, percent: 0, estimate: 0 };
}

function progressOf(rows: Array<{ status: string; estimate: number | null }>): MilestoneProgress {
  const progress = emptyProgress();
  for (const row of rows) {
    if (row.status === "canceled") {
      progress.canceled += 1;
      continue;
    }
    progress.total += 1;
    if (row.status === "done") progress.done += 1;
    else progress.open += 1;
    if (row.estimate) progress.estimate += row.estimate;
  }
  progress.percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  progress.estimate = Math.round(progress.estimate * 100) / 100;
  return progress;
}

async function assertProject(workspaceId: string, projectId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt))
    )
    .limit(1);
  if (!row) throw new TacosError("Project not found", 404);
}

function normalizeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new TacosError("Milestone name is required");
  if (name.length > 200) throw new TacosError("Milestone name must be at most 200 characters");
  return name;
}

function normalizeDescription(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text.length > 4_000) throw new TacosError("Milestone description must be at most 4000 characters");
  return text;
}

function normalizeTarget(value: unknown): string | null {
  try {
    return normalizeDay(value);
  } catch {
    throw new TacosError("Target date must be a calendar date (YYYY-MM-DD)");
  }
}

export async function listProjectMilestones(
  workspaceId: string,
  projectId: string
): Promise<Milestone[]> {
  const db = getDb();
  const rows = db
    .select()
    .from(projectMilestones)
    .where(
      and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId))
    )
    .orderBy(asc(projectMilestones.position), asc(projectMilestones.createdAt))
    .all();
  if (rows.length === 0) return [];
  const taskRows = db
    .select({ milestoneId: issues.milestoneId, status: issues.status, estimate: issues.estimate })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        sql`${issues.milestoneId} IS NOT NULL`
      )
    )
    .all();
  const grouped = new Map<string, Array<{ status: string; estimate: number | null }>>();
  for (const row of taskRows) {
    if (!row.milestoneId) continue;
    const list = grouped.get(row.milestoneId) ?? [];
    list.push({ status: row.status, estimate: row.estimate });
    grouped.set(row.milestoneId, list);
  }
  const milestones = rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate ?? null,
    position: row.position,
    createdAt: row.createdAt,
    progress: progressOf(grouped.get(row.id) ?? []),
    current: false,
  }));
  const current = milestones.find((milestone) => milestone.progress.percent < 100);
  if (current) current.current = true;
  return milestones;
}

export async function createMilestone(
  workspaceId: string,
  projectId: string,
  input: MilestoneInput,
  createdBy: string | null
): Promise<Milestone> {
  await assertProject(workspaceId, projectId);
  const name = normalizeName(input.name);
  const db = getDb();
  const last = db
    .select({ position: sql<number>`COALESCE(MAX(${projectMilestones.position}), 0)` })
    .from(projectMilestones)
    .where(
      and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId))
    )
    .get();
  const id = crypto.randomUUID();
  db.insert(projectMilestones)
    .values({
      id,
      workspaceId,
      projectId,
      name,
      description: normalizeDescription(input.description),
      targetDate: normalizeTarget(input.targetDate),
      position: Number(last?.position ?? 0) + 1,
      createdBy,
      createdAt: new Date().toISOString(),
    })
    .run();
  const milestones = await listProjectMilestones(workspaceId, projectId);
  const created = milestones.find((milestone) => milestone.id === id);
  if (!created) throw new TacosError("Milestone was not created", 500);
  return created;
}

export async function updateMilestone(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
  input: Partial<MilestoneInput>
): Promise<Milestone> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.workspaceId, workspaceId),
        eq(projectMilestones.projectId, projectId)
      )
    )
    .limit(1);
  if (!row) throw new TacosError("Milestone not found", 404);
  const sets: Partial<typeof projectMilestones.$inferInsert> = {};
  if (input.name !== undefined) sets.name = normalizeName(input.name);
  if (input.description !== undefined) sets.description = normalizeDescription(input.description);
  if (input.targetDate !== undefined) sets.targetDate = normalizeTarget(input.targetDate);
  if (Object.keys(sets).length > 0) {
    db.update(projectMilestones).set(sets).where(eq(projectMilestones.id, milestoneId)).run();
  }
  const milestones = await listProjectMilestones(workspaceId, projectId);
  const updated = milestones.find((milestone) => milestone.id === milestoneId);
  if (!updated) throw new TacosError("Milestone not found", 404);
  return updated;
}

/** Deleting a milestone detaches its tasks first; the tasks themselves stay. */
export async function deleteMilestone(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
  actor: MutationActor
): Promise<{ detached: number }> {
  const [row] = await getDb()
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.workspaceId, workspaceId),
        eq(projectMilestones.projectId, projectId)
      )
    )
    .limit(1);
  if (!row) throw new TacosError("Milestone not found", 404);
  const tasks = await listIssues(workspaceId, { projectId, milestoneId, status: "all", summary: true });
  let detached = 0;
  for (const task of tasks) {
    await updateIssue(workspaceId, task.id, { milestoneId: null }, actor);
    detached += 1;
  }
  await getDb().delete(projectMilestones).where(eq(projectMilestones.id, milestoneId));
  return { detached };
}

/** Reorder the plan. Positions are swapped so the list stays contiguous. */
export async function moveMilestone(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
  direction: "up" | "down"
): Promise<Milestone[]> {
  const db = getDb();
  const rows = db
    .select({ id: projectMilestones.id, position: projectMilestones.position })
    .from(projectMilestones)
    .where(
      and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId))
    )
    .orderBy(asc(projectMilestones.position), asc(projectMilestones.createdAt))
    .all();
  const index = rows.findIndex((row) => row.id === milestoneId);
  if (index < 0) throw new TacosError("Milestone not found", 404);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target >= 0 && target < rows.length) {
    db.transaction((tx) => {
      // Normalize first so two milestones created before ordering existed always differ.
      rows.forEach((row, at) => {
        tx.update(projectMilestones)
          .set({ position: at + 1 })
          .where(eq(projectMilestones.id, row.id))
          .run();
      });
      tx.update(projectMilestones)
        .set({ position: target + 1 })
        .where(eq(projectMilestones.id, rows[index].id))
        .run();
      tx.update(projectMilestones)
        .set({ position: index + 1 })
        .where(eq(projectMilestones.id, rows[target].id))
        .run();
    });
  }
  return listProjectMilestones(workspaceId, projectId);
}

/** Load the project's milestones and its tasks for the Timeline tab. */
export async function projectTimeline(
  workspaceId: string,
  projectId: string,
  viewerId?: string
): Promise<ProjectTimeline> {
  const [milestones, tasks] = await Promise.all([
    listProjectMilestones(workspaceId, projectId),
    listIssues(workspaceId, { projectId, status: "all", viewerId, summary: true, limit: 500 }),
  ]);
  return { milestones, issues: tasks };
}

/** The milestone options for a task's project, ordered like the project timeline. */
export async function milestoneChoices(
  workspaceId: string,
  projectId: string
): Promise<Array<{ id: string; name: string; targetDate: string | null }>> {
  const rows = await getDb()
    .select({
      id: projectMilestones.id,
      name: projectMilestones.name,
      targetDate: projectMilestones.targetDate,
    })
    .from(projectMilestones)
    .where(
      and(eq(projectMilestones.workspaceId, workspaceId), eq(projectMilestones.projectId, projectId))
    )
    .orderBy(asc(projectMilestones.position), desc(projectMilestones.createdAt))
    .all();
  return rows;
}
