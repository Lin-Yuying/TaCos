"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
} from "lucide-react";
import { MarkdownBlock } from "@/components/markdown";
import { INDENT, parseBlock, setTodoChecked, splitBlocks } from "@/lib/markdown";

type Marker =
  | { kind: "none"; depth: number }
  | { kind: "heading"; depth: number; level: number }
  | { kind: "bullet"; depth: number }
  | { kind: "ordered"; depth: number; n: number }
  | { kind: "todo"; depth: number; checked: boolean }
  | { kind: "quote"; depth: number }
  | { kind: "code"; depth: number; lang: string }
  | { kind: "divider"; depth: number };

type Command = {
  label: string;
  hint: string;
  keywords: string;
  insert: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
};

const COMMANDS: Command[] = [
  { label: "Text", hint: "Plain paragraph", keywords: "plain body p", insert: "", icon: Type },
  { label: "Heading 1", hint: "Large section title", keywords: "h1 title", insert: "# ", icon: Heading1 },
  { label: "Heading 2", hint: "Medium section title", keywords: "h2 subtitle", insert: "## ", icon: Heading2 },
  { label: "Heading 3", hint: "Small section title", keywords: "h3", insert: "### ", icon: Heading3 },
  { label: "Bulleted list", hint: "Unordered items", keywords: "bullet ul dash list", insert: "- ", icon: List },
  { label: "Numbered list", hint: "Ordered items", keywords: "ordered ol number list", insert: "1. ", icon: ListOrdered },
  { label: "To-do list", hint: "Checkable items", keywords: "todo task checkbox check", insert: "- [ ] ", icon: CheckSquare },
  { label: "Quote", hint: "Set text apart", keywords: "blockquote citation", insert: "> ", icon: Quote },
  { label: "Code", hint: "Fenced block", keywords: "code block pre", insert: "```", icon: Code },
  { label: "Divider", hint: "Visual break", keywords: "hr line rule separator", insert: "---", icon: Minus },
];

const SLASH = /^\/([^\n]*)$/;
const FENCE = "```";
const HEADING = /^(#{1,6})\s(.*)$/;
const TODO = /^([-*+])\s\[([ xX])\]\s?(.*)$/;
const BULLET = /^([-*+])\s(.*)$/;
const ORDERED = /^(\d+)([.)])\s(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/;
// Notion lets you open a to-do by typing the brackets alone.
const TODO_SHORTHAND = /^\[([ xX]?)\]\s?(.*)$/;

const HEADING_SIZE = [
  "text-[20px]",
  "text-[17px]",
  "text-[15px]",
  "text-[14px]",
  "text-[13px]",
  "text-[13px]",
];

const MAX_DEPTH = 4;
const INDENT_PX = 20;

function depthOfIndent(indent: string): number {
  return Math.min(MAX_DEPTH, Math.floor(indent.length / INDENT.length));
}

// A block is stored as Markdown but edited as the text you actually want to see: the
// marker (`# `, `- `, the ``` fences) is peeled off into `marker` and rendered as the
// glyph or style it stands for, so it never shows up in the caret's way. Multi-line
// bodies keep their source — a per-line gutter would drift as soon as an item wraps.
function splitMarker(raw: string): { marker: Marker; body: string } {
  const lines = raw.split("\n");
  if (lines[0].startsWith(FENCE)) {
    const last = lines[lines.length - 1];
    const closing = lines.length > 1 && last.trimStart().startsWith(FENCE);
    return {
      marker: { kind: "code", depth: 0, lang: lines[0].slice(FENCE.length).trim() },
      body: (closing ? lines.slice(1, -1) : lines.slice(1)).join("\n"),
    };
  }

  const first = lines[0];
  const depth = depthOfIndent(/^\s*/.exec(first)![0]);
  const text = first.slice(/^\s*/.exec(first)![0].length);

  if (lines.length > 1) {
    // A soft-broken block keeps its source verbatim, or a two-line quote would lose
    // the `>` on the second line when it is written back.
    return { marker: { kind: "none", depth }, body: raw };
  }
  if (DIVIDER.test(text)) return { marker: { kind: "divider", depth }, body: "" };
  const todo = TODO.exec(text);
  if (todo) return { marker: { kind: "todo", depth, checked: todo[2] !== " " }, body: todo[3] };
  const heading = HEADING.exec(text);
  if (heading) return { marker: { kind: "heading", depth, level: heading[1].length }, body: heading[2] };
  const bullet = BULLET.exec(text);
  if (bullet) return { marker: { kind: "bullet", depth }, body: bullet[2] };
  const ordered = ORDERED.exec(text);
  if (ordered) return { marker: { kind: "ordered", depth, n: Number(ordered[1]) }, body: ordered[3] };
  const quote = QUOTE.exec(text);
  if (quote) return { marker: { kind: "quote", depth }, body: quote[1] };
  return { marker: { kind: "none", depth }, body: first };
}

function joinMarker(marker: Marker, body: string): string {
  if (marker.kind === "code") return `${FENCE}${marker.lang}\n${body}\n${FENCE}`;
  if (marker.kind === "divider") return "---";
  const pad = INDENT.repeat(marker.depth);
  switch (marker.kind) {
    case "heading":
      return `${pad}${"#".repeat(marker.level)} ${body}`;
    case "bullet":
      return `${pad}- ${body}`;
    case "ordered":
      return `${pad}${marker.n}. ${body}`;
    case "todo":
      return `${pad}- [${marker.checked ? "x" : " "}] ${body}`;
    case "quote":
      return `${pad}> ${body}`;
    default:
      // A soft-broken paragraph keeps its extra lines flush; only the block indents.
      return body.includes("\n") ? body.split("\n").map((l, i) => (i ? l : `${pad}${l}`)).join("\n") : `${pad}${body}`;
  }
}

function isBlank(marker: Marker, body: string) {
  return body.trim() === "" && marker.kind !== "code" && marker.kind !== "divider";
}

const LIST_KINDS = new Set(["bullet", "ordered", "todo"]);

// `splitBlocks` keeps a list run as one block, but Notion edits one item at a time, so
// the editor breaks such a run into single-line blocks and glues them back with a bare
// newline on save — which is what keeps `- a` / `- b` a single list in stored Markdown.
function editBlocks(src: string): string[] {
  return splitBlocks(src).flatMap((block) => {
    const lines = block.split("\n");
    if (lines.length < 2) return [block];
    const kinds = lines.map((line) => splitMarker(line).marker.kind);
    return kinds.every((kind) => kind === kinds[0] && LIST_KINDS.has(kind)) ? lines : [block];
  });
}

function joinBlocks(blocks: string[]): string {
  let out = "";
  let prev: string | null = null;
  for (const block of blocks) {
    const kind = block.includes("\n") ? null : splitMarker(block).marker.kind;
    const continues = kind !== null && LIST_KINDS.has(kind) && kind === prev;
    out += out === "" ? block : `${continues ? "\n" : "\n\n"}${block}`;
    prev = kind;
  }
  return out.replace(/\s+$/, "");
}

// Notion-style input rules: the marker is recognised the moment it is complete, so
// typing "# " turns the line into a heading and ``` turns it into a code block.
function adoptMarker(body: string): { marker: Marker; body: string } | null {
  if (!body.includes("\n") && (body === FENCE || (body.startsWith(FENCE) && !body.endsWith(" ")))) {
    return splitMarker(body);
  }
  const indent = /^\s*/.exec(body)![0];
  const text = body.slice(indent.length);
  const shorthand = TODO_SHORTHAND.exec(text);
  if (shorthand && shorthand[2] === "") {
    return {
      marker: {
        kind: "todo",
        depth: depthOfIndent(indent),
        checked: shorthand[1] === "x" || shorthand[1] === "X",
      },
      body: "",
    };
  }
  const marker = splitMarker(body);
  return marker.marker.kind === "none" ? null : marker;
}

/* ------------------------------------------------------------------ *
 * Live inline styling
 *
 * The caret lives in a transparent <textarea>; everything you read on screen is this
 * mirror layer painted underneath it. Because the mirror has to keep the textarea's
 * exact character advances, styles are limited to ones that do not change glyph
 * widths: faux bold is a tight text-shadow rather than a weight, italic skews each
 * word in place, and code/links only change colour and decoration. The Markdown
 * delimiters stay in the text — they are simply invisible until the caret walks near
 * them, which is how Notion lets you edit the syntax without ever hiding it from you.
 * ------------------------------------------------------------------ */

type InlineRule = { kind: "code" | "bold" | "strike" | "italic" | "link"; re: RegExp };

const INLINE_RULES: InlineRule[] = [
  { kind: "code", re: /^`([^`\n]+)`/ },
  { kind: "bold", re: /^\*\*([^*\n]+)\*\*/ },
  { kind: "strike", re: /^~~([^~\n]+)~~/ },
  { kind: "italic", re: /^\*([^*\n]+)\*/ },
  { kind: "italic", re: /^_([^_\n]+)_/ },
  { kind: "link", re: /^\[([^\]\n]*)\]\(([^)\s]+)\)/ },
];

type GhostNode =
  | { type: "text"; text: string; start: number }
  | { type: "styled"; kind: InlineRule["kind"]; pre: string; inner: string; post: string; start: number };

function ghostNodes(src: string): GhostNode[] {
  const nodes: GhostNode[] = [];
  let buffer = "";
  let bufferStart = 0;
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const rule = INLINE_RULES.find((candidate) => candidate.re.test(rest));
    const match = rule ? rule.re.exec(rest) : null;
    if (!rule || !match) {
      if (!buffer) bufferStart = i;
      buffer += src[i];
      i += 1;
      continue;
    }
    if (buffer) {
      nodes.push({ type: "text", text: buffer, start: bufferStart });
      buffer = "";
    }
    const innerAt = match[0].indexOf(match[1]);
    nodes.push({
      type: "styled",
      kind: rule.kind,
      pre: match[0].slice(0, innerAt),
      inner: match[1],
      post: match[0].slice(innerAt + match[1].length),
      start: i,
    });
    i += match[0].length;
  }
  if (buffer) nodes.push({ type: "text", text: buffer, start: bufferStart });
  return nodes;
}

// An inline-block span advances by the width of its untransformed text, so the caret
// underneath stays put; splitting on spaces keeps long runs wrappable.
function skewed(text: string) {
  return text.split(/(\s+)/).map((part, i) =>
    part.trim() === "" ? (
      <span key={i}>{part}</span>
    ) : (
      <span key={i} className="inline-block" style={{ transform: "skewX(-9deg)" }}>
        {part}
      </span>
    ),
  );
}

function styleFor(kind: InlineRule["kind"]): React.CSSProperties {
  switch (kind) {
    case "bold":
      return { textShadow: "0 0 0.4px currentColor, 0.4px 0 0.4px currentColor, -0.4px 0 0.4px currentColor" };
    case "strike":
      return { textDecoration: "line-through" };
    case "code":
      return { background: "var(--color-elevated)", borderRadius: 4, color: "var(--color-text)" };
    case "link":
      return { color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: 2 };
    default:
      return {};
  }
}

function Ghost({ src, caret }: { src: string; caret: number }) {
  return (
    <>
      {ghostNodes(src).map((node, i) => {
        if (node.type === "text") return <span key={i}>{node.text}</span>;
        const end = node.start + node.pre.length + node.inner.length + node.post.length;
        const near = caret >= node.start && caret <= end;
        const markerStyle: React.CSSProperties = near
          ? { color: "var(--color-faint)" }
          : { color: "transparent" };
        return (
          <span key={i}>
            <span style={markerStyle}>{node.pre}</span>
            {node.kind === "italic" ? (
              <span>{skewed(node.inner)}</span>
            ) : (
              <span style={styleFor(node.kind)}>{node.inner}</span>
            )}
            <span style={markerStyle}>{node.post}</span>
          </span>
        );
      })}
    </>
  );
}

/** Character offset inside `root`'s text content that a click landed on. */
function offsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  const point = doc.caretPositionFromPoint?.(x, y);
  const container = range?.startContainer ?? point?.offsetNode ?? null;
  if (!container || container === root) return null;
  const offsetInNode = range ? range.startOffset : (point?.offset ?? null);
  if (offsetInNode == null) return null;
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === container) return total + offsetInNode;
    total += node.textContent?.length ?? 0;
  }
  return null;
}

const PLACEHOLDER: Record<Marker["kind"], string> = {
  none: "Type / for commands",
  heading: "Heading",
  bullet: "List item",
  ordered: "List item",
  todo: "To-do",
  quote: "Quote",
  code: "Code",
  divider: "Divider",
};

// Same metrics on both layers is the whole trick: anything the textarea gets by
// default (padding, border) has to be given to the mirror as well.
const TEXT_BASE = "m-0 border-0 p-0 text-[13.5px] leading-relaxed";

function textClass(marker: Marker): string {
  if (marker.kind === "code") return `${TEXT_BASE} font-mono text-[12.5px]`;
  if (marker.kind === "heading")
    return `${TEXT_BASE} font-semibold tracking-tight ${HEADING_SIZE[marker.level - 1]}`;
  return TEXT_BASE;
}

export function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [blocks, setBlocks] = useState<string[]>(() => editBlocks(value));
  const [editing, setEditing] = useState<number | null>(null);
  const [marker, setMarker] = useState<Marker>({ kind: "none", depth: 0 });
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [menu, setMenu] = useState<{ query: string; selected: number } | null>(null);
  // Block range picked by dragging across the document, or by a second ⌘A. While it is
  // set nothing is being edited, so the keystrokes below act on whole blocks.
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const clickPoint = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const emitted = useRef(value);
  // Once the user has typed, the local blocks win: each keystroke saves and the resulting
  // revalidation can hand back the document as it was a moment earlier, and re-seeding
  // from that stale snapshot would eat the edit still in flight.
  const dirty = useRef(false);

  useEffect(() => {
    if (dirty.current || value === emitted.current) return;
    emitted.current = value;
    setBlocks(editBlocks(value));
    setEditing(null);
    setRange(null);
    setMenu(null);
  }, [value]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${area.scrollHeight}px`;
  }, [draft, editing, marker]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || caretRef.current == null) return;
    area.focus();
    area.setSelectionRange(caretRef.current, caretRef.current);
    setCaret(caretRef.current);
    caretRef.current = null;
  }, [editing, draft, marker]);

  // The first click on a finished block only swaps it for the textarea, so the spot the
  // user aimed at is recovered from the mirror layer, which has identical geometry.
  useLayoutEffect(() => {
    const point = clickPoint.current;
    const area = areaRef.current;
    const ghost = ghostRef.current;
    if (!point || !area || !ghost) return;
    clickPoint.current = null;
    const offset = offsetAtPoint(ghost, point.x, point.y);
    if (offset == null) return;
    const clamped = Math.max(0, Math.min(draft.length, offset));
    area.focus();
    area.setSelectionRange(clamped, clamped);
    setCaret(clamped);
  }, [editing, draft]);

  // A drag can end outside the document, so the mouse is tracked on the window.
  useEffect(() => {
    const stop = () => {
      drag.current = null;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // Empty documents still show one line to work on.
  const doc = blocks.length > 0 ? blocks : [""];

  function commit(next: string[]) {
    dirty.current = true;
    emitted.current = joinBlocks(next);
    setBlocks(next);
    onChange(emitted.current);
  }

  function write(index: number, raw: string) {
    const next = doc.slice();
    if (raw.trim() === "") next.splice(index, 1);
    else next[index] = raw;
    commit(next);
  }

  function startEdit(index: number, text: string) {
    const parsed = splitMarker(text);
    setEditing(index);
    setMarker(parsed.marker);
    setDraft(parsed.body);
    setMenu(null);
    caretRef.current = parsed.marker.kind === "code" && parsed.body === "" ? 0 : parsed.body.length;
  }

  function closeEdit(index: number) {
    const raw = joinMarker(marker, draft);
    write(index, isBlank(marker, draft) ? "" : raw);
    setEditing(null);
    setMenu(null);
  }

  // Enter after a styled line keeps the style and starts a fresh block, which is how
  // a list grows one item at a time in Notion. Headings and quotes go back to text.
  function continueBlock(index: number) {
    const carried: Marker =
      marker.kind === "bullet"
        ? { kind: "bullet", depth: marker.depth }
        : marker.kind === "ordered"
          ? { kind: "ordered", depth: marker.depth, n: marker.n + 1 }
          : marker.kind === "todo"
            ? { kind: "todo", depth: marker.depth, checked: false }
            : { kind: "none", depth: marker.kind === "heading" || marker.kind === "quote" ? marker.depth : 0 };
    const next = doc.slice();
    next[index] = joinMarker(marker, draft);
    next.splice(index + 1, 0, joinMarker(carried, ""));
    commit(next);
    setEditing(index + 1);
    setMarker(carried);
    setDraft("");
    caretRef.current = 0;
  }

  function splitBlock(index: number) {
    const next = doc.slice();
    next[index] = joinMarker(marker, draft);
    next.splice(index + 1, 0, joinMarker({ kind: "none", depth: marker.depth }, ""));
    commit(next);
    setEditing(index + 1);
    setMarker({ kind: "none", depth: marker.depth });
    setDraft("");
    caretRef.current = 0;
  }

  function moveCaretToBlock(index: number, atEnd: boolean) {
    const raw = doc[index];
    if (raw === undefined) return;
    const parsed = splitMarker(raw);
    setEditing(index);
    setMarker(parsed.marker);
    setDraft(parsed.body);
    caretRef.current = atEnd ? parsed.body.length : 0;
  }

  function onEnter(area: HTMLTextAreaElement) {
    // Inside a code block Enter is part of the code, not a new document block.
    if (marker.kind === "code") {
      const pos = area.selectionStart ?? draft.length;
      setDraft(`${draft.slice(0, pos)}\n${draft.slice(pos)}`);
      caretRef.current = pos + 1;
      return;
    }
    const pos = area.selectionStart ?? draft.length;
    const lineStart = draft.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = draft.indexOf("\n", pos);
    const lineStop = lineEnd === -1 ? draft.length : lineEnd;
    const line = draft.slice(lineStart, lineStop);

    // An empty item steps out one level first, and only ends the list at the margin.
    if (line.trim() === "" && marker.kind !== "none") {
      if (marker.depth > 0) {
        const outdented = { ...marker, depth: marker.depth - 1 };
        setMarker(outdented);
        const next = doc.slice();
        next[editing!] = joinMarker(outdented, "");
        commit(next);
        setDraft("");
        caretRef.current = 0;
        return;
      }
      const next = doc.slice();
      next.splice(editing!, 1, "");
      commit(next);
      setMarker({ kind: "none", depth: 0 });
      setDraft("");
      caretRef.current = 0;
      return;
    }
    if (marker.kind === "divider") {
      splitBlock(editing!);
      return;
    }
    if (marker.kind === "bullet" || marker.kind === "ordered" || marker.kind === "todo") {
      continueBlock(editing!);
      return;
    }
    if (pos < draft.length) {
      // Splitting mid-text keeps the tail in the same block.
      const head = draft.slice(0, pos);
      const tail = draft.slice(pos).trimStart();
      const next = doc.slice();
      next[editing!] = joinMarker(marker, head);
      next.splice(editing! + 1, 0, joinMarker({ kind: "none", depth: marker.depth }, tail));
      commit(next);
      setEditing(editing! + 1);
      setMarker({ kind: "none", depth: marker.depth });
      setDraft(tail);
      caretRef.current = 0;
      return;
    }
    if (marker.kind === "heading" || marker.kind === "quote") {
      continueBlock(editing!);
      return;
    }
    splitBlock(editing!);
  }

  function updateMenu(area: HTMLTextAreaElement, text: string) {
    const pos = area.selectionStart ?? text.length;
    const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
    const match = SLASH.exec(text.slice(lineStart, pos));
    setMenu(match ? { query: match[1].toLowerCase(), selected: 0 } : null);
  }

  function visibleCommands() {
    if (!menu) return [];
    const query = menu.query.trim();
    if (!query) return COMMANDS.slice(0, 8);
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(query) || c.keywords.includes(query),
    ).slice(0, 8);
  }

  function applyCommand(command: Command) {
    const area = areaRef.current;
    const pos = area?.selectionStart ?? draft.length;
    const lineStart = draft.lastIndexOf("\n", pos - 1) + 1;
    const lineEnd = draft.indexOf("\n", pos);
    const end = lineEnd === -1 ? draft.length : lineEnd;
    const typed = draft.slice(lineStart, pos).replace(/^\/[^\s]*$/, "") + command.insert;
    const body = `${draft.slice(0, lineStart)}${typed}${draft.slice(end)}`;
    const parsed = splitMarker(body);
    setMarker(parsed.marker);
    setDraft(parsed.body);
    setMenu(null);
    caretRef.current = parsed.body.length;
  }

  // ⌘B / ⌘I / ⌘E wrap the selection in Markdown, and unwrap it again if the markers are
  // already there — the way Notion toggles the style on the same keystroke.
  function wrapSelection(pair: string) {
    const area = areaRef.current;
    if (!area) return;
    const from = area.selectionStart ?? 0;
    const to = area.selectionEnd ?? 0;
    const selected = draft.slice(from, to);
    const open = draft.slice(Math.max(0, from - pair.length), from);
    const close = draft.slice(to, to + pair.length);
    const next =
      open === pair && close === pair
        ? `${draft.slice(0, from - pair.length)}${selected}${draft.slice(to + pair.length)}`
        : `${draft.slice(0, from)}${pair}${selected || "text"}${pair}${draft.slice(to)}`;
    const inserted = open === pair && close === pair ? -pair.length : pair.length;
    setDraft(next);
    caretRef.current = Math.max(0, to + inserted);
  }

  function indentBlock(out: boolean) {
    if (marker.kind === "code" || marker.kind === "divider") return false;
    const depth = marker.depth + (out ? -1 : 1);
    if (depth < 0 || depth > MAX_DEPTH) return false;
    const next = { ...marker, depth };
    setMarker(next);
    const list = doc.slice();
    list[editing!] = joinMarker(next, draft);
    commit(list);
    return true;
  }

  function selectedSource() {
    if (!range) return "";
    return joinBlocks(doc.slice(range.from, range.to + 1));
  }

  function copySelected(cut: boolean) {
    const text = selectedSource();
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
    if (cut) deleteRange();
  }

  function deleteRange() {
    if (!range) return;
    const next = doc.slice();
    next.splice(range.from, range.to - range.from + 1, "");
    commit(next);
    setRange(null);
    startEdit(range.from, "");
  }

  function onRangeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!range) return;
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "a") {
      e.preventDefault();
      setRange({ from: 0, to: doc.length - 1 });
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "c") {
      e.preventDefault();
      copySelected(false);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "x") {
      e.preventDefault();
      copySelected(true);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "b") {
      // Bold the whole selection, markers and all, the way Notion wraps picked text.
      e.preventDefault();
      const next = doc.slice();
      for (let i = range.from; i <= range.to; i++) {
        const parsed = splitMarker(next[i]);
        if (!isBlank(parsed.marker, parsed.body)) {
          next[i] = joinMarker(parsed.marker, `**${parsed.body}**`);
        }
      }
      commit(next);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setRange(null);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") {
      e.preventDefault();
      deleteRange();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "Home") {
      e.preventDefault();
      setRange(null);
      moveCaretToBlock(range.from, false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "End") {
      e.preventDefault();
      setRange(null);
      moveCaretToBlock(range.to, true);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing over a selection replaces it, exactly like Notion.
      e.preventDefault();
      const next = doc.slice();
      next.splice(range.from, range.to - range.from + 1, "");
      commit(next);
      setRange(null);
      setEditing(range.from);
      setMarker({ kind: "none", depth: 0 });
      setDraft(e.key);
      caretRef.current = 1;
    }
  }

  function blockIndexAt(target: EventTarget | null): number | null {
    const el = (target as HTMLElement | null)?.closest?.("[data-block-index]");
    if (!el || el.closest("textarea")) return null;
    const raw = el.getAttribute("data-block-index");
    return raw === null ? null : Number(raw);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const area = e.currentTarget;
    const visible = visibleCommands();

    if (menu && visible.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenu({ ...menu, selected: (menu.selected + 1) % visible.length });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenu({ ...menu, selected: (menu.selected - 1 + visible.length) % visible.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyCommand(visible[menu.selected]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      closeEdit(editing!);
      return;
    }
    // First ⌘A takes the block's text, the next one takes the whole document.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      if ((area.selectionEnd ?? 0) > (area.selectionStart ?? 0)) {
        const index = editing!;
        const next = doc.slice();
        next[index] = joinMarker(marker, draft);
        commit(next);
        setEditing(null);
        setMenu(null);
        setRange({ from: 0, to: doc.length - 1 });
        wrapRef.current?.focus();
      } else {
        area.select();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      const pair = key === "b" ? "**" : key === "i" ? "*" : key === "e" ? "`" : null;
      if (pair) {
        e.preventDefault();
        wrapSelection(pair);
        return;
      }
    }
    if (e.key === "Tab" && indentBlock(!e.shiftKey)) {
      e.preventDefault();
      return;
    }
    // Block-to-block caret travel, so you never have to reach for the mouse.
    if (e.key === "ArrowUp" && (area.selectionStart ?? 0) === 0 && editing! > 0) {
      e.preventDefault();
      setRange(null);
      moveCaretToBlock(editing! - 1, true);
      return;
    }
    if (
      e.key === "ArrowDown" &&
      (area.selectionStart ?? 0) === draft.length &&
      editing! < doc.length - 1
    ) {
      e.preventDefault();
      setRange(null);
      moveCaretToBlock(editing! + 1, false);
      return;
    }
    // Shift+Enter is only a soft line break where Markdown keeps one — a paragraph or
    // code. A single-line marker would silently drop everything after the newline.
    const softBreak = marker.kind === "none" || marker.kind === "code";
    if (
      e.key === "Enter" &&
      (!e.shiftKey || !softBreak) &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      onEnter(area);
      return;
    }
    // Backspace at the margin gives the line back: one level out first, then plain text.
    if (
      e.key === "Backspace" &&
      marker.kind !== "none" &&
      marker.kind !== "code" &&
      (area.selectionStart ?? 0) === 0 &&
      area.selectionEnd === 0
    ) {
      e.preventDefault();
      if (marker.depth > 0) {
        const outdented = { ...marker, depth: marker.depth - 1 };
        setMarker(outdented);
        const next = doc.slice();
        next[editing!] = joinMarker(outdented, draft);
        commit(next);
        return;
      }
      if (marker.kind === "divider") {
        setMarker({ kind: "none", depth: 0 });
        setDraft("");
        const next = doc.slice();
        next[editing!] = "";
        commit(next);
        caretRef.current = 0;
        return;
      }
      setDraft(joinMarker(marker, draft));
      setMarker({ kind: "none", depth: 0 });
      caretRef.current = 0;
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeEdit(editing!);
    }
  }

  function onInput(area: HTMLTextAreaElement, value: string) {
    const pos = area.selectionStart ?? value.length;
    setCaret(pos);
    if (marker.kind === "divider") {
      setMarker({ kind: "none", depth: 0 });
      setDraft(value);
      return;
    }
    if (marker.kind === "none") {
      const adopted = adoptMarker(value);
      if (adopted) {
        const stripped = value.length - adopted.body.length;
        setMarker(adopted.marker);
        setDraft(adopted.body);
        caretRef.current = Math.max(0, pos - stripped);
        return;
      }
    }
    setDraft(value);
  }

  function onPaste(area: HTMLTextAreaElement, pasted: string) {
    const text = pasted.replace(/\r\n/g, "\n").replace(/\t/g, INDENT);
    if (!text.includes("\n")) return false;
    // Multi-line Markdown lands as real blocks instead of one paragraph with newlines.
    const pos = area.selectionStart ?? draft.length;
    const head = draft.slice(0, pos);
    const tail = draft.slice(pos);
    const incoming = editBlocks(text);
    const out: string[] = [];
    if (head) out.push(joinMarker(marker, head));
    out.push(...incoming);
    if (tail) out.push(joinMarker({ kind: "none", depth: 0 }, tail));
    const next = doc.slice();
    const at = editing!;
    next.splice(at, 1, ...out);
    commit(next);
    // Land in the last pasted block, which is where Notion leaves the caret.
    const focus = at + (head ? incoming.length : incoming.length - 1);
    const parsed = splitMarker(next[focus] ?? "");
    setEditing(focus);
    setMarker(parsed.marker);
    setDraft(parsed.body);
    caretRef.current = parsed.body.length;
    return true;
  }

  const selected = (index: number) => !!range && index >= range.from && index <= range.to;

  return (
    <div
      ref={wrapRef}
      tabIndex={-1}
      onKeyDown={onRangeKeyDown}
      onMouseDown={(e) => {
        const index = blockIndexAt(e.target);
        drag.current = index === null ? null : { from: index, moved: false };
        if (range) setRange(null);
      }}
      onMouseMove={(e) => {
        if (!drag.current) return;
        const index = blockIndexAt(e.target);
        if (index === null) return;
        if (index !== drag.current.from) drag.current.moved = true;
        if (!drag.current.moved) return;
        // Dragging is a document-level gesture: the block being edited gives up the caret.
        setEditing(null);
        setMenu(null);
        suppressClick.current = true;
        setRange({ from: Math.min(drag.current.from, index), to: Math.max(drag.current.from, index) });
      }}
      className="space-y-0.5 outline-none"
    >
      {doc.map((block, index) => {
        if (editing === index) {
          const visible = visibleCommands();
          const area = (
            <div className="relative">
              <div
                ref={ghostRef}
                aria-hidden
                className={`md-ghost pointer-events-none absolute inset-0 whitespace-pre-wrap [overflow-wrap:break-word] text-text ${textClass(marker)}`}
              >
                <Ghost src={draft} caret={caret} />
              </div>
              <textarea
                ref={areaRef}
                value={draft}
                spellCheck={false}
                onChange={(e) => {
                  onInput(e.currentTarget, e.target.value);
                  updateMenu(e.currentTarget, e.target.value);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onPaste={(e) => {
                  if (onPaste(e.currentTarget, e.clipboardData.getData("text"))) e.preventDefault();
                }}
                onKeyDown={onKeyDown}
                onClick={(e) => {
                  updateMenu(e.currentTarget, draft);
                  setCaret(e.currentTarget.selectionStart ?? 0);
                }}
                onBlur={() => closeEdit(index)}
                placeholder={PLACEHOLDER[marker.kind]}
                rows={1}
                className={`md-ghost-input relative w-full resize-none overflow-hidden bg-transparent text-transparent caret-text outline-none placeholder:text-faint ${textClass(marker)}`}
              />
            </div>
          );

          const menuNode = menu && visible.length > 0 && (
            <div className="absolute left-2 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-overlay shadow-lg shadow-black/10">
              <div className="border-b border-border px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-faint">
                Basic blocks
              </div>
              {visible.map((command, i) => (
                <button
                  key={command.label}
                  type="button"
                  // mousedown fires before the textarea's blur, which would close the editor
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyCommand(command);
                  }}
                  onMouseEnter={() => setMenu((m) => (m ? { ...m, selected: i } : m))}
                  className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] ${
                    menu.selected === i ? "bg-elevated" : ""
                  }`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted">
                    <command.icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{command.label}</span>
                    <span className="block truncate text-[12px] text-faint">{command.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          );

          if (marker.kind === "divider") {
            return (
              <div key={index} data-block-index={index} className="relative px-2 py-0.5">
                <hr className="border-border" />
                {menuNode}
              </div>
            );
          }
          if (marker.kind === "code") {
            return (
              <div key={index} data-block-index={index} className="relative my-2 rounded-lg border border-border bg-surface p-3">
                {area}
                {menuNode}
              </div>
            );
          }
          if (marker.kind === "quote") {
            return (
              <div
                key={index}
                data-block-index={index}
                className="relative my-2 border-l-2 border-border-strong pl-3"
                style={{ marginLeft: marker.depth * INDENT_PX }}
              >
                {area}
                {menuNode}
              </div>
            );
          }
          const glyph =
            marker.kind === "bullet"
              ? "•"
              : marker.kind === "ordered"
                ? `${marker.n}.`
                : marker.kind === "todo"
                  ? ""
                  : null;
          return (
            <div
              key={index}
              data-block-index={index}
              className="relative flex items-start gap-2 px-2 py-0.5"
              style={{ marginLeft: marker.depth * INDENT_PX }}
            >
              {glyph !== null && (
                <span className="flex w-4 shrink-0 justify-end pt-[3px] text-[13px] text-faint">
                  {marker.kind === "todo" ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={marker.checked}
                      aria-label={marker.checked ? "Mark as not done" : "Mark as done"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const next = { ...marker, checked: !marker.checked };
                        setMarker(next);
                        const list = doc.slice();
                        list[index] = joinMarker(next, draft);
                        commit(list);
                      }}
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] transition-colors hover:border-accent ${
                        marker.checked ? "border-accent bg-accent text-white" : "border-border-strong bg-bg"
                      }`}
                    >
                      {marker.checked ? "✓" : ""}
                    </button>
                  ) : (
                    glyph
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">{area}</div>
              {menuNode}
            </div>
          );
        }

        if (block.trim() === "") {
          return (
            <div
              key={index}
              data-block-index={index}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                startEdit(index, "");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") startEdit(index, "");
              }}
              className={`w-full cursor-text rounded-md px-2 py-0.5 text-left text-[13.5px] text-faint transition-colors ${
                selected(index) ? "md-block-selected" : "hover:bg-elevated/40"
              }`}
            >
              Type / for commands
            </div>
          );
        }

        return (
          <div
            key={index}
            data-block-index={index}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              clickPoint.current = { x: e.clientX, y: e.clientY };
              startEdit(index, block);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") startEdit(index, block);
            }}
            className={`w-full cursor-text rounded-md px-2 py-0.5 text-left transition-colors ${
              selected(index) ? "md-block-selected" : "hover:bg-elevated/40"
            }`}
          >
            <MarkdownBlock
              block={parseBlock(block)}
              onToggleTodo={(item, checked) => {
                // Ticking a box from the finished document is one character of Markdown.
                const next = doc.slice();
                next[index] = setTodoChecked(block, item, checked);
                commit(next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
