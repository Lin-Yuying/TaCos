import type { EditorState, Transaction } from "@tiptap/pm/state";

export const DOC_IMAGE_CLASS = "doc-image";

/** Delete a selected image without TipTap's scrollIntoView (keeps the viewport steady). */
export function deleteSelectedImage(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { selection } = state;
  // Avoid `instanceof NodeSelection` — tsx can load @tiptap/pm/state twice in check scripts.
  const node = selection as typeof selection & { jsonID?: string; node?: { type: { name: string } } };
  if (node.jsonID !== "node" || node.node?.type.name !== "image") {
    return false;
  }
  const tr = state.tr.deleteSelection();
  if (dispatch) dispatch(tr);
  return true;
}
