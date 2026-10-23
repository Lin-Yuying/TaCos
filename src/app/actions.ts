"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireWorkspace } from "@/lib/auth";
import {
  addComment,
  addProjectMember,
  createApiKey,
  createIssue,
  createLabel,
  createProject,
  deleteIssue,
  deleteLabel,
  purgeIssue,
  purgeProject,
  removeProjectMember,
  restoreIssue,
  restoreProject,
  revokeApiKey,
  setWorkspaceIcon,
  TacosError,
  toggleFavoriteProject,
  trashProject,
  updateIssue,
  updateProject,
  type CreateIssueInput,
  type IssueDetail,
  type IssueWithLabels,
  type Label,
  type Project,
  type UpdateIssueInput,
} from "@/lib/issues";

function refresh(workspaceId: string) {
  revalidatePath(`/${workspaceId}`, "layout");
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

function userActor(user: { id: string; displayName: string }) {
  return { kind: "user" as const, userId: user.id, displayName: user.displayName };
}

export async function createIssueAction(workspaceId: string, input: CreateIssueInput) {
  return run<IssueWithLabels>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const result = await createIssue(workspaceId, input, userActor(user));
    refresh(workspaceId);
    return result.issue;
  });
}

export async function updateIssueAction(workspaceId: string, idOrIdentifier: string, patch: UpdateIssueInput) {
  return run<IssueWithLabels>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const result = await updateIssue(workspaceId, idOrIdentifier, patch, userActor(user));
    refresh(workspaceId);
    return result.issue;
  });
}

export async function updateIssueDetailAction(
  workspaceId: string,
  idOrIdentifier: string,
  patch: UpdateIssueInput
) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const result = await updateIssue(workspaceId, idOrIdentifier, patch, userActor(user));
    refresh(workspaceId);
    return result;
  });
}

export async function deleteIssueAction(workspaceId: string, idOrIdentifier: string) {
  return run<string>(async () => {
    await requireWorkspace(workspaceId);
    const deleted = await deleteIssue(workspaceId, idOrIdentifier);
    refresh(workspaceId);
    return deleted.id;
  });
}

export async function restoreIssueAction(workspaceId: string, issueId: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await restoreIssue(workspaceId, issueId);
    refresh(workspaceId);
  });
}

export async function purgeIssueAction(workspaceId: string, issueId: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await purgeIssue(workspaceId, issueId);
    refresh(workspaceId);
  });
}

export async function addCommentAction(workspaceId: string, idOrIdentifier: string, body: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const result = await addComment(workspaceId, idOrIdentifier, body, userActor(user));
    refresh(workspaceId);
    return result;
  });
}

export async function createProjectAction(
  workspaceId: string,
  input: { name: string; description?: string }
) {
  return run<Project>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const project = await createProject({ workspaceId, createdBy: user.id, ...input });
    refresh(workspaceId);
    return project;
  });
}

export async function updateProjectAction(
  workspaceId: string,
  projectId: string,
  patch: { name?: string; description?: string; doc?: string; color?: string }
) {
  return run<Project>(async () => {
    await requireWorkspace(workspaceId);
    const project = await updateProject(workspaceId, projectId, patch);
    refresh(workspaceId);
    return project;
  });
}

export async function addProjectMemberAction(workspaceId: string, projectId: string, userId: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await addProjectMember(workspaceId, projectId, userId);
    refresh(workspaceId);
  });
}

export async function removeProjectMemberAction(
  workspaceId: string,
  projectId: string,
  userId: string
) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await removeProjectMember(workspaceId, projectId, userId);
    refresh(workspaceId);
  });
}

// One control for both directions: the star is per-user, so it only needs workspace
// membership. Returns the state the star ended up in.
export async function toggleProjectFavoriteAction(workspaceId: string, projectId: string) {
  return run<boolean>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const favorite = await toggleFavoriteProject(workspaceId, user.id, projectId);
    refresh(workspaceId);
    return favorite;
  });
}

export async function trashProjectAction(workspaceId: string, projectId: string) {  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await trashProject(workspaceId, projectId, user.id);
    refresh(workspaceId);
  });
}

export async function restoreProjectAction(workspaceId: string, projectId: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await restoreProject(workspaceId, projectId);
    refresh(workspaceId);
  });
}

export async function purgeProjectAction(workspaceId: string, projectId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await purgeProject(workspaceId, projectId, user.id);
    refresh(workspaceId);
  });
}

// Clients resize to 128x128 first, so the cap only has to catch abuse.
const MAX_ICON_CHARS = 300_000;
const ICON_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export async function saveWorkspaceIconAction(workspaceId: string, icon: string | null) {
  return run<string | null>(async () => {
    await requireAdmin(workspaceId);
    let stored: string | null = null;
    if (icon != null) {
      if (!ICON_DATA_URL.test(icon) || icon.length > MAX_ICON_CHARS) {
        throw new TacosError("Icon must be a PNG, JPEG or WebP image under 200 KB");
      }
      stored = icon;
    }
    await setWorkspaceIcon(workspaceId, stored);
    refresh(workspaceId);
    return stored;
  });
}

export async function createLabelAction(workspaceId: string, input: { name: string; color?: string }) {
  return run<Label>(async () => {
    await requireWorkspace(workspaceId);
    const label = await createLabel(workspaceId, input);
    refresh(workspaceId);
    return label;
  });
}

export async function deleteLabelAction(workspaceId: string, id: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await deleteLabel(workspaceId, id);
    refresh(workspaceId);
  });
}

export async function createApiKeyAction(workspaceId: string, name: string) {
  return run<{ key: string }>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const { key } = await createApiKey(workspaceId, name, user.id);
    refresh(workspaceId);
    return { key };
  });
}

export async function revokeApiKeyAction(workspaceId: string, id: string) {
  return run<void>(async () => {
    await requireWorkspace(workspaceId);
    await revokeApiKey(workspaceId, id);
    refresh(workspaceId);
  });
}
