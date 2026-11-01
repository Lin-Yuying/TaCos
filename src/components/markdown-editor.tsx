"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { MarkdownBlock, type IssueContext } from "@/components/markdown";
import {
  CodeCopyButton,
  CodeLanguageMenu,
  CodeOptionsMenu,
  CodeTokens,
  useLineNumbers,
} from "@/components/code-block-controls";
import { tokenize } from "@/lib/code-highlight";
import {
  applyInlineStyle,
  ESCAPABLE,
  formatBlockSpan,
  INDENT,
  occurrenceAt,
  parseBlock,
  safeHref,
  setCodeLang,
  setTodoChecked,
  splitBlocks,
  visiblePassage,
  type BlockSpan,
  type PassageAnchor,
  type PassageStyle,
} from "@/lib/markdown";

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
// Notion opens a code block on the space after the fence; the language is optional,
// so both "``` " and "```ts " land here.
const FENCE_OPEN = /^```([\w+#.-]*)\s$/;
const FENCE_ONLY = /^```([\w+#.-]*)$/;
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
    // the `>` on the second line when it is written back. Only the first line's indent
    // is moved into `depth`, because `joinMarker` puts it back from there.
    return { marker: { kind: "none", depth }, body: raw.slice(first.length - text.length) };
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
  // The first line's indent lives in `depth` (drawn as a margin) and must not also stay
  // in the body: `joinMarker` writes the padding back, so keeping both added a level of
  // spaces on every Enter.
  return { marker: { kind: "none", depth }, body: text };
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

// Same indentation rule for a block that is not currently open in the textarea. Code
// gets leading spaces on each line; everything with a marker nests one level.
function indentRaw(raw: string, out: boolean): string {
  const parsed = splitMarker(raw);
  if (parsed.marker.kind === "divider") return raw;
  if (parsed.marker.kind === "code") {
    const body = parsed.body
      .split("\n")
      .map((line) => {
        if (out) return line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^\t/, "");
        return line.trim() === "" ? line : `${INDENT}${line}`;
      })
      .join("\n");
    return joinMarker(parsed.marker, body);
  }
  const depth = Math.min(MAX_DEPTH, Math.max(0, parsed.marker.depth + (out ? -1 : 1)));
  return depth === parsed.marker.depth ? raw : joinMarker({ ...parsed.marker, depth }, parsed.body);
}

// Notion-style input rules: the marker is recognised the moment it is complete, so
// typing "# " turns the line into a heading and "``` " opens a code block. A bare
// fence waits for the space (or Enter) so the user can still type a language after it.
function adoptMarker(body: string): { marker: Marker; body: string } | null {
  if (!body.includes("\n")) {
    const fence = FENCE_OPEN.exec(body);
    if (fence) return { marker: { kind: "code", depth: 0, lang: fence[1] }, body: "" };
  }
  const indent = /^\s*/.exec(body)![0];
  const text = body.slice(indent.length);
  // Notion opens a quote when a straight quotation mark is followed by a space.
  if (text === '" ') {
    return { marker: { kind: "quote", depth: depthOfIndent(indent) }, body: "" };
  }
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

type InlineRule = {
  // "escape" is not a style: it is the backslash in front of a literal character,
  // kept in the mirror so the caret still lines up with the textarea.
  kind: "code" | "bold" | "bolditalic" | "strike" | "italic" | "link" | "escape";
  re: RegExp;
};
const INLINE_RULES: InlineRule[] = [
  { kind: "code", re: /^`([^`\n]+)`/ },
  { kind: "bolditalic", re: /^\*\*\*([^*\n]+)\*\*\*/ },
  { kind: "bold", re: /^\*\*([^*\n]+)\*\*/ },
  { kind: "bolditalic", re: /^___([^_\n]+)___/ },
  { kind: "bold", re: /^__([^_\n]+)__/ },
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
    // The backslash keeps its width (hidden or faint) while the character after it is
    // painted as plain text, so the mirror matches the parser's reading of `\*`.
    if (src[i] === "\\" && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      if (buffer) {
        nodes.push({ type: "text", text: buffer, start: bufferStart });
        buffer = "";
      }
      nodes.push({ type: "styled", kind: "escape", pre: "\\", inner: src[i + 1], post: "", start: i });
      i += 2;
      continue;
    }
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

// The open line is a transparent textarea over an inert mirror, so a link there has no
// anchor to catch the click. Reading the same inline pass that draws the mirror lets a
// click on a link's label behave the way it does in a finished block.
function linkHrefAt(src: string, at: number): string | null {
  if (at < 0) return null;
  for (const node of ghostNodes(src)) {
    if (node.type !== "styled" || node.kind !== "link" || node.inner.length === 0) continue;
    const from = node.start + node.pre.length;
    if (at < from || at > from + node.inner.length) continue;
    const href = /^\]\(([^)\s]+)\)$/.exec(node.post)?.[1];
    if (!href) return null;
    const safe = safeHref(href);
    return safe === "#" ? null : safe;
  }
  return null;
}

// The text a reader can see between two textarea offsets: emphasis markers are hidden
// by the ghost layer, so a quote taken here is the same one a rendered selection gives.
function visibleSlice(src: string, from: number, to: number): string {
  let visible = 0;
  let out = "";
  for (const node of ghostNodes(src)) {
    const text = node.type === "text" ? node.text : node.inner;
    const start = Math.max(0, from - visible);
    const end = Math.min(text.length, to - visible);
    if (end > start) out += text.slice(start, end);
    visible += text.length;
  }
  return out;
}

// Inverse of `visibleSlice`: where a visible character sits in the textarea's raw value,
// so a selection can be restored after the formatter rewrites its markers.
function visibleToRaw(src: string, at: number): number {
  let left = at;
  let end = src.length;
  for (const node of ghostNodes(src)) {
    const text = node.type === "text" ? node.text : node.inner;
    if (left <= text.length) {
      return node.type === "text" ? node.start + left : node.start + node.pre.length + left;
    }
    left -= text.length;
    end =
      node.type === "text"
        ? node.start + node.text.length
        : node.start + node.pre.length + node.inner.length + node.post.length;
  }
  return end;
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

function Ghost({ src, caret, codeLang }: { src: string; caret: number; codeLang?: string }) {
  // Code is highlighted the same way in the editor and the finished block; only colours
  // are applied, so the mirror keeps the textarea's metrics and the caret stays put.
  const tokens = useMemo(() => (codeLang === undefined ? null : tokenize(src, codeLang)), [src, codeLang]);
  if (tokens) return <CodeTokens tokens={tokens} />;
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
            {node.kind === "italic" || node.kind === "bolditalic" ? (
              <span style={node.kind === "bolditalic" ? styleFor("bold") : undefined}>
                {skewed(node.inner)}
              </span>
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
  const point = doc.caretPositionFromPoint?.(x, y);
  if (point) {
    // The mirror layer is pointer-events-none, so hit-testing lands on the textarea
    // behind it; for form controls the reported offset is already a value index.
    if (point.offsetNode instanceof HTMLTextAreaElement) return point.offset;
    if (point.offsetNode === root) return null;
    return textOffsetIn(root, point.offsetNode, point.offset);
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  if (!range) return null;
  if (range.startContainer instanceof HTMLTextAreaElement) return range.startOffset;
  if (range.startContainer === root) return null;
  return textOffsetIn(root, range.startContainer, range.startOffset);
}

function textOffsetIn(root: HTMLElement, container: Node, offsetInNode: number): number | null {
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
const TEXT_BASE = "m-0 border-0 p-0";

function textClass(marker: Marker): string {
  if (marker.kind === "code") return `${TEXT_BASE} font-mono text-[12.5px] leading-relaxed`;
  if (marker.kind === "heading")
    return `${TEXT_BASE} leading-[1.5] font-semibold tracking-tight ${HEADING_SIZE[marker.level - 1]}`;
  return `${TEXT_BASE} text-[13.5px] leading-relaxed`;
}

// A finished line draws its own vertical margins — a paragraph sits in a `my-1.5` <p>,
// a heading carries `mb-1.5` (its `first:` top margin always applies here, since every
// block is its own wrapper). The editable line has to reserve the same space, empty or
// not: if the open line is a different height from the one it replaced, everything under
// it slides on every click. A list dot is a 13px glyph with 3px of top padding, so a
// finished list row is 2px taller than its text; `min-h` gives the editable row that
// same overhang.
function editRhythm(marker: Marker): string {
  if (marker.kind === "heading") return "mb-1.5";
  if (marker.kind === "bullet" || marker.kind === "ordered") return "my-1.5 min-h-[24px]";
  if (marker.kind === "quote" || marker.kind === "code" || marker.kind === "divider") return "";
  return "my-1.5";
}

// A reference to a trashed task is dead: the page already reads it as the words it
// replaced, and opening that line must not put the raw `[TEST-21](issue:…)` back on
// screen. Editing the words then replaces the dead reference for good.
function plainTrashedRefs(src: string, deleted?: Record<string, string>): string {
  if (!deleted) return src;
  return src.replace(/\[[^\]\n]*\]\(issue:([^)\s]+)\)/g, (whole, id: string) => deleted[id] ?? whole);
}

const STYLE_SHORTCUTS: Record<string, PassageStyle> = {
  b: "bold",
  i: "italic",
  e: "code",
  x: "strike",
};

function shortcutStyle(event: React.KeyboardEvent): PassageStyle | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const style = STYLE_SHORTCUTS[event.key.toLowerCase()];
  if (!style) return null;
  // Strikethrough lives on ⌘⇧X; ⌘X must stay Cut.
  if (style === "strike" && !event.shiftKey) return null;
  return style;
}

export type MarkdownEditorHandle = {
  formatSelection: (style: PassageStyle) => void;
  // Inline style over a whole-block selection: the toolbar's Bold/Italic buttons on a
  // drag that never became a text selection.
  formatRange: (style: PassageStyle) => void;
  // Style applied to passages picked in the rendered document. Each span carries its
  // block index and visible offsets inside that block, so no text search is involved.
  formatParts: (parts: BlockSpan[], style: PassageStyle) => void;
  // Commit the open line and hand back the resulting document plus the visible passage
  // under the caret, so the page can create a task or a comment from uncommitted text.
  takeDraftSelection: () => { source: string; anchor: PassageAnchor } | null;
  // Whole blocks picked by a drag across lines, projected to the visible text an AI
  // rewrite can be anchored to.
  takeBlockSelection: () => { source: string; anchor: PassageAnchor } | null;
  // Commit the open line and hand back the document. The page needs this before it
  // unmounts the editor on an outside click: without it, the line still being typed
  // never reaches onChange and is lost.
  flush: () => string;
};

export type DraftSelection = { text: string; x: number; y: number };
export type BlockSelection = { x: number; y: number };

// Selecting inside the open textarea is invisible to `window.getSelection()`: the browser
// keeps a collapsed document selection for form fields. The editor therefore reports the
// textarea's own range upwards so the page can show the same floating toolbar.
export const MarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    issues?: IssueContext;
    onTextSelection?: (selection: DraftSelection | null) => void;
    // A drag across blocks selects the blocks themselves, not a text range, so the page
    // needs its own signal to float the formatting toolbar over them.
    onBlockSelection?: (selection: BlockSelection | null) => void;
    // Document-level history lives in the page. The editor only asks for it when the
    // open line has nothing of its own left to undo.
    onUndo?: () => boolean;
    onRedo?: () => boolean;
  }
>(function MarkdownEditor(
  { value, onChange, placeholder, issues, onTextSelection, onBlockSelection, onUndo, onRedo },
  ref
) {
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
  // The line-number column drawn beside the open code block.
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Opening a tall block (a code card) swaps it for a one-row textarea for a single
  // frame. The page content briefly shrinks, the scroll container clamps its offset and
  // never gets it back — remember where it was so the layout effect below can undo that.
  const openScroll = useRef<{ el: HTMLElement; top: number } | null>(null);
  // Same preference the finished blocks read, so numbers do not vanish on click.
  const showLineNumbers = useLineNumbers();
  const caretRef = useRef<number | null>(null);
  // Line indentation has to keep a multi-line selection selected, so it queues the
  // replacement range the same way a keystroke queues a caret position.
  const selectRef = useRef<{ start: number; end: number } | null>(null);
  const clickPoint = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ from: number; moved: boolean; selecting?: boolean } | null>(null);
  const suppressClick = useRef(false);
  // A drag that turns into a block selection unmounts the textarea on purpose. The blur
  // it fires on the way out must not run the normal "save this line" path again.
  const skipBlur = useRef(false);
  const emitted = useRef(value);
  // What the open line showed the moment it was opened. A dead reference is spelled out
  // as plain text there, so "nothing typed" is a comparison against this, not the source.
  const untouched = useRef<string | null>(null);
  // Once locally committed, `emitted` matches the value coming back from the page, so
  // this only re-seeds on a genuinely external change (undo/redo, task replacement).
  // Toolbar formatting inside the open line rewrites the textarea value programmatically,
  // which the browser's native undo stack does not record. These snapshots make ⌘Z step
  // back through those rewrites before falling through to the document history.
  const draftPast = useRef<{ value: string; start: number; end: number }[]>([]);
  const draftFuture = useRef<{ value: string; start: number; end: number }[]>([]);

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setBlocks(editBlocks(value));
    setEditing(null);
    setRange(null);
    setMenu(null);
    draftPast.current = [];
    draftFuture.current = [];
  }, [value]);

  // A block range has no text selection behind it, so the page cannot see where to float
  // its toolbar. Report the top-left corner of the first selected block instead.
  useEffect(() => {
    if (!onBlockSelection) return;
    if (!range) {
      onBlockSelection(null);
      return;
    }
    const el = wrapRef.current?.querySelector(`[data-block-index="${range.from}"]`);
    const rect = el?.getBoundingClientRect();
    if (!rect) return;
    onBlockSelection({
      x: Math.min(Math.max(12, rect.left), window.innerWidth - 120),
      y: Math.max(8, rect.top - 34),
    });
  }, [range, onBlockSelection]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${area.scrollHeight}px`;
  }, [draft, editing, marker]);

  // The one-row first frame above clamps the page's scroll offset; put it back before
  // the click point is mapped onto the mirror layer, or the caret lands on line 1.
  useLayoutEffect(() => {
    const saved = openScroll.current;
    if (!saved) return;
    openScroll.current = null;
    if (saved.el.scrollTop !== saved.top) saved.el.scrollTop = saved.top;
  }, [editing]);

  // The open code block keeps the gutter the finished block has. The mirror layer
  // already lays the text out, so a line's first character says where its number goes;
  // a blank line takes the row after the previous one, and a long line that wraps keeps
  // one number on its first row — the same rule the finished block follows.
  useLayoutEffect(() => {
    if (editing === null || marker.kind !== "code" || !showLineNumbers) return;
    const ghost = ghostRef.current;
    const gutter = gutterRef.current;
    if (!ghost || !gutter) return;

    const place = () => {
      const numbers = Array.from(gutter.querySelectorAll<HTMLElement>("[data-code-line]"));
      if (numbers.length === 0) return;
      const nodes: { node: Text; start: number }[] = [];
      const walker = document.createTreeWalker(ghost, NodeFilter.SHOW_TEXT);
      let total = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent?.length ?? 0;
        if (length > 0) nodes.push({ node: node as Text, start: total });
        total += length;
      }
      if (nodes.length === 0) return;

      const lineHeight = Number.parseFloat(getComputedStyle(ghost).lineHeight) || 20;
      const ghostTop = ghost.getBoundingClientRect().top;
      // A glyph's rect starts below its line box by the font's ascent offset. The finished
      // block draws numbers on the line box, so drop that offset here too — otherwise every
      // number hops down a couple of pixels the moment the block opens for editing.
      const numberBox = numbers[0].getBoundingClientRect();
      const glyphProbe = document.createRange();
      glyphProbe.selectNodeContents(numbers[0]);
      const glyphOffset = glyphProbe.getBoundingClientRect().top - numberBox.top;
      const range = document.createRange();
      const locate = (offset: number, from: number) => {
        let index = Math.min(from, nodes.length - 1);
        while (index + 1 < nodes.length && nodes[index + 1].start <= offset) index += 1;
        return index;
      };

      const lines = draft.split("\n");
      const starts: number[] = [];
      let running = 0;
      for (const line of lines) {
        starts.push(running);
        running += line.length + 1;
      }

      let cursor = 0;
      let previousTop = 0;
      let previousRows = 1;
      for (let i = 0; i < numbers.length; i += 1) {
        const line = lines[i] ?? "";
        if (line.length === 0) {
          const top = i === 0 ? 0 : previousTop + previousRows * lineHeight;
          numbers[i].style.top = `${top}px`;
          previousTop = top;
          previousRows = 1;
          continue;
        }
        const start = starts[i] ?? 0;
        cursor = locate(start, cursor);
        const startNode = nodes[cursor].node;
        const startLocal = Math.min(start - nodes[cursor].start, startNode.length - 1);
        const endOffset = start + line.length - 1;
        const endCursor = locate(endOffset, cursor);
        const endNode = nodes[endCursor].node;
        const endLocal = Math.min(endOffset - nodes[endCursor].start + 1, endNode.length);

        range.setStart(startNode, startLocal);
        range.setEnd(startNode, Math.min(startLocal + 1, startNode.length));
        const first = range.getBoundingClientRect();
        range.setEnd(endNode, endLocal);
        // Inline styling splits a line across spans; the distinct row tops are what
        // tells the next blank line how far down to start.
        const rows = Math.max(
          1,
          new Set(
            Array.from(range.getClientRects()).map((rect) => Math.round(rect.top - ghostTop))
          ).size
        );
        const top = first.top - ghostTop - glyphOffset;
        numbers[i].style.top = `${top}px`;
        previousTop = top;
        previousRows = rows;
        cursor = endCursor;
      }
    };

    place();
    // Wrapping changes with the column's width, so the numbers have to follow a resize.
    const observer = new ResizeObserver(place);
    observer.observe(ghost);
    return () => observer.disconnect();
  }, [draft, editing, marker, showLineNumbers]);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    if (selectRef.current) {
      const { start, end } = selectRef.current;
      selectRef.current = null;
      area.focus({ preventScroll: true });
      area.setSelectionRange(start, end);
      setCaret(start);
      return;
    }
    if (caretRef.current == null) return;
    area.focus({ preventScroll: true });
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
    const rect = area.getBoundingClientRect();
    // Clicks outside the mirrored text (bullet glyphs, trailing space) still land on
    // the line: left of the text is column 0, anything else is the end of the line.
    const offset =
      offsetAtPoint(ghost, point.x, point.y) ?? (point.x <= rect.left ? 0 : draft.length);
    const clamped = Math.max(0, Math.min(draft.length, offset));
    area.focus({ preventScroll: true });
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

  // A selection inside the textarea never reaches `window.getSelection()`, so the page
  // gets the range (and a spot for the toolbar) from the field itself.
  function reportDraftSelection(area: HTMLTextAreaElement, point?: { x: number; y: number }) {
    if (!onTextSelection) return;
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    const text = end > start ? draft.slice(start, end) : "";
    if (!text.trim()) {
      onTextSelection(null);
      return;
    }
    const rect = area.getBoundingClientRect();
    const anchor = point ?? { x: rect.left + 12, y: rect.top };
    onTextSelection({
      text: text.slice(0, 1_000),
      x: Math.min(Math.max(12, anchor.x), window.innerWidth - 120),
      y: Math.max(8, anchor.y - 34),
    });
  }

  function commit(next: string[]) {
    emitted.current = joinBlocks(next);
    setBlocks(next);
    onChange(emitted.current);
  }

  function rememberScroll() {
    let el: HTMLElement | null = wrapRef.current?.parentElement ?? null;
    while (el) {
      const { overflowY } = getComputedStyle(el);
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        openScroll.current = { el, top: el.scrollTop };
        return;
      }
      el = el.parentElement;
    }
    openScroll.current = null;
  }

  function openBlock(index: number, text: string) {
    rememberScroll();
    const parsed = splitMarker(text);
    // Code is shown exactly as written, even if it happens to look like a reference.
    const shown =
      parsed.marker.kind === "code" ? parsed.body : plainTrashedRefs(parsed.body, issues?.deleted);
    untouched.current = shown;
    draftPast.current = [];
    draftFuture.current = [];
    setEditing(index);
    setMarker(parsed.marker);
    setDraft(shown);
    return { marker: parsed.marker, shown };
  }

  function startEdit(index: number, text: string) {
    const { marker: opened, shown } = openBlock(index, text);
    setMenu(null);
    caretRef.current = opened.kind === "code" && shown === "" ? 0 : shown.length;
  }

  // A drag that ends on the same block still fires a click. Swapping the block for a
  // textarea would wipe the selection and the formatting toolbar that hangs off it.
  function holdingSelection() {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed;
  }

  // Notion always leaves a line to write on at the end of the page, so clicking the
  // space below the last block starts a new one instead of doing nothing.
  function startNewBlock() {
    rememberScroll();
    let list = doc;
    // The strip below the document stays clickable while a line is open, so the line
    // being left has to be written first — starting a new one must not drop it.
    if (editing !== null) {
      if (draft !== untouched.current) {
        const raw = isBlank(marker, draft) ? "" : joinMarker(marker, draft);
        if ((list[editing] ?? "") !== raw) {
          list = list.slice();
          if (raw === "") list.splice(editing, 1);
          else list[editing] = raw;
        }
      }
      if (areaRef.current === document.activeElement) skipBlur.current = true;
      onTextSelection?.(null);
    }
    const last = list.length - 1;
    if (last < 0 || list[last].trim() !== "") list = [...list, ""];
    if (list !== doc) commit(list);
    setEditing(list.length - 1);
    setMarker({ kind: "none", depth: 0 });
    setDraft("");
    untouched.current = "";
    setMenu(null);
    draftPast.current = [];
    draftFuture.current = [];
    caretRef.current = 0;
  }

  // Leaving a line without touching it leaves the document alone. Rebuilding it would
  // re-serialize every separator, silently dropping the blank lines the author put
  // between paragraphs or list runs — just clicking around must never re-flow the page.
  function commitBlock(index: number) {
    // The line can be open with a dead reference already spelled out as text. If the
    // words on screen were not touched, the stored reference stays — restoring the task
    // from the Trash brings its chip back.
    if (draft === untouched.current) return;
    const raw = isBlank(marker, draft) ? "" : joinMarker(marker, draft);
    if ((doc[index] ?? "") === raw) return;
    const next = doc.slice();
    if (raw === "") next.splice(index, 1);
    else next[index] = raw;
    commit(next);
  }

  function closeEdit(index: number) {
    commitBlock(index);
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
    untouched.current = "";
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
    untouched.current = "";
    caretRef.current = 0;
  }

  function moveCaretToBlock(index: number, atEnd: boolean) {
    // Stepping to another line writes the one being left first. Leaving the draft in the
    // textarea drops it instead: the block falls back to its stored text, so words deleted
    // in the open line come back and words typed there disappear.
    let list = doc;
    let target = index;
    if (editing !== null && draft !== untouched.current) {
      const raw = isBlank(marker, draft) ? "" : joinMarker(marker, draft);
      if ((list[editing] ?? "") !== raw) {
        list = list.slice();
        if (raw === "") {
          list.splice(editing, 1);
          if (target > editing) target -= 1;
        } else {
          list[editing] = raw;
        }
        commit(list);
      }
    }
    const raw = list[target];
    if (raw === undefined) return;
    const { shown } = openBlock(target, raw);
    caretRef.current = atEnd ? shown.length : 0;
  }

  function onEnter(area: HTMLTextAreaElement) {
    // Enter finishes a shortcut that has no space to trigger it: "```" opens a code
    // block and a lone dash becomes a bullet, the way Notion commits those markers.
    if (marker.kind === "none") {
      const fence = FENCE_ONLY.exec(draft);
      if (fence) {
        setMarker({ kind: "code", depth: 0, lang: fence[1] });
        setDraft("");
        caretRef.current = 0;
        return;
      }
      if (/^\s*[-*+]\s*$/.test(draft)) {
        setMarker({ kind: "bullet", depth: depthOfIndent(/^\s*/.exec(draft)![0]) });
        setDraft("");
        caretRef.current = 0;
        return;
      }
    }
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
    // The slash query is only the text before the caret; the rest of the line stays, or
    // picking Quote on `/quote` in front of a sentence would delete that sentence.
    const head = draft.slice(lineStart, pos).replace(/^\/[^\s]*$/, "");
    const line = `${head}${command.insert}${draft.slice(pos, end)}`;
    const body = `${draft.slice(0, lineStart)}${line}${draft.slice(end)}`;
    const parsed = splitMarker(body);
    setMarker(parsed.marker);
    setDraft(parsed.body);
    setMenu(null);
    // The block's type lives outside `draft`, so a command that only changes the marker
    // (Quote on a line whose text stays the same) looks untouched when it closes. Save it
    // now, the same way the code-language picker does.
    if (editing !== null) {
      const list = doc.slice();
      list[editing] = joinMarker(parsed.marker, parsed.body);
      commit(list);
      untouched.current = parsed.body;
    }
    // The caret stays between the new marker and the text it was put in front of.
    const caretInBody = lineStart + head.length + command.insert.length;
    caretRef.current = Math.max(0, parsed.body.length - (body.length - caretInBody));
  }

  // ⇧⌘Z / ⌘Z inside the open line: first walk back the programmatic formatting this line
  // received, then fall through to the page's document history.
  function stepDraft(redo: boolean): boolean {
    const area = areaRef.current;
    const source = redo ? draftFuture : draftPast;
    const target = source.current.pop();
    if (!target) return false;
    const start = area?.selectionStart ?? 0;
    const end = area?.selectionEnd ?? 0;
    (redo ? draftPast : draftFuture).current.push({ value: draft, start, end });
    setDraft(target.value);
    setMenu(null);
    selectRef.current = { start: target.start, end: target.end };
    return true;
  }

  // ⌘B / ⌘I / ⌘E / ⌘⇧X apply the same canonical formatter the toolbar uses, so the
  // selection stays put and pressing the shortcut again removes the style.
  function applyDraftStyle(style: PassageStyle): boolean {
    const area = areaRef.current;
    if (!area || editing === null) return false;
    const from = area.selectionStart ?? 0;
    const to = area.selectionEnd ?? 0;
    if (to <= from) return false;
    // Textarea offsets count the hidden markers; the formatter speaks visible text.
    const visibleFrom = visibleSlice(draft, 0, from).length;
    const visibleTo = visibleSlice(draft, 0, to).length;
    const next = applyInlineStyle(draft, visibleFrom, visibleTo, style);
    if (next === null || next === draft) return false;
    draftPast.current.push({ value: draft, start: from, end: to });
    if (draftPast.current.length > 100) draftPast.current.shift();
    draftFuture.current = [];
    setDraft(next);
    setMenu(null);
    selectRef.current = {
      start: visibleToRaw(next, visibleFrom),
      end: visibleToRaw(next, visibleTo),
    };
    return true;
  }

  // A block-range drag has no text offsets, so every covered line is styled as a whole.
  function formatSelectedBlocks(style: PassageStyle) {
    if (!range) return;
    const next = doc.slice();
    let changed = false;
    for (let i = range.from; i <= range.to; i++) {
      const raw = next[i];
      if (raw === undefined) continue;
      const formatted = formatBlockSpan(raw, 0, Number.MAX_SAFE_INTEGER, style);
      if (formatted === null || formatted === raw) continue;
      next[i] = formatted;
      changed = true;
    }
    if (!changed) return;
    commit(next);
    // The range stays selected, so the same button toggles the style back off.
  }

  function shiftDepth(out: boolean) {
    if (marker.kind === "divider") return false;
    const depth = marker.depth + (out ? -1 : 1);
    if (depth < 0 || depth > MAX_DEPTH) return false;
    const next = { ...marker, depth };
    setMarker(next);
    const list = doc.slice();
    list[editing!] = joinMarker(next, draft);
    commit(list);
    return true;
  }

  // A code block has no marker to nest, so Tab writes real leading spaces on every
  // selected line — exactly what Notion does inside a code block (and in any editor).
  function indentCodeLines(area: HTMLTextAreaElement, out: boolean): boolean {
    const from = area.selectionStart ?? 0;
    const to = area.selectionEnd ?? 0;
    const start = draft.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const probe = to > from ? to - 1 : to;
    const stop = draft.indexOf("\n", probe);
    const end = stop === -1 ? draft.length : stop;
    let firstDelta = 0;
    let changed = false;
    const shifted = draft
      .slice(start, end)
      .split("\n")
      .map((line, i) => {
        let next = line;
        if (out) {
          if (line.startsWith(INDENT)) next = line.slice(INDENT.length);
          else if (line.startsWith("\t")) next = line.slice(1);
        } else if (line.trim() !== "") {
          next = `${INDENT}${line}`;
        }
        if (i === 0) firstDelta = next.length - line.length;
        if (next !== line) changed = true;
        return next;
      });
    if (!changed) return false;
    const segment = shifted.join("\n");
    if (from === to) caretRef.current = Math.max(start, from + firstDelta);
    else selectRef.current = { start, end: end + segment.length - (end - start) };
    setDraft(draft.slice(0, start) + segment + draft.slice(end));
    return true;
  }

  function indentSelection(area: HTMLTextAreaElement, out: boolean) {
    if (marker.kind === "divider") return false;
    return marker.kind === "code" ? indentCodeLines(area, out) : shiftDepth(out);
  }

  // The same Tab rule for a whole-block selection: lists move a level, paragraphs gain
  // an indent, and code lines inside the picked blocks each get their own spaces.
  function indentRange(out: boolean) {
    if (!range) return;
    const next = doc.slice();
    for (let i = range.from; i <= range.to; i++) next[i] = indentRaw(next[i], out);
    commit(next);
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
    if ((e.metaKey || e.ctrlKey) && key === "x" && !e.shiftKey) {
      e.preventDefault();
      copySelected(true);
      return;
    }
    const style = shortcutStyle(e);
    if (style) {
      // Every covered line gets its own marker pair; the range stays selected so the
      // same shortcut (or toolbar button) can take the style off again.
      e.preventDefault();
      formatSelectedBlocks(style);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      indentRange(e.shiftKey);
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.altKey) {
      const redo = e.shiftKey;
      if (stepDraft(redo)) {
        e.preventDefault();
        return;
      }
      // With nothing typed on this line, the last change was somewhere else in the
      // document; hand the keystroke to the page's history. Otherwise let the browser
      // run its native undo over the typing in this textarea.
      if (draft === untouched.current) {
        const handled = redo ? onRedo?.() : onUndo?.();
        if (handled) {
          e.preventDefault();
          return;
        }
      }
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
    const style = shortcutStyle(e);
    if (style) {
      e.preventDefault();
      applyDraftStyle(style);
      return;
    }
    if (e.key === "Tab" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      indentSelection(area, e.shiftKey);
      return;
    }
    // Block-to-block caret travel, so you never have to reach for the mouse. While an
    // input method is composing, arrows move inside its candidate list instead — taking
    // them here would break the IME and abandon the line being typed.
    if (
      e.key === "ArrowUp" &&
      !e.nativeEvent.isComposing &&
      (area.selectionStart ?? 0) === 0 &&
      editing! > 0
    ) {
      e.preventDefault();
      setRange(null);
      moveCaretToBlock(editing! - 1, true);
      return;
    }
    if (
      e.key === "ArrowDown" &&
      !e.nativeEvent.isComposing &&
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
    // Backspace at the very start of a plain line reaches into the block above: an empty
    // line is dropped, and typed text is glued onto the previous block instead. Without
    // this the caret stops dead at column 0 and the line above cannot be deleted.
    if (
      e.key === "Backspace" &&
      marker.kind === "none" &&
      (area.selectionStart ?? 0) === 0 &&
      area.selectionEnd === 0 &&
      editing! > 0
    ) {
      e.preventDefault();
      const index = editing!;
      const prevIndex = index - 1;
      const parsed = splitMarker(doc[prevIndex]);
      if (draft === "") {
        const next = doc.slice();
        next.splice(index, 1);
        commit(next);
        if (parsed.marker.kind === "divider") {
          setEditing(null);
          return;
        }
        moveCaretToBlock(prevIndex, true);
        return;
      }
      if (parsed.marker.kind === "code" || parsed.marker.kind === "divider") {
        moveCaretToBlock(prevIndex, true);
        return;
      }
      const merged = `${parsed.body}${draft}`;
      const next = doc.slice();
      next.splice(prevIndex, 2, joinMarker(parsed.marker, merged));
      commit(next);
      setEditing(prevIndex);
      setMarker(parsed.marker);
      setDraft(merged);
      caretRef.current = parsed.body.length;
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
      // The marker is chrome, not text: Backspace at the margin turns the line back into
      // a plain paragraph. Writing the raw marker into the draft (that is what
      // `joinMarker` here would do) prints a stray "-" or ">" into the document — a
      // character nobody typed. The line itself stays put so the caret keeps its place;
      // a second Backspace on the now empty paragraph reaches into the block above,
      // exactly like any other plain line.
      const index = editing!;
      setMarker({ kind: "none", depth: 0 });
      const next = doc.slice();
      next[index] = draft;
      commit(next);
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

  // The toolbar's format buttons edit the open line directly. Its text is local until
  // blur, so rewriting the stored document here would be overwritten by the draft.
  useImperativeHandle(
    ref,
    () => ({
      formatSelection(style: PassageStyle) {
        applyDraftStyle(style);
      },
      formatRange(style: PassageStyle) {
        formatSelectedBlocks(style);
      },
      formatParts(parts: BlockSpan[], style: PassageStyle) {
        const next = doc.slice();
        let changed = false;
        for (const part of parts) {
          const raw = next[part.block];
          if (raw === undefined) continue;
          const formatted = formatBlockSpan(raw, part.from, part.to, style);
          if (formatted === null || formatted === raw) continue;
          next[part.block] = formatted;
          changed = true;
        }
        if (changed) commit(next);
      },
      takeDraftSelection() {
        const area = areaRef.current;
        if (!area || editing === null) return null;
        const from = area.selectionStart ?? 0;
        const to = area.selectionEnd ?? 0;
        if (to <= from) return null;
        const quote = visibleSlice(draft, from, to).trim();
        if (!quote) return null;

        const raw = isBlank(marker, draft) ? "" : joinMarker(marker, draft);
        const willWrite = draft !== untouched.current && (doc[editing] ?? "") !== raw;
        let blocks = doc;
        let source = emitted.current;
        if (willWrite) {
          blocks = doc.slice();
          if (raw === "") blocks.splice(editing, 1);
          else blocks[editing] = raw;
          source = joinBlocks(blocks);
        }
        // Same numbering a rendered selection uses: count the quote in the visible text
        // that precedes the selection, then hand the page a plain-text anchor.
        const prefix = [
          ...blocks.slice(0, editing),
          joinMarker(marker, draft.slice(0, from)),
        ].join("\n");

        commitBlock(editing);
        if (area === document.activeElement) skipBlur.current = true;
        setEditing(null);
        setMenu(null);
        onTextSelection?.(null);
        return { source, anchor: { quote: quote.slice(0, 1_000), occurrence: occurrenceAt(prefix, quote) } };
      },
      takeBlockSelection() {
        if (!range) return null;
        const source = emitted.current;
        const quote = visiblePassage(doc.slice(range.from, range.to + 1).join("\n")).trim();
        if (!quote) return null;
        const prefix = doc.slice(0, range.from).join("\n");
        return {
          source,
          anchor: { quote: quote.slice(0, 1_000), occurrence: occurrenceAt(prefix, quote) },
        };
      },
      flush() {
        if (editing !== null) commitBlock(editing);
        return emitted.current;
      },
    }),
    [commitBlock, doc, draft, editing, marker, onTextSelection, range]
  );

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
        if (!drag.current.selecting) {
          drag.current.selecting = true;
          // Leaving the open line ends its edit. Keep what was typed first: a drag that
          // becomes a selection should never swallow the last keystrokes.
          if (editing !== null) {
            commitBlock(editing);
            onTextSelection?.(null);
            if (areaRef.current === document.activeElement) skipBlur.current = true;
            setEditing(null);
          }
          setMenu(null);
          // Backspace/Delete and typing belong to the block selection from here on, so
          // the wrapper has to own the keyboard before the textarea disappears.
          wrapRef.current?.focus({ preventScroll: true });
        }
        suppressClick.current = true;
        setRange({ from: Math.min(drag.current.from, index), to: Math.max(drag.current.from, index) });
      }}
      className="space-y-0.5 outline-none"
    >
      {doc.map((block, index) => {
        if (editing === index) {
          const visible = visibleCommands();
          // The open line keeps the vertical rhythm of the line it replaced — even while
          // it is empty — so clicking into a line never moves the document under it.
          const rhythm = editRhythm(marker);
          const area = (
            <div className="relative">
              <div
                ref={ghostRef}
                aria-hidden
                className={`md-ghost pointer-events-none absolute inset-0 whitespace-pre-wrap [overflow-wrap:break-word] text-text ${textClass(marker)}`}
              >
                <Ghost src={draft} caret={caret} codeLang={marker.kind === "code" ? marker.lang : undefined} />
              </div>
              <textarea
                ref={areaRef}
                value={draft}
                spellCheck={false}
                data-md-draft
                onChange={(e) => {
                  onInput(e.currentTarget, e.target.value);
                  updateMenu(e.currentTarget, e.target.value);
                }}
                onSelect={(e) => {
                  setCaret(e.currentTarget.selectionStart ?? 0);
                  reportDraftSelection(e.currentTarget);
                }}
                onMouseUp={(e) => reportDraftSelection(e.currentTarget, { x: e.clientX, y: e.clientY })}
                onPaste={(e) => {
                  if (onPaste(e.currentTarget, e.clipboardData.getData("text"))) e.preventDefault();
                }}
                onKeyDown={onKeyDown}
                onClick={(e) => {
                  // A finished block opens its links on a plain click; the open line has
                  // to answer the same way, or a document is only half usable while its
                  // text is being edited. A drag that selected text still wins.
                  const at = e.currentTarget.selectionStart ?? 0;
                  if (at === (e.currentTarget.selectionEnd ?? 0)) {
                    const href = linkHrefAt(draft, at);
                    if (href) window.open(href, "_blank", "noopener,noreferrer");
                  }
                  updateMenu(e.currentTarget, draft);
                  setCaret(at);
                }}
                onBlur={() => {
                  onTextSelection?.(null);
                  if (skipBlur.current) {
                    skipBlur.current = false;
                    return;
                  }
                  closeEdit(index);
                }}
                placeholder={
                  // Only the opening line invites you to write; every other empty line
                  // stays quiet, the way Notion keeps placeholders out of the body.
                  index !== 0
                    ? ""
                    : marker.kind === "none"
                      ? (placeholder ?? PLACEHOLDER.none)
                      : PLACEHOLDER[marker.kind]
                }
                rows={1}
                className={`md-ghost-input relative block w-full resize-none overflow-hidden bg-transparent text-transparent caret-text outline-none placeholder:text-faint ${textClass(marker)}`}
              />
            </div>
          );

          const menuNode = menu && visible.length > 0 && (
            <div className="absolute left-2 top-full z-20 mt-1 max-h-[min(60vh,360px)] w-72 max-w-[calc(100%-1rem)] overflow-y-auto rounded-lg border border-border bg-overlay shadow-lg shadow-black/10">
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
                <hr className="my-4 border-border" />
                {menuNode}
              </div>
            );
          }
          if (marker.kind === "code") {
            // The language is part of the fence, so picking one while the block is open
            // writes it straight into the source — closing the line keeps it.
            const setLanguage = (lang: string) => {
              const next = { ...marker, lang };
              const list = doc.slice();
              list[index] = joinMarker(next, draft);
              setMarker(next);
              commit(list);
              untouched.current = draft;
            };
            return (
              <div key={index} data-block-index={index} className="relative px-2 py-0.5">
                {/* Same header and gutter the finished block draws, so opening a code
                    block neither shrinks it nor makes its line numbers vanish. */}
                <div className="group/code my-2 rounded-lg border border-border bg-surface">
                  <div className="flex h-7 items-center gap-1 border-b border-border/70 pl-1 pr-1">
                    <div className="ml-auto flex items-center gap-1">
                      <CodeLanguageMenu lang={marker.lang} onChange={setLanguage} />
                      <CodeOptionsMenu />
                      <CodeCopyButton code={draft} />
                    </div>
                  </div>
                  <div className="flex p-3">
                    {showLineNumbers && (
                      <div
                        ref={gutterRef}
                        aria-hidden
                        className="relative w-10 shrink-0 select-none font-mono text-[12.5px] leading-relaxed text-faint tabular-nums"
                      >
                        {draft.split("\n").map((_, line) => (
                          <span key={line} data-code-line className="absolute right-4 top-0">
                            {line + 1}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">{area}</div>
                  </div>
                </div>
                {menuNode}
              </div>
            );
          }
          if (marker.kind === "quote") {
            return (
              <div key={index} data-block-index={index} className="relative px-2 py-0.5">
                <div
                  className="my-2 border-l-2 border-border-strong pl-3"
                  style={{ marginLeft: marker.depth * INDENT_PX }}
                >
                  {area}
                </div>
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
                // The dot starts on the line's own left edge (the same place the text
                // began before the marker was typed); numbers stay right-aligned so
                // 9. and 10. line up the way Notion does.
                // The open line carries its `my-1.5` on the text column, while a finished
                // list carries the same 6px above the whole row. Give the glyph that
                // space too, or the box drops 6px the moment Enter commits the line.
                <span
                  data-md-glyph
                  className={`flex w-4 shrink-0 pt-[9px] text-[13px] leading-relaxed text-faint ${
                    marker.kind === "ordered" ? "justify-end" : "justify-start"
                  }`}
                >
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
              <div className={`min-w-0 flex-1 ${rhythm}`}>{area}</div>
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
                if (holdingSelection()) return;
                startEdit(index, "");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") startEdit(index, "");
              }}
              className={`my-1.5 w-full min-h-[22px] cursor-text rounded-md px-2 py-0.5 text-left text-[13.5px] text-faint transition-colors ${
                selected(index) ? "md-block-selected" : "hover:bg-elevated/40"
              }`}
            >
              {index === 0 ? (placeholder ?? PLACEHOLDER.none) : ""}
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
              if (holdingSelection()) return;
              // A link inside the finished line is a link, not a way into edit mode.
              if (e.target instanceof Element && e.target.closest("a")) return;
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
              issues={issues}
              onToggleTodo={(item, checked) => {
                // Ticking a box from the finished document is one character of Markdown.
                const next = doc.slice();
                next[index] = setTodoChecked(block, item, checked);
                commit(next);
              }}
              onCodeLangChange={(lang) => {
                const next = doc.slice();
                next[index] = setCodeLang(block, 0, lang);
                commit(next);
              }}
            />
          </div>
        );
      })}
      {/* Always present: this strip is what keeps everything below the document in the
          same place whether or not a line is open. */}
      <div
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault();
          startNewBlock();
        }}
        className="min-h-[80px] w-full cursor-text"
      />
    </div>
  );
});
