"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireWorkspace } from "@/lib/auth";
import { draftTask, generateTasks, saveAiSettings, testAiConnection } from "@/lib/ai";
import { getProject, TacosError } from "@/lib/issues";
import type { AiEngine, AiSettingsView, AiTaskDraft } from "@/lib/ai-constants";
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

export async function saveAiSettingsAction(
  workspaceId: string,
  input: {
    engine: AiEngine;
    proxy?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    enabled: boolean;
  }
): Promise<ActionResult<AiSettingsView>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    return saveAiSettings(workspaceId, input);
  });
}

export async function testAiConnectionAction(
  workspaceId: string,
  input?: { baseUrl?: string; model?: string; apiKey?: string }
): Promise<ActionResult<{ model: string; sample: string }>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    return testAiConnection(workspaceId, input);
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
    await requireWorkspace(workspaceId);
    return generateTasks({
      workspaceId,
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
    await requireWorkspace(workspaceId);
    return draftTask({
      workspaceId,
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
    await requireAdmin(workspaceId);
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
    const view = await refreshHarnessSettingsView(workspaceId);
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
  workspaceId: string
): Promise<
  ActionResult<{
    rows: import("@/lib/harness/types").HarnessStatus[];
  }>
> {
  return run(async () => {
    await requireAdmin(workspaceId);
    const {
      getHarnessSettingsView,
      checkAllHarnessUpdates,
    } = await import("@/lib/harness");
    const view = await getHarnessSettingsView(workspaceId);
    const currentById = Object.fromEntries(view.rows.map((row) => [row.id, row.version])) as Record<
      string,
      string | null
    >;
    const updates = await checkAllHarnessUpdates(currentById);
    const byId = new Map(updates.map((item) => [item.id, item]));
    const rows = view.rows.map((row) => {
      const info = byId.get(row.id);
      return {
        ...row,
        latestVersion: info?.latest ?? null,
        updateAvailable: info?.updateAvailable ?? false,
      };
    });
    return { rows };
  });
}
