"use server";

import { changeIssueCollection } from "@/lib/issues";

import { createTaskField, deleteTaskField, setTaskFieldValue, taskFieldImpact, restoreTaskField } from "@/lib/task-fields";
import type { TaskField } from "@/lib/task-view";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireWorkspace } from "@/lib/auth";
import {
  assertSeesIssue,
  assertSeesProject,
  addComment,
  addOverviewComment,
  addProjectMember,
  claimIssue,
  getIssueDetail,
  transferClaim,
  createApiKey,
  createIssue,
  createLabel,
  createProject,
  deleteIssue,
  deleteLabel,
  moveIssue,
  markDocEditsSeen,
  purgeIssue,
  purgeProject,
  removeOverviewComment,
  removeOverviewGrant,
  releaseIssue,
  reportBlocker,
  addDependency,
  removeDependency,
  removeProjectMember,
  restoreIssue,
  reviewIssue,
  restoreOverviewDocEdit,
  restoreProject,
  revokeApiKey,
  setMembersSeeAllTasks,
  setOverviewGrant,
  setWorkspaceIcon,
  TacosError,
  toggleFavoriteProject,
  trashProject,
  updateIssue,
  updateProject,
  type CreateIssueInput,
  type ReviewDecision,
  type IssueDetail,
  type IssueWithLabels,
  type Label,
  type MoveIssueInput,
  type OverviewComment,
  type OverviewRole,
  type Project,
  type UpdateIssueInput,
} from "@/lib/issues";
import {
  addProjectDoc,
  addProjectLink,
  removeProjectResource,
  type ProjectResource,
} from "@/lib/resources";

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
    await assertSeesProject(workspaceId, input.project, user.id);
    const result = await createIssue(workspaceId, input, userActor(user));
    refresh(workspaceId);
    return result.issue;
  });
}

export async function updateIssueAction(workspaceId: string, idOrIdentifier: string, patch: UpdateIssueInput) {
  return run<IssueWithLabels>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await updateIssue(workspaceId, idOrIdentifier, patch, userActor(user));
    refresh(workspaceId);
    return result.issue;
  });
}

export async function getIssueDetailAction(workspaceId: string, id: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return claimedDetail(workspaceId, id, user.id);
  });
}

export async function updateIssueDetailAction(
  workspaceId: string,
  idOrIdentifier: string,
  patch: UpdateIssueInput
) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await updateIssue(workspaceId, idOrIdentifier, patch, userActor(user));
    refresh(workspaceId);
    return result;
  });
}

export async function moveIssueAction(
  workspaceId: string,
  idOrIdentifier: string,
  input: MoveIssueInput
) {
  return run<IssueWithLabels>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await moveIssue(workspaceId, idOrIdentifier, input, userActor(user));
    refresh(workspaceId);
    return result.issue;
  });
}

// Claim actions return the fresh task detail so the open panel can show the new claimer.
async function claimedDetail(workspaceId: string, id: string, viewerId: string): Promise<IssueDetail> {
  const detail = await getIssueDetail(workspaceId, id, viewerId);
  if (!detail) throw new TacosError("Task not found", 404);
  return detail;
}

export async function claimIssueAction(workspaceId: string, idOrIdentifier: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await claimIssue(workspaceId, idOrIdentifier, user.id);
    refresh(workspaceId);
    return claimedDetail(workspaceId, result.id, user.id);
  });
}

export async function releaseIssueAction(workspaceId: string, idOrIdentifier: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await releaseIssue(workspaceId, idOrIdentifier, user.id);
    refresh(workspaceId);
    return claimedDetail(workspaceId, result.id, user.id);
  });
}

export async function transferClaimAction(workspaceId: string, idOrIdentifier: string, toUserId: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await transferClaim(workspaceId, idOrIdentifier, user.id, toUserId);
    refresh(workspaceId);
    return claimedDetail(workspaceId, result.id, user.id);
  });
}

export async function reviewIssueAction(workspaceId: string, idOrIdentifier: string, decision: ReviewDecision) {
  return run<{ id: string }>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const result = await reviewIssue(workspaceId, idOrIdentifier, user.id, decision);
    refresh(workspaceId);
    return { id: result.id };
  });
}

export async function deleteIssueAction(workspaceId: string, idOrIdentifier: string) {
  return run<string>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const deleted = await deleteIssue(workspaceId, idOrIdentifier);
    refresh(workspaceId);
    return deleted.id;
  });
}

export async function restoreIssueAction(workspaceId: string, issueId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, issueId, user.id);
    await restoreIssue(workspaceId, issueId);
    refresh(workspaceId);
  });
}

export async function purgeIssueAction(workspaceId: string, issueId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, issueId, user.id);
    await purgeIssue(workspaceId, issueId);
    refresh(workspaceId);
  });
}

export async function addDependencyAction(workspaceId: string, idOrIdentifier: string, blockedBy: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const detail = await addDependency(workspaceId, idOrIdentifier, blockedBy, user.id, userActor(user));
    refresh(workspaceId);
    return detail;
  });
}

export async function removeDependencyAction(workspaceId: string, idOrIdentifier: string, blockedBy: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    const detail = await removeDependency(workspaceId, idOrIdentifier, blockedBy, user.id, userActor(user));
    refresh(workspaceId);
    return detail;
  });
}

export async function reportBlockerAction(workspaceId: string, idOrIdentifier: string, body: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
    await reportBlocker(workspaceId, idOrIdentifier, body, userActor(user));
    const detail = await getIssueDetail(workspaceId, idOrIdentifier, user.id);
    if (!detail) throw new TacosError("Task not found", 404);
    refresh(workspaceId);
    return detail;
  });
}

export async function addCommentAction(workspaceId: string, idOrIdentifier: string, body: string) {
  return run<IssueDetail>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, idOrIdentifier, user.id);
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
  patch: { name?: string; description?: string; doc?: string; color?: string; icon?: string | null }
) {
  return run<Project>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const project = await updateProject(workspaceId, projectId, patch, user.id);
    // The Overview autosaves its body every time typing pauses; revalidating the layout
    // on that beat re-rendered the whole shell mid-sentence. Only the name, description,
    // colour and icon are drawn outside the editor.
    if (
      patch.name !== undefined ||
      patch.description !== undefined ||
      patch.color !== undefined ||
      patch.icon !== undefined
    ) {
      refresh(workspaceId);
    }
    return project;
  });
}

// --- project Overview sharing ---

export async function setOverviewGrantAction(
  workspaceId: string,
  projectId: string,
  userId: string,
  role: OverviewRole
) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await setOverviewGrant(workspaceId, projectId, user.id, userId, role);
    refresh(workspaceId);
  });
}

export async function removeOverviewGrantAction(
  workspaceId: string,
  projectId: string,
  userId: string
) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await removeOverviewGrant(workspaceId, projectId, user.id, userId);
    refresh(workspaceId);
  });
}

export async function addOverviewCommentAction(
  workspaceId: string,
  projectId: string,
  body: string,
  anchor?: { quote: string; occurrence: number }
) {
  return run<OverviewComment[]>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const comments = await addOverviewComment(workspaceId, projectId, user.id, body, anchor);
    refresh(workspaceId);
    return comments;
  });
}

export async function removeOverviewCommentAction(
  workspaceId: string,
  projectId: string,
  commentId: string
) {
  return run<OverviewComment[]>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const comments = await removeOverviewComment(workspaceId, projectId, user.id, commentId);
    refresh(workspaceId);
    return comments;
  });
}

export async function restoreDocEditAction(
  workspaceId: string,
  projectId: string,
  editId: string
) {
  return run<{ doc: string }>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const doc = await restoreOverviewDocEdit(workspaceId, projectId, editId, user.id);
    refresh(workspaceId);
    return { doc };
  });
}

// Clears the unread badge; deliberately no revalidate, so opening the panel does not
// re-render the page under the user.
export async function markDocEditsSeenAction(workspaceId: string, projectId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await markDocEditsSeen(projectId, user.id);
  });
}

// The owner's workspace-wide switch: on (default) every member sees every task.
export async function setMembersSeeAllTasksAction(workspaceId: string, enabled: boolean) {
  return run<void>(async () => {
    await requireAdmin(workspaceId);
    await setMembersSeeAllTasks(workspaceId, enabled);
    refresh(workspaceId);
  });
}

export async function addProjectMemberAction(workspaceId: string, projectId: string, userId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
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
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await removeProjectMember(workspaceId, projectId, userId);
    refresh(workspaceId);
  });
}

// One control for both directions: the star is per-user, so it only needs workspace
// membership. Returns the state the star ended up in.
export async function toggleProjectFavoriteAction(workspaceId: string, projectId: string) {
  return run<boolean>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const favorite = await toggleFavoriteProject(workspaceId, user.id, projectId);
    refresh(workspaceId);
    return favorite;
  });
}

export async function trashProjectAction(workspaceId: string, projectId: string) {  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await trashProject(workspaceId, projectId, user.id);
    refresh(workspaceId);
  });
}

export async function restoreProjectAction(workspaceId: string, projectId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await restoreProject(workspaceId, projectId, user.id);
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
    const { user } = await requireWorkspace(workspaceId);
    await revokeApiKey(workspaceId, id, user.id);
    refresh(workspaceId);
  });
}

// --- project Overview resources ---

export async function addProjectLinkAction(
  workspaceId: string,
  projectId: string,
  input: { url: string; title?: string }
) {
  return run<ProjectResource>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const resource = await addProjectLink(workspaceId, projectId, user.id, input);
    refresh(workspaceId);
    return resource;
  });
}

export async function addProjectDocAction(workspaceId: string, projectId: string, pageId: string) {
  return run<ProjectResource>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    const resource = await addProjectDoc(workspaceId, projectId, user.id, pageId);
    refresh(workspaceId);
    return resource;
  });
}

export async function removeProjectResourceAction(
  workspaceId: string,
  projectId: string,
  resourceId: string
) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesProject(workspaceId, projectId, user.id);
    await removeProjectResource(workspaceId, projectId, resourceId, user.id);
    refresh(workspaceId);
  });
}

export async function createTaskFieldAction(
  workspaceId: string,
  input: { name: string; type: string; options?: string[] }
) {
  return run<TaskField>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const field = await createTaskField(workspaceId, user.id, input);
    refresh(workspaceId);
    return field;
  });
}

export async function deleteTaskFieldAction(workspaceId: string, fieldId: string) {
  return run<void>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await deleteTaskField(workspaceId, user.id, fieldId);
    refresh(workspaceId);
  });
}

export async function setTaskFieldValueAction(
  workspaceId: string,
  issueId: string,
  fieldId: string,
  value: string | null
) {
  return run<string | null>(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await assertSeesIssue(workspaceId, issueId, user.id);
    const saved = await setTaskFieldValue(workspaceId, issueId, fieldId, value, user.id, userActor(user));
    refresh(workspaceId);
    return saved;
  });
}

export async function changeIssueCollectionAction(workspaceId: string, id: string, change: {kind: "assignee" | "label"; value: string; selected: boolean}) {
  return run(async () => { const {user} = await requireWorkspace(workspaceId); const result = await changeIssueCollection(workspaceId,id,change,userActor(user)); refresh(workspaceId); return result; });
}

export async function taskFieldImpactAction(workspaceId:string,fieldId:string) {
  return run(async()=>{await requireWorkspace(workspaceId);return taskFieldImpact(workspaceId,fieldId);});
}
export async function restoreTaskFieldAction(workspaceId:string,fieldId:string) {
  return run(async()=>{const {user}=await requireWorkspace(workspaceId);await restoreTaskField(workspaceId,user.id,fieldId);refresh(workspaceId);});
}

export async function listTaskFieldsAction(workspaceId:string,includeDisabled=false){return run(async()=>{await requireWorkspace(workspaceId);const {listTaskFields}=await import("@/lib/task-fields");return listTaskFields(workspaceId,includeDisabled);});}

export async function updateTaskFieldAction(workspaceId:string,id:string,input:{name:string;options?:string[]}){return run(async()=>{const {user}=await requireWorkspace(workspaceId);const {updateTaskField}=await import("@/lib/task-fields");const result=await updateTaskField(workspaceId,user.id,id,input);refresh(workspaceId);return result;});}
