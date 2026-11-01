export const DOCS_DELETED_EVENT = "tacos:docs-deleted";

export function announceDocsDeleted(pageIds: string[]) {
  window.dispatchEvent(new CustomEvent(DOCS_DELETED_EVENT, { detail: { pageIds } }));
}
