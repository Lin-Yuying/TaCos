"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireWorkspace } from "@/lib/auth";
import { draftTask, generateTasks, saveAgentRuntime } from "@/lib/ai";
import {
  getModelKeysView,
  harnessesWithKeys,
  removeModelEndpoint,
  saveEditModel,
  saveModelEndpoint,
} from "@/lib/model-keys";
import { getProject, TacosError } from "@/lib/issues";
import type { AiSettingsView, AiTaskDraft, ModelKeysView } from "@/lib/ai-constants";
import type { ActionResult } from "./actions";

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof TacosError) {
      return {
        ok: false,
        error: err.hint ? `${err.message} — ${err.hint}` : err.message,
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function saveAgentRuntimeAction(
  workspaceId: string,
  input: { proxy?: string }
): Promise<ActionResult<AiSettingsView>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    return saveAgentRuntime(workspaceId, input);
  });
}

// A key only ever belongs to whoever is signed in: no action takes a user id from the browser.
async function refreshModelViews(workspaceId: string, userId: string): Promise<ModelKeysView> {
  revalidatePath(`/${workspaceId}`, "layout");
  return getModelKeysView(userId);
}

export async function saveModelEndpointAction(
  workspaceId: string,
  input: { id?: string; label: string; baseUrl: string; key: string; models: string }
): Promise<ActionResult<{ view: ModelKeysView; verified: boolean }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const { verified } = await saveModelEndpoint(user.id, input);
    return { view: await refreshModelViews(workspaceId, user.id), verified };
  });
}

export async function removeModelEndpointAction(
  workspaceId: string,
  id: string
): Promise<ActionResult<ModelKeysView>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await removeModelEndpoint(user.id, id);
    return refreshModelViews(workspaceId, user.id);
  });
}

export async function saveEditModelAction(
  workspaceId: string,
  id: string,
  model: string
): Promise<ActionResult<ModelKeysView>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await saveEditModel(user.id, id, model);
    return refreshModelViews(workspaceId, user.id);
  });
}

async function projectLabel(workspaceId: string, projectId?: string): Promise<string | undefined> {
  if (!projectId) return undefined;
  const project = await getProject(workspaceId, projectId);
  return project ? `${project.name} (${project.key})` : undefined;
}

export async function generateTasksAction(
  workspaceId: string,
  input: { prompt: string; projectId?: string; context?: string }
): Promise<ActionResult<AiTaskDraft[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return generateTasks({
      workspaceId,
      userId: user.id,
      prompt: input.prompt,
      context: input.context,
      project: await projectLabel(workspaceId, input.projectId),
    });
  });
}

export async function draftIssueAction(
  workspaceId: string,
  input: { prompt: string; projectId?: string }
): Promise<ActionResult<AiTaskDraft>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return draftTask({
      workspaceId,
      userId: user.id,
      prompt: input.prompt,
      project: await projectLabel(workspaceId, input.projectId),
    });
  });
}

export async function setHarnessEnabledAction(
  workspaceId: string,
  id: string,
  enabled: boolean
): Promise<ActionResult<{ id: string; enabled: boolean }>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    const { setHarnessEnabled, FIRST_CLASS_HARNESS_IDS } = await import("@/lib/harness");
    if (!(FIRST_CLASS_HARNESS_IDS as readonly string[]).includes(id)) {
      throw new Error("Unknown harness");
    }
    await setHarnessEnabled(workspaceId, id as import("@/lib/harness").HarnessId, enabled);
    revalidatePath(`/${workspaceId}/settings`, "page");
    revalidatePath(`/${workspaceId}/agent`, "page");
    return { id, enabled };
  });
}


export async function runHarnessInstallAction(
  workspaceId: string,
  id: string,
  mode: "install" | "upgrade"
): Promise<
  ActionResult<{
    ok: boolean;
    message: string;
    version: string | null;
    rows: import("@/lib/harness/types").HarnessStatus[];
  }>
> {
  return run(async () => {
    const { user } = await requireAdmin(workspaceId);
    const {
      FIRST_CLASS_HARNESS_IDS,
      runHarnessInstall,
      runHarnessUpgrade,
      refreshHarnessSettingsView,
    } = await import("@/lib/harness");
    if (!(FIRST_CLASS_HARNESS_IDS as readonly string[]).includes(id)) {
      throw new Error("Unknown harness");
    }
    const harnessId = id as import("@/lib/harness").HarnessId;
    const result = mode === "upgrade" ? await runHarnessUpgrade(harnessId) : await runHarnessInstall(harnessId);
    const view = await refreshHarnessSettingsView(workspaceId, await harnessesWithKeys(user.id));
    revalidatePath(`/${workspaceId}/settings`, "page");
    revalidatePath(`/${workspaceId}/agent`, "page");
    return {
      ok: result.ok,
      message: result.message,
      version: result.version ?? null,
      rows: view.rows,
    };
  });
}

export async function checkHarnessUpdatesAction(
  workspaceId: string,
  force = false
): Promise<
  ActionResult<{
    rows: import("@/lib/harness/types").HarnessStatus[];
  }>
> {
  return run(async () => {
    const { user } = await requireAdmin(workspaceId);
    const {
      getHarnessSettingsView,
      checkAllHarnessUpdates,
    } = await import("@/lib/harness");
    const view = await getHarnessSettingsView(workspaceId, await harnessesWithKeys(user.id));
    const currentById = Object.fromEntries(view.rows.map((row) => [row.id, row.version])) as Record<
      string,
      string | null
    >;
    const updates = await checkAllHarnessUpdates(currentById, force);
    const byId = new Map(updates.map((item) => [item.id, item]));
    const rows = view.rows.map((row) => {
      const info = byId.get(row.id);
      return {
        ...row,
        latestVersion: info?.latest ?? null,
        updateAvailable: info?.updateAvailable ?? false,
        updateCheckFailed: Boolean(info?.error),
      };
    });
    return { rows };
  });
}
