"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import { collabRunning } from "@/lib/collab/live";
import { issueCollabToken } from "@/lib/collab/token";
import {
  createPage,
  deletePage,
  getPage,
  getPageVersionChange,
  importMarkdownPage,
  keepUnsavedText,
  listPageAccess,
  listPageTree,
  movePage,
  previewPageMove,
  type PageMoveTarget,
  setPageCover,
  togglePageFavorite,
  listPageVersions,
  pageConflictView,
  purgePage,
  restorePage,
  restorePageVersion,
  undoAgentEdit,
  setPageMemberLevel,
  setPageShareLevel,
  setPageShared,
  updatePage,
  type DocPage,
  type ImportedPage,
  type PageVersion,
  type PageVersionChange,
} from "@/lib/pages";
import { TacosError, listMembers, listProjects, type Member } from "@/lib/issues";
import {
  addPageComment,
  editPageComment,
  restorePageComment,
  listPageComments,
  removePageComment,
  setPageCommentResolved,
  type PageComment,
} from "@/lib/page-comments";
import type { DocAnchor } from "@/lib/doc-anchor";
import type { PageLevel } from "@/lib/page-level";
import type { ActionResult } from "./actions";

function refresh(workspaceId: string) {
  revalidatePath(`/${workspaceId}`, "layout");
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function createPageAction(
  workspaceId: string,
  options: { parentId?: string | null; projectId?: string | null } = {}
): Promise<ActionResult<DocPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await createPage(workspaceId, user.id, {
      parentId: options.parentId ?? null,
      projectId: options.projectId ?? null,
    });
    refresh(workspaceId);
    return page;
  });
}

export async function importMarkdownAction(
  workspaceId: string,
  file: { path: string; content: string }
): Promise<ActionResult<ImportedPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    // The browser refreshes the sidebar once the whole batch lands, so a folder import
    // does not revalidate the layout for every single file.
    return importMarkdownPage(workspaceId, user.id, file);
  });
}

export async function updatePageAction(
  workspaceId: string,
  pageId: string,
  patch: { title?: string; doc?: string; icon?: string | null }
): Promise<ActionResult<DocPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await updatePage(workspaceId, pageId, user.id, patch);
    // A body save lands every time typing pauses. Revalidating here re-rendered the whole
    // workspace layout on that beat — a visible flash while the writer is still in the
    // document — and nothing outside the editor reads the body. Only the title and icon
    // show up in the sidebar, so only those need the refresh.
    if (patch.title !== undefined || patch.icon !== undefined) refresh(workspaceId);
    return page;
  });
}

export type DocSaveResult =
  | { kind: "saved"; revision: number }
  | { kind: "conflict"; doc: string; revision: number; by: string | null };

// A stale save comes back as data, not an error: the page shows a prompt for it. With
// keepOnConflict (the writer is leaving and will not see a prompt) the text goes to Updates.
export async function savePageDocAction(
  workspaceId: string,
  pageId: string,
  doc: string,
  baseRevision: number,
  options: { keepOnConflict?: boolean } = {}
): Promise<ActionResult<DocSaveResult>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    try {
      const page = await updatePage(workspaceId, pageId, user.id, { doc, baseRevision });
      return { kind: "saved" as const, revision: page.revision };
    } catch (err) {
      if (!(err instanceof TacosError) || err.status !== 409) throw err;
      if (options.keepOnConflict) await keepUnsavedText(workspaceId, pageId, user.id, doc);
      return { kind: "conflict" as const, ...(await pageConflictView(workspaceId, pageId, user.id)) };
    }
  });
}

export async function listPageVersionsAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<PageVersion[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return listPageVersions(workspaceId, pageId, user.id);
  });
}

/** The text a page shows when embedded; null when the viewer cannot read that page. */
export async function pageEmbedBodyAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<string | null>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await getPage(workspaceId, pageId, user.id);
    return page ? page.doc : null;
  });
}

export async function getPageVersionChangeAction(
  workspaceId: string,
  pageId: string,
  versionId: string,
  spanFromId?: string
): Promise<ActionResult<PageVersionChange>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return getPageVersionChange(workspaceId, pageId, user.id, versionId, spanFromId);
  });
}

export async function undoAgentEditAction(
  workspaceId: string,
  pageId: string,
  versionId: string
): Promise<ActionResult<DocPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await undoAgentEdit(workspaceId, pageId, user.id, { versionId });
    refresh(workspaceId);
    return page;
  });
}

export async function restorePageVersionAction(
  workspaceId: string,
  pageId: string,
  versionId: string
): Promise<ActionResult<DocPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await restorePageVersion(workspaceId, pageId, user.id, versionId);
    refresh(workspaceId);
    return page;
  });
}

export async function setPageSharedAction(
  workspaceId: string,
  pageId: string,
  shared: boolean
): Promise<ActionResult<DocPage>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const page = await setPageShared(workspaceId, pageId, user.id, shared);
    refresh(workspaceId);
    return page;
  });
}

export async function deletePageAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<string[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const deleted = await deletePage(workspaceId, pageId, user.id);
    refresh(workspaceId);
    return deleted;
  });
}

export async function restorePageAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await restorePage(workspaceId, pageId, user.id);
    refresh(workspaceId);
  });
}

export async function purgePageAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user, workspace } = await requireWorkspace(workspaceId);
    await purgePage(workspaceId, pageId, user.id, workspace.createdBy === user.id);
    refresh(workspaceId);
  });
}

export async function listPageCommentsAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<{ comments: PageComment[]; members: Member[] }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return {
      comments: await listPageComments(workspaceId, pageId, user.id),
      members: await listMembers(workspaceId),
    };
  });
}

export async function addPageCommentAction(
  workspaceId: string,
  pageId: string,
  input: { body: string; anchor?: DocAnchor | null; parentId?: string | null }
): Promise<ActionResult<PageComment[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return addPageComment(workspaceId, pageId, user.id, input);
  });
}

export async function setPageCommentResolvedAction(
  workspaceId: string,
  pageId: string,
  commentId: string,
  resolved: boolean
): Promise<ActionResult<PageComment[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return setPageCommentResolved(workspaceId, pageId, user.id, commentId, resolved);
  });
}

export async function removePageCommentAction(
  workspaceId: string,
  pageId: string,
  commentId: string
): Promise<ActionResult<PageComment[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return removePageComment(workspaceId, pageId, user.id, commentId);
  });
}

export async function listPageAccessAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<{ level: PageLevel; people: Record<string, PageLevel> }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return listPageAccess(workspaceId, pageId, user.id);
  });
}

export async function setPageShareLevelAction(
  workspaceId: string,
  pageId: string,
  level: PageLevel
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await setPageShareLevel(workspaceId, pageId, user.id, level);
    refresh(workspaceId);
  });
}

export async function setPageMemberLevelAction(
  workspaceId: string,
  pageId: string,
  userId: string,
  level: PageLevel | null
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await setPageMemberLevel(workspaceId, pageId, user.id, userId, level);
    refresh(workspaceId);
  });
}

export async function movePageAction(
  workspaceId: string,
  pageId: string,
  target: PageMoveTarget
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await movePage(workspaceId, pageId, user.id, target);
    refresh(workspaceId);
  });
}

export async function togglePageFavoriteAction(workspaceId: string, pageId: string): Promise<ActionResult<boolean>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const favorite = await togglePageFavorite(workspaceId, pageId, user.id);
    refresh(workspaceId);
    return favorite;
  });
}

export async function setPageCoverAction(
  workspaceId: string,
  pageId: string,
  attachmentId: string | null
): Promise<ActionResult<void>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await setPageCover(workspaceId, pageId, user.id, attachmentId);
    refresh(workspaceId);
  });
}

// Null means this page saves the old way: the desktop app on its own has no socket.
export async function getCollabSessionAction(
  workspaceId: string,
  pageId: string
): Promise<ActionResult<{ token: string; user: { name: string; color: string } } | null>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    if (!collabRunning()) return null;
    if (!(await getPage(workspaceId, pageId, user.id))) return null;
    const hue = [...user.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
    return {
      token: issueCollabToken({ workspaceId, pageId, userId: user.id }),
      user: { name: user.displayName, color: `hsl(${hue} 55% 45%)` },
    };
  });
}

export async function previewPageMoveAction(workspaceId:string,pageId:string,target:PageMoveTarget) {
  return run(async()=>{const {user}=await requireWorkspace(workspaceId);return previewPageMove(workspaceId,pageId,user.id,target);});
}

export async function listMoveTargetsAction(workspaceId:string) {
 return run(async()=>{const {user}=await requireWorkspace(workspaceId);return {pages:await listPageTree(workspaceId,user.id),projects:await listProjects(workspaceId,user.id)};});
}

export async function editPageCommentAction(ws:string,pageId:string,id:string,body:string){return run(async()=>{const {user}=await requireWorkspace(ws);return editPageComment(ws,pageId,user.id,id,body);});}
export async function restorePageCommentAction(ws:string,pageId:string,id:string){return run(async()=>{const {user}=await requireWorkspace(ws);return restorePageComment(ws,pageId,user.id,id);});}
