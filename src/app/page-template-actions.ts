"use server";
import { requireWorkspace } from "@/lib/auth";
import {
  canManagePageTemplates,
  createPageFromTemplate,
  createPageTemplate,
  deletePageTemplate,
  listPageTemplates,
  updatePageTemplate,
  type PageTemplateInput,
} from "@/lib/page-templates";
import type { ActionResult } from "./actions";

async function run<T>(work: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save. Retry." };
  }
}

/** Templates a new document can start from, plus whether this member may edit the list. */
export async function listPageTemplatesAction(workspaceId: string) {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return {
      templates: listPageTemplates(workspaceId),
      canManage: canManagePageTemplates(workspaceId, user.id),
    };
  });
}

export async function createPageTemplateAction(workspaceId: string, input: PageTemplateInput) {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return createPageTemplate(workspaceId, user.id, input);
  });
}

export async function updatePageTemplateAction(
  workspaceId: string,
  id: string,
  input: PageTemplateInput
) {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return updatePageTemplate(workspaceId, user.id, id, input);
  });
}

export async function deletePageTemplateAction(workspaceId: string, id: string) {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    deletePageTemplate(workspaceId, user.id, id);
  });
}

export async function createPageFromTemplateAction(
  workspaceId: string,
  templateId: string,
  options: { parentId?: string | null; projectId?: string | null } = {}
) {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return createPageFromTemplate(workspaceId, user.id, templateId, options);
  });
}
