"use server";
import { requireWorkspace } from "@/lib/auth";
import {
  clearDefaultTaskView,
  createTaskView,
  defaultTaskView,
  deleteTaskView,
  duplicateTaskView,
  getTaskView,
  listTaskViews,
  resetTaskViewOverride,
  saveTaskViewDefinition,
  setDefaultTaskView,
  setTaskViewFavorite,
  toggleTaskViewFavorite,
  updateTaskView,
  type ListTaskViewsOptions,
  type SaveTaskViewInput,
} from "@/lib/task-views";
import type { ActionResult } from "./actions";

async function run<T>(work: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save. Retry.",
    };
  }
}

export async function listTaskViewsAction(ws: string, options: ListTaskViewsOptions = {}) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return listTaskViews(ws, user.id, options);
  });
}

export async function getTaskViewAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return getTaskView(ws, user.id, id);
  });
}

export async function defaultTaskViewAction(
  ws: string,
  scope: "workspace" | "project",
  projectId?: string | null
) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return defaultTaskView(ws, user.id, scope, projectId);
  });
}

export async function createTaskViewAction(ws: string, input: SaveTaskViewInput) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return createTaskView(ws, user.id, input);
  });
}

export async function updateTaskViewAction(
  ws: string,
  id: string,
  patch: { name?: string; shared?: boolean }
) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return updateTaskView(ws, user.id, id, patch);
  });
}

export async function saveTaskViewDefinitionAction(ws: string, id: string, definition: unknown) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return saveTaskViewDefinition(ws, user.id, id, definition);
  });
}

export async function resetTaskViewOverrideAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return resetTaskViewOverride(ws, user.id, id);
  });
}

export async function setDefaultTaskViewAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return setDefaultTaskView(ws, user.id, id);
  });
}

export async function clearDefaultTaskViewAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return clearDefaultTaskView(ws, user.id, id);
  });
}

export async function duplicateTaskViewAction(ws: string, id: string, context?: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return duplicateTaskView(ws, user.id, id, { context });
  });
}

export async function deleteTaskViewAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    deleteTaskView(ws, user.id, id);
  });
}

export async function setTaskViewFavoriteAction(ws: string, id: string, favorite: boolean) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return setTaskViewFavorite(ws, user.id, id, favorite);
  });
}

export async function toggleTaskViewFavoriteAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return toggleTaskViewFavorite(ws, user.id, id);
  });
}
