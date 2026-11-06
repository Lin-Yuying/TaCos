import { assertKeyProjectId } from "./api-auth";
import { getProject, TacosError, type ApiKeyRecord } from "./issues";
import { levelAllows } from "./page-level";
import {
  getPage,
  pageAuthor,
  pageLevel,
  type DocPage,
  type PageAuthor,
  type PageSummary,
} from "./pages";

export type PageApiPayload = DocPage & { author: PageAuthor | null; canEdit: boolean };

// The page as the API shows it: the stored markdown, who wrote it, and whether this
// key's person could edit it in the web UI. Sharing itself is never exposed for change.
export async function pageApiPayload(page: DocPage, viewerId: string): Promise<PageApiPayload> {
  return {
    ...page,
    author: await pageAuthor(page.createdBy),
    canEdit: levelAllows(await pageLevel(page, viewerId), "edit"),
  };
}

/**
 * A page attached to a project follows the key's project allowlist. A workspace page
 * (no project) belongs to no restricted project, so it stays readable.
 */
export function pageProjectAllowed(
  key: Pick<ApiKeyRecord, "projectIds">,
  projectId: string | null
): boolean {
  return key.projectIds === null || projectId === null || key.projectIds.includes(projectId);
}

export function filterPagesForKey(
  key: Pick<ApiKeyRecord, "projectIds">,
  pages: PageSummary[]
): PageSummary[] {
  return pages.filter((page) => pageProjectAllowed(key, page.projectId));
}

export async function assertKeyPageProject(key: ApiKeyRecord, page: DocPage): Promise<void> {
  if (pageProjectAllowed(key, page.projectId) || !page.projectId) return;
  const project = await getProject(key.workspaceId, page.projectId);
  assertKeyProjectId(key, page.projectId, project?.key ?? page.projectId);
}

/** A page this key may read; a private page of another member is a 404, as in the UI. */
export async function visiblePageForKey(key: ApiKeyRecord, pageId: string): Promise<DocPage> {
  const page = await getPage(key.workspaceId, pageId, key.createdBy);
  if (!page) throw new TacosError("Page not found", 404);
  await assertKeyPageProject(key, page);
  return page;
}
