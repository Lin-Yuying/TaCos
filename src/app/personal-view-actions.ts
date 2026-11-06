"use server";
import { requireWorkspace } from "@/lib/auth";
import {
  listPersonalViews,
  savePersonalView,
  deletePersonalView,
} from "@/lib/personal-views";
import type { ActionResult } from "@/app/actions";
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save. Retry.",
    };
  }
}
export async function listPersonalViewsAction(ws: string, scope: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return listPersonalViews(ws, user.id, scope);
  });
}
export async function savePersonalViewAction(
  ws: string,
  scope: string,
  name: string,
  value: unknown,
) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return savePersonalView(ws, user.id, scope, name, value);
  });
}
export async function deletePersonalViewAction(
  ws: string,
  scope: string,
  name: string,
) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    return deletePersonalView(ws, user.id, scope, name);
  });
}
