"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import {
  createPage,
  deletePage,
  getPageVersionChange,
  importMarkdownPage,
  keepUnsavedText,
  listPageVersions,
  pageConflictView,
  purgePage,
  restorePage,
  restorePageVersion,
  setPageShared,
  updatePage,
  type DocPage,
  type ImportedPage,
  type PageVersion,
  type PageVersionChange,
} from "@/lib/pages";
import { TacosError, listMembers, type Member } from "@/lib/issues";
import {
  addPageComment,
  listPageComments,
  removePageComment,
  setPageCommentResolved,
  type PageComment,
} from "@/lib/page-comments";
import type { DocAnchor } from "@/lib/doc-anchor";
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

export async function getPageVersionChangeAction(
  workspaceId: string,
  pageId: string,
  versionId: string
): Promise<ActionResult<PageVersionChange>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return getPageVersionChange(workspaceId, pageId, user.id, versionId);
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
  input: { body: string; anchor?: DocAnchor | null }
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
