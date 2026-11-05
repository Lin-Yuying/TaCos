import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode, NodeType } from "@tiptap/pm/model";
import { lift, setBlockType, wrapIn } from "@tiptap/pm/commands";

// What a block can become. The drag handle moves blocks; this changes the block the
// handle is on. Stored documents stay Markdown, so each result is a normal block.
export type BlockTurn =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code";

export const BLOCK_TURNS: { turn: BlockTurn; label: string }[] = [
  { turn: "paragraph", label: "Text" },
  { turn: "heading-1", label: "Heading 1" },
  { turn: "heading-2", label: "Heading 2" },
  { turn: "heading-3", label: "Heading 3" },
  { turn: "bullet", label: "Bulleted list" },
  { turn: "ordered", label: "Numbered list" },
  { turn: "task", label: "To-do list" },
  { turn: "quote", label: "Quote" },
  { turn: "code", label: "Code" },
];

const CONVERTIBLE = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
]);

export function canTurnBlock(typeName: string): boolean {
  return CONVERTIBLE.has(typeName);
}

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean;

function apply(state: EditorState, command: Command): EditorState | null {
  let next: Transaction | null = null;
  if (!command(state, (tr) => {
    next = tr;
  }) || !next) return null;
  return state.apply(next);
}

function blockAt(doc: ProseMirrorNode, pos: number): { pos: number; node: ProseMirrorNode } | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const direct = doc.nodeAt(pos);
  if (direct && direct.isBlock && doc.resolve(pos).depth === 0) return { pos, node: direct };
  const $pos = doc.resolve(Math.min(Math.max(pos, 1), doc.content.size));
  if ($pos.depth < 1) return null;
  return { pos: $pos.before(1), node: $pos.node(1) };
}

function placeCaret(state: EditorState, blockPos: number, node: ProseMirrorNode): EditorState {
  let textPos = blockPos + 1;
  state.doc.nodesBetween(blockPos, blockPos + node.nodeSize, (child, pos) => {
    if (child.isTextblock) {
      textPos = pos + 1;
      return false;
    }
  });
  const selection = TextSelection.near(state.doc.resolve(Math.min(textPos, state.doc.content.size)));
  return state.apply(state.tr.setSelection(selection));
}

function liftToTextblock(state: EditorState): EditorState {
  for (let i = 0; i < 8; i += 1) {
    const { $from } = state.selection;
    if ($from.depth <= 1 && $from.parent.isTextblock) return state;
    const next = apply(state, lift);
    if (!next || next.doc.eq(state.doc)) return state;
    state = next;
  }
  return state;
}

function replaceTextblock(state: EditorState, build: (node: ProseMirrorNode) => ProseMirrorNode): EditorState | null {
  const { $from } = state.selection;
  if ($from.depth < 1 || !$from.node(1).isTextblock) return null;
  const node = $from.node(1);
  const pos = $from.before(1);
  let built: ProseMirrorNode;
  try {
    built = build(node);
  } catch {
    return null;
  }
  return state.apply(state.tr.replaceWith(pos, pos + node.nodeSize, built));
}

function asList(state: EditorState, listName: string, itemName: string, attrs: Record<string, unknown> | null = null): EditorState | null {
  return replaceTextblock(state, (node) => {
    const item = state.schema.nodes[itemName].create(attrs, node);
    return state.schema.nodes[listName].create(null, item);
  });
}

function already(node: ProseMirrorNode, turn: BlockTurn): boolean {
  if (turn === "paragraph") return node.type.name === "paragraph";
  if (turn === "heading-1") return node.type.name === "heading" && node.attrs.level === 1;
  if (turn === "heading-2") return node.type.name === "heading" && node.attrs.level === 2;
  if (turn === "heading-3") return node.type.name === "heading" && node.attrs.level === 3;
  if (turn === "bullet") return node.type.name === "bulletList";
  if (turn === "ordered") return node.type.name === "orderedList";
  if (turn === "task") return node.type.name === "taskList";
  if (turn === "quote") return node.type.name === "blockquote";
  return node.type.name === "codeBlock";
}

/** The document after turning the block at `pos` into `turn`, or null when it cannot change. */
export function turnBlock(state: EditorState, pos: number, turn: BlockTurn): EditorState | null {
  const block = blockAt(state.doc, pos);
  if (!block || !CONVERTIBLE.has(block.node.type.name) || already(block.node, turn)) return null;
  let next = placeCaret(state, block.pos, block.node);
  next = liftToTextblock(next);
  const type = (name: string): NodeType => next.schema.nodes[name];
  const paragraph = (): EditorState =>
    next.selection.$from.parent.type.name === "paragraph" ? next : (apply(next, setBlockType(type("paragraph"))) ?? next);
  let changed: EditorState | null = null;
  if (turn === "paragraph") changed = apply(next, setBlockType(type("paragraph")));
  else if (turn === "heading-1") changed = apply(next, setBlockType(type("heading"), { level: 1 }));
  else if (turn === "heading-2") changed = apply(next, setBlockType(type("heading"), { level: 2 }));
  else if (turn === "heading-3") changed = apply(next, setBlockType(type("heading"), { level: 3 }));
  else if (turn === "bullet") changed = asList(paragraph(), "bulletList", "listItem");
  else if (turn === "ordered") changed = asList(paragraph(), "orderedList", "listItem");
  else if (turn === "task") changed = asList(paragraph(), "taskList", "taskItem", { checked: false });
  else if (turn === "quote") changed = apply(paragraph(), wrapIn(type("blockquote")));
  else changed = apply(next, setBlockType(type("codeBlock")));
  if (!changed || changed.doc.eq(state.doc)) return null;
  return changed;
}

/**
 * Move one top-level block to another index. This is the document change a drag
 * from the block handle produces: the block is removed, then inserted so it
 * lands at `toIndex`.
 */
export function moveTopLevelBlock(state: EditorState, fromIndex: number, toIndex: number): EditorState | null {
  const doc = state.doc;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return null;
  if (fromIndex >= doc.childCount || toIndex >= doc.childCount) return null;
  let from = 0;
  for (let i = 0; i < fromIndex; i += 1) from += doc.child(i).nodeSize;
  const node = doc.child(fromIndex);
  const slice = doc.slice(from, from + node.nodeSize);
  let tr = state.tr.delete(from, from + node.nodeSize);
  let insertAt = 0;
  for (let i = 0; i < toIndex; i += 1) insertAt += tr.doc.child(i).nodeSize;
  tr = tr.insert(insertAt, slice.content);
  return state.apply(tr);
}
