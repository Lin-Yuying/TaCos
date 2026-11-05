import type { Node as PMNode } from "@tiptap/pm/model";
import { anchorFromRange, locateAnchor, type DocAnchor } from "../doc-anchor";

type Segment = { offset: number; pos: number; length: number };

// The document as plain text, with a way back to editor positions. Blocks are separated
// by one line break; an inline node such as a page link counts as one character.
function docText(doc: PMNode): { text: string; segments: Segment[] } {
  let text = "";
  const segments: Segment[] = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      segments.push({ offset: text.length, pos, length: node.text?.length ?? 0 });
      text += node.text ?? "";
    } else if (node.isLeaf && node.isInline) {
      segments.push({ offset: text.length, pos, length: 1 });
      text += "￼";
    } else if (node.isBlock && text && !text.endsWith("\n")) {
      text += "\n";
    }
    return true;
  });
  return { text, segments };
}

function posAt(segments: Segment[], offset: number): number | null {
  for (const segment of segments) {
    if (offset >= segment.offset && offset < segment.offset + segment.length) {
      return segment.pos + offset - segment.offset;
    }
  }
  return null;
}

function offsetAt(segments: Segment[], pos: number): number | null {
  for (const segment of segments) {
    if (pos >= segment.pos && pos < segment.pos + segment.length) return segment.offset + pos - segment.pos;
  }
  return null;
}

export function anchorFromSelection(doc: PMNode, from: number, to: number): DocAnchor | null {
  const { text, segments } = docText(doc);
  const start = offsetAt(segments, from);
  const last = offsetAt(segments, to - 1);
  if (start === null || last === null) return null;
  return anchorFromRange(text, start, last + 1);
}

/** How many comments sit on each top-level block, in document order. */
export function commentCountsByBlock<T extends DocAnchor & { id: string }>(
  doc: PMNode,
  anchors: T[],
): Array<{ from: number; count: number; ids: string[] }> {
  const groups = new Map<number, string[]>();
  for (const range of anchorRanges(doc, anchors)) {
    const $pos = doc.resolve(range.from);
    const block = $pos.depth >= 1 ? $pos.before(1) : 0;
    const ids = groups.get(block) ?? [];
    ids.push(range.anchor.id);
    groups.set(block, ids);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, ids]) => ({ from, count: ids.length, ids }));
}

/** Editor range of each anchor that can still be found. */
export function anchorRanges<T extends DocAnchor>(doc: PMNode, anchors: T[]): Array<{ anchor: T; from: number; to: number }> {
  const { text, segments } = docText(doc);
  const out: Array<{ anchor: T; from: number; to: number }> = [];
  for (const anchor of anchors) {
    const found = locateAnchor(text, anchor);
    if (!found) continue;
    const from = posAt(segments, found.start);
    const last = posAt(segments, found.end - 1);
    if (from !== null && last !== null) out.push({ anchor, from, to: last + 1 });
  }
  return out;
}
