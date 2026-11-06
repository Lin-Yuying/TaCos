"use server";
import { requireWorkspace } from "@/lib/auth";
import {
  canManageTaskTemplates,
  createTaskTemplate,
  deleteTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate,
  type TaskTemplateInput,
} from "@/lib/task-templates";
import type { ActionResult } from "./actions";

async function run<T>(work: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save. Retry." };
  }
}

export async function listTaskTemplatesAction(ws: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return {
      templates: listTaskTemplates(ws),
      canManage: canManageTaskTemplates(ws, user.id),
    };
  });
}

export async function createTaskTemplateAction(ws: string, input: TaskTemplateInput) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return createTaskTemplate(ws, user.id, input);
  });
}

export async function updateTaskTemplateAction(ws: string, id: string, input: TaskTemplateInput) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return updateTaskTemplate(ws, user.id, id, input);
  });
}

export async function deleteTaskTemplateAction(ws: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    deleteTaskTemplate(ws, user.id, id);
  });
}
