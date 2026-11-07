"use server";

import { invalidatePath as revalidatePath } from "@/lib/revalidation";
import { requireAdmin, requireWorkspace } from "@/lib/auth";
import {
  assertSeesIssue,
  assertSeesProject,
  TacosError,
  updateIssue,
} from "@/lib/issues";
import {
  assignIssuesToCycle,
  completeCycle,
  createCycle,
  saveCycleSettings,
  syncCycleLifecycle,
  type CycleSettingsInput,
} from "@/lib/planning/cycles";
import {
  createMilestone,
  deleteMilestone,
  moveMilestone,
  updateMilestone,
  type MilestoneInput,
} from "@/lib/planning/milestones";
import {
  createInitiative,
  deleteInitiative,
  getInitiative,
  setInitiativeProjects,
  updateInitiative,
  type InitiativeInput,
} from "@/lib/planning/initiatives";
import type { ActionResult } from "./actions";

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

function refresh(workspaceId: string, projectId?: string) {
  revalidatePath(`/${workspaceId}/planning`);
  if (projectId) {
    revalidatePath(`/${workspaceId}/projects/${projectId}`);
    revalidatePath(`/${workspaceId}/projects/${projectId}/issues`);
  }
  revalidatePath(`/${workspaceId}`);
}

function userActor(user: { id: string; displayName: string }) {
  return { kind: "user" as const, userId: user.id, displayName: user.displayName };
}

/** Cycle configuration is workspace config, so the admin gate matches workspace settings. */
export async function saveCycleSettingsAction(
  workspaceId: string,
  input: CycleSettingsInput
): Promise<ActionResult<Awaited<ReturnType<typeof saveCycleSettings>>>> {
  return run(async () => {
    const { user } = await requireAdmin(workspaceId);
    const settings = await saveCycleSettings(workspaceId, input, user.id);
    refresh(workspaceId);
    return settings;
  });
}

export async function completeCycleAction(
  workspaceId: string,
  cycleId: string
): Promise<ActionResult<Awaited<ReturnType<typeof completeCycle>>>> {
  return run(async () => {
    const { user } = await requireAdmin(workspaceId);
    const result = await completeCycle(workspaceId, cycleId, userActor(user));
    refresh(workspaceId);
    return result;
  });
}

export async function createCycleAction(
  workspaceId: string,
  input: { startsAt: string; endsAt: string; name?: string }
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { user } = await requireAdmin(workspaceId);
    const cycle = await createCycle(workspaceId, input, user.id);
    refresh(workspaceId);
    return { id: cycle.id };
  });
}

/**
 * Add tasks to a cycle (or take them out with `cycleId: null`). Each task keeps its own
 * visibility check, and the result reports skipped tasks instead of failing the batch.
 */
export async function planIssuesAction(
  workspaceId: string,
  cycleId: string | null,
  issueIds: string[]
): Promise<ActionResult<{ moved: number; skipped: number }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    for (const issueId of issueIds) await assertSeesIssue(workspaceId, issueId, user.id);
    const result = await assignIssuesToCycle(workspaceId, cycleId, issueIds, userActor(user));
    refresh(workspaceId);
    return result;
  });
}

/** Run the lazy sweep on demand, e.g. after an admin changes the dates. */
export async function syncCyclesAction(workspaceId: string): Promise<ActionResult<Awaited<ReturnType<typeof syncCycleLifecycle>>>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const result = await syncCycleLifecycle(workspaceId, { actorId: user.id });
    refresh(workspaceId);
    return result;
  });
}

// --- milestones ---

export async function createMilestoneAction(
  workspaceId: string,
  projectId: string,
  input: MilestoneInput
): Promise<ActionResult<Awaited<ReturnType<typeof createMilestone>>>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const milestone = await createMilestone(workspaceId, projectId, input, user.id);
    refresh(workspaceId, projectId);
    return milestone;
  });
}

export async function updateMilestoneAction(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
  input: Partial<MilestoneInput>
): Promise<ActionResult<Awaited<ReturnType<typeof updateMilestone>>>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const milestone = await updateMilestone(workspaceId, projectId, milestoneId, input);
    refresh(workspaceId, projectId);
    return milestone;
  });
}

export async function deleteMilestoneAction(
  workspaceId: string,
  projectId: string,
  milestoneId: string
): Promise<ActionResult<{ detached: number }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const result = await deleteMilestone(workspaceId, projectId, milestoneId, userActor(user));
    refresh(workspaceId, projectId);
    return result;
  });
}

export async function moveMilestoneAction(
  workspaceId: string,
  projectId: string,
  milestoneId: string,
  direction: "up" | "down"
): Promise<ActionResult<Awaited<ReturnType<typeof moveMilestone>>>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const milestones = await moveMilestone(workspaceId, projectId, milestoneId, direction);
    refresh(workspaceId, projectId);
    return milestones;
  });
}

export async function setIssueMilestoneAction(
  workspaceId: string,
  issueId: string,
  milestoneId: string | null
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, issueId, user.id);
    const detail = await updateIssue(workspaceId, issueId, { milestoneId }, userActor(user));
    refresh(workspaceId, detail.issue.projectId);
    return { id: detail.issue.id };
  });
}

// --- initiatives ---

export async function createInitiativeAction(
  workspaceId: string,
  input: InitiativeInput,
  projectIds: string[] = []
): Promise<ActionResult<Awaited<ReturnType<typeof createInitiative>>>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const initiative = await createInitiative(workspaceId, input, user.id);
    if (projectIds.length > 0) await setInitiativeProjects(workspaceId, initiative.id, projectIds);
    refresh(workspaceId);
    return (await getInitiative(workspaceId, initiative.id)) ?? initiative;
  });
}

export async function updateInitiativeAction(
  workspaceId: string,
  initiativeId: string,
  input: InitiativeInput,
  projectIds?: string[]
): Promise<ActionResult<Awaited<ReturnType<typeof updateInitiative>>>> {
  return run(async () => {
    await requireWorkspace(workspaceId);
    const initiative = await updateInitiative(workspaceId, initiativeId, input);
    if (projectIds !== undefined) await setInitiativeProjects(workspaceId, initiativeId, projectIds);
    refresh(workspaceId);
    return (await getInitiative(workspaceId, initiativeId)) ?? initiative;
  });
}

export async function deleteInitiativeAction(
  workspaceId: string,
  initiativeId: string
): Promise<ActionResult<{ deleted: true }>> {
  return run(async () => {
    const { user, role } = await requireWorkspace(workspaceId);
    const initiative = await getInitiative(workspaceId, initiativeId);
    if (!initiative) throw new TacosError("Initiative not found", 404);
    if (role !== "admin" && initiative.createdBy !== user.id) {
      throw new TacosError("Only the initiative creator or a workspace admin can delete it", 403);
    }
    await deleteInitiative(workspaceId, initiativeId);
    refresh(workspaceId);
    return { deleted: true as const };
  });
}
