import { TacosError } from "./tacos-error";

export type DocEdit = { find: string; replace: string };

/**
 * Change named passages and nothing else. Each find must match exactly once, so an edit can
 * never land somewhere the Agent did not mean. One bad edit leaves the document untouched.
 */
export function applyDocEdits(doc: string, edits: DocEdit[]): string {
  if (!edits.length) throw new TacosError("Pass at least one edit");
  let next = doc;
  edits.forEach((edit, index) => {
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
    if (!edit.find) throw new TacosError(`${label}find is empty`);
    const first = next.indexOf(edit.find);
    if (first < 0) {
      throw new TacosError(`${label}this text is not in the document; read it again with get_doc`, 409);
    }
    if (next.indexOf(edit.find, first + 1) >= 0) {
      throw new TacosError(`${label}this text appears more than once; include more of the text around it`, 409);
    }
    next = next.slice(0, first) + edit.replace + next.slice(first + edit.find.length);
  });
  return next;
}
