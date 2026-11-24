import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

export function insertStandalonePageRef(
  state: EditorState,
  reference: { title: string; id: string }
): Transaction | null {
  const { schema } = state;
  const pageRef = schema.nodes.pageRef;
  const paragraph = schema.nodes.paragraph;
  if (!pageRef || !paragraph || !pageRef.isInline) return null;

  const tr = state.tr.deleteSelection();
  let pos = tr.selection.from;
  let $pos = tr.doc.resolve(pos);
  if (
    $pos.depth !== 1 ||
    ($pos.parent.type.name !== "paragraph" && $pos.parent.type.name !== "heading") ||
    !$pos.parent.inlineContent
  ) return null;

  const referenceNode = pageRef.create({ title: reference.title, pageId: reference.id });
  const referenceBlock = paragraph.create(null, referenceNode);
  let at = pos;

  if ($pos.parent.content.size === 0) {
    if ($pos.parent.type !== paragraph) tr.setBlockType(pos, pos, paragraph);
    tr.insert(pos, referenceNode);
    at = pos + 1;
  } else if ($pos.parentOffset === 0) {
    at = $pos.before(1);
    tr.insert(at, referenceBlock);
    at += 2;
  } else if ($pos.parentOffset === $pos.parent.content.size) {
    at = $pos.after(1);
    tr.insert(at, referenceBlock);
    at += 2;
  } else {
    const before = $pos.parent.textBetween(0, $pos.parentOffset, "\n", "\ufffc");
    const after = $pos.parent.textBetween($pos.parentOffset, $pos.parent.content.size, "\n", "\ufffc");
    let start = $pos.parentOffset;
    let end = start;
    while (start > 0 && /[ \t]/.test(before[start - 1])) start -= 1;
    while (end < before.length + after.length && /[ \t]/.test(after[end - $pos.parentOffset])) end += 1;
    pos = $pos.start() + start;
    if (end > start) tr.delete(pos, $pos.start() + end);
    $pos = tr.doc.resolve(pos);
    if ($pos.parent.content.size === 0) {
      if ($pos.parent.type !== paragraph) tr.setBlockType(pos, pos, paragraph);
      tr.insert(pos, referenceNode);
      at = pos + 1;
    } else {
      tr.split(pos, 1, [{ type: paragraph }]);
      tr.insert(pos, referenceBlock);
      at = pos + 2;
    }
  }

  tr.setSelection(TextSelection.create(tr.doc, at));
  tr.setStoredMarks(null);
  return tr;
}
