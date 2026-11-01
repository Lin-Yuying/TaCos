"use server";

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
