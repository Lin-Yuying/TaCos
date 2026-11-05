// A deliberately small Markdown subset: enough for project documents, parsed into
// plain data so the renderer can emit React nodes (never raw HTML) and the editor
// can round-trip every block back to its source text.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  // ***text*** — the only stacking this subset has to express (bold + italic)
  | { type: "bolditalic"; text: string }
  | { type: "code"; text: string }
  | { type: "strike"; text: string }
  | { type: "link"; text: string; href: string }
  // {color:#rrggbb}text{/color} — a text color the document editor writes and reads back
  | { type: "color"; color: string; children: Inline[] }
  // [[Page title]] or [[Page title|page-id]] — a link to another document
  | { type: "page"; text: string; pageId?: string }
  // [PROJ-12](issue:<id>) — an inline reference to a task
  | { type: "issue"; text: string; issueId: string };

export type TableAlign = "left" | "center" | "right";

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; depth: number; text: Inline[] }
  | { kind: "paragraph"; depth: number; lines: Inline[][] }
  // GFM pipe table. Cells stay raw Markdown so the reader can parse them inline and
  // honour `<br>`; the editor keeps editing the very same lines as text.
  | { kind: "table"; align: (TableAlign | null)[]; header: string[]; rows: string[][] }
  | { kind: "quote"; depth: number; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: { text: Inline[]; depth: number }[] }
  | { kind: "todo"; items: { text: Inline[]; checked: boolean; depth: number }[] }
  | { kind: "code"; lang: string; body: string }
  | { kind: "divider" }
  // ![alt](https://…) on its own line — a picture block, the way Notion imports one
  | { kind: "image"; alt: string; src: string; depth: number }
  // ![[Page title]] on its own line — the target document is inlined here
  | { kind: "embed"; text: string; pageId?: string; depth: number };

const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*(\d+)[.)]\s+/;
const TODO = /^\s*[-*+]\s+\[( |x|X)\]\s+/;
const QUOTE = /^\s*>\s?/;
const FENCE = /^```(\w*)\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})$/;
const EMBED = /^\s*!\[\[([^\]\n|]+)(?:\|([^\]\n|]+))?\]\]\s*$/;
const IMAGE = /^\s*!\[([^\]\n]*)\]\(\s*([^)\s]+)\s*\)\s*$/;

// GFM lets a backslash take the meaning away from any ASCII punctuation character.
export const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;

// Two spaces per level, the same convention Notion writes out when you press Tab.
export const INDENT = "  ";

export function indentDepth(line: string): number {
  const leading = /^\s*/.exec(line)![0];
  const width = leading.includes("\t") ? leading.length * 2 : leading.length;
  return Math.min(4, Math.floor(width / INDENT.length));
}

// Grouping key used to decide which consecutive lines belong to one block.
function markerKind(line: string): string | null {
  if (line.trim() === "") return null;
  // These always stand alone, so they break the run of lines being collected.
  if (FENCE.test(line) || HEADING.test(line) || DIVIDER.test(line.trim())) return null;
  if (IMAGE.test(line) || EMBED.test(line)) return null;
  if (TODO.test(line)) return "todo";
  if (QUOTE.test(line)) return "quote";
  if (BULLET.test(line)) return "bullet";
  if (ORDERED.test(line)) return "ordered";
  return "paragraph";
}

// Blank lines always separate blocks; inside a run of text, a block also ends when
// its marker type changes or a heading/divider/fence shows up.
export function splitBlocks(src: string): string[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      const start = i;
      while (i < lines.length && lines[i].trim() === "") i += 1;
      // One blank line is the ordinary separator between two blocks; each one beyond
      // that is a line the author left empty on purpose, and it has to come back as an
      // empty block so it survives a round trip through the stored Markdown. Leading
      // blank lines stay ignored — there is nothing above them for a separator to mean.
      const placed = start > 0 ? i - start - 1 : 0;
      for (let n = 0; n < placed; n += 1) blocks.push("");
      continue;
    }
    if (FENCE.test(line)) {
      const start = i++;
      while (i < lines.length && !FENCE.test(lines[i])) i += 1;
      if (i < lines.length) i += 1;
      blocks.push(lines.slice(start, i).join("\n"));
      continue;
    }
    if (HEADING.test(line) || DIVIDER.test(line.trim()) || EMBED.test(line) || IMAGE.test(line)) {
      blocks.push(line);
      i += 1;
      continue;
    }
    const kind = markerKind(line);
    const start = i;
    while (i < lines.length && markerKind(lines[i]) === kind) i += 1;
    blocks.push(lines.slice(start, i).join("\n"));
  }

  return blocks;
}

// One inline token, with the raw offsets the editor needs to map rendered text back
// onto the Markdown source (`inner` is where the visible text begins after markers).
type InlineToken = {
  type: Inline["type"];
  text: string;
  start: number;
  inner: number;
  end: number;
  href?: string;
  pageId?: string;
  issueId?: string;
  color?: string;
};

// Only #rgb and #rrggbb. Anything else stays ordinary text, so a document cannot
// carry an arbitrary CSS color.
export function documentColor(value: string): string | null {
  const hex = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(hex);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

function tokenizeInline(text: string, depth = 0): InlineToken[] {
  const out: InlineToken[] = [];
  let buffer = "";
  let bufferStart = 0;
  let i = 0;

  const flush = (end: number) => {
    if (buffer) {
      out.push({ type: "text", text: buffer, start: bufferStart, inner: bufferStart, end });
      buffer = "";
    }
  };

  while (i < text.length) {
    // A backslash pins the next punctuation character as literal text, so `\*` never
    // opens an italic run — the same escape Notion imports and exports.
    if (text[i] === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      if (!buffer) bufferStart = i;
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    const rest = text.slice(i);

    if (depth < 6) {
      const color = rest.match(/^\{color:(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\}([^\n]*?)\{\/color\}/);
      const hex = color ? documentColor(color[1]) : null;
      if (color && hex) {
        flush(i);
        const open = `{color:${color[1]}}`;
        out.push({
          type: "color",
          text: color[2],
          color: hex,
          start: i,
          inner: i + open.length,
          end: i + color[0].length,
        });
        i += color[0].length;
        continue;
      }
    }

    const code = rest.match(/^`([^`\n]+)`/);
    if (code) {
      flush(i);
      out.push({ type: "code", text: code[1], start: i, inner: i + 1, end: i + code[0].length });
      i += code[0].length;
      continue;
    }

    const boldItalic = rest.match(/^\*\*\*([^*\n]+)\*\*\*/);
    if (boldItalic) {
      flush(i);
      out.push({
        type: "bolditalic",
        text: boldItalic[1],
        start: i,
        inner: i + 3,
        end: i + boldItalic[0].length,
      });
      i += boldItalic[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*([^*\n]+)\*\*/);
    if (bold) {
      flush(i);
      out.push({ type: "bold", text: bold[1], start: i, inner: i + 2, end: i + bold[0].length });
      i += bold[0].length;
      continue;
    }

    // Underscore variants exist so the formatter can wrap text that already contains a
    // `*` (stray or from an older edit) without producing unparseable markers.
    const boldItalicUnderscore = rest.match(/^___([^_\n]+)___/);
    if (boldItalicUnderscore) {
      flush(i);
      out.push({
        type: "bolditalic",
        text: boldItalicUnderscore[1],
        start: i,
        inner: i + 3,
        end: i + boldItalicUnderscore[0].length,
      });
      i += boldItalicUnderscore[0].length;
      continue;
    }

    const boldUnderscore = rest.match(/^__([^_\n]+)__/);
    if (boldUnderscore) {
      flush(i);
      out.push({
        type: "bold",
        text: boldUnderscore[1],
        start: i,
        inner: i + 2,
        end: i + boldUnderscore[0].length,
      });
      i += boldUnderscore[0].length;
      continue;
    }

    const strike = rest.match(/^~~([^~\n]+)~~/);
    if (strike) {
      flush(i);
      out.push({ type: "strike", text: strike[1], start: i, inner: i + 2, end: i + strike[0].length });
      i += strike[0].length;
      continue;
    }

    const italic = rest.match(/^\*([^*\n]+)\*/) ?? rest.match(/^_([^_\n]+)_/);
    if (italic) {
      flush(i);
      out.push({ type: "italic", text: italic[1], start: i, inner: i + 1, end: i + italic[0].length });
      i += italic[0].length;
      continue;
    }

    // Must come before the generic link rule: both start with "[text](...)".
    const issue = rest.match(/^\[([^\]\n]+)\]\(issue:([^)\s]+)\)/);
    if (issue) {
      flush(i);
      out.push({
        type: "issue",
        text: issue[1],
        issueId: issue[2],
        start: i,
        inner: i + 1,
        end: i + issue[0].length,
      });
      i += issue[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]\n]*)\]\(([^)\s]+)\)/);
    if (link) {
      flush(i);
      out.push({
        type: "link",
        text: link[1] || link[2],
        href: safeHref(link[2]),
        start: i,
        inner: i + 1,
        end: i + link[0].length,
      });
      i += link[0].length;
      continue;
    }

    const autoLink = rest.match(/^<(https?:\/\/[^>\s]+)>/);
    if (autoLink) {
      flush(i);
      out.push({
        type: "link",
        text: autoLink[1],
        href: safeHref(autoLink[1]),
        start: i,
        inner: i + 1,
        end: i + autoLink[0].length,
      });
      i += autoLink[0].length;
      continue;
    }

    const page = rest.match(/^\[\[([^\]\n|]+)(?:\|([^\]\n|]+))?\]\]/);
    if (page) {
      flush(i);
      const title = page[1].trim();
      out.push({
        type: "page",
        text: title,
        pageId: page[2]?.trim(),
        start: i,
        inner: i + 2 + page[1].indexOf(title),
        end: i + page[0].length,
      });
      i += page[0].length;
      continue;
    }

    if (!buffer) bufferStart = i;
    buffer += text[i];
    i += 1;
  }

  flush(text.length);
  return out;
}

export function parseInline(text: string, depth = 0): Inline[] {
  return tokenizeInline(text, depth).map((token): Inline => {
    switch (token.type) {
      case "color":
        return { type: "color", color: token.color ?? "", children: parseInline(token.text, depth + 1) };
      case "link":
        return { type: "link", text: token.text, href: token.href ?? "#" };
      case "page":
        return { type: "page", text: token.text, pageId: token.pageId };
      case "issue":
        return { type: "issue", text: token.text, issueId: token.issueId ?? "" };
      case "bold":
      case "italic":
      case "bolditalic":
      case "code":
      case "strike":
        return { type: token.type, text: token.text };
      default:
        return { type: "text", text: token.text };
    }
  });
}

// javascript:/data: URLs would turn a document into an attack on the reader.
export function safeHref(href: string): string {
  return documentLinkHref(href) ?? "#";
}

// The selection toolbar only stores a web or mail address. Anything else is refused.
export function documentLinkHref(href: string): string | null {
  const value = href.trim();
  return /^(https?:|mailto:)/i.test(value) && !/[\s<>]/.test(value) ? value : null;
}

// Pictures may only come from the web: a document must not be able to run anything or
// reach into the local network through an image source.
function safeImageSrc(src: string): string | null {
  return /^https?:\/\//i.test(src.trim()) ? src.trim() : null;
}

// `| a | b |` is two cells: the outer pipes only delimit the row. A backslash before a
// pipe keeps it inside the cell, which is the one escape GFM tables promise.
function splitTableRow(line: string): string[] {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  let escapedTail = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "|";
      i += 1;
      escapedTail = true;
      continue;
    }
    escapedTail = false;
    if (ch === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  if (text.startsWith("|")) cells.shift();
  if (!escapedTail && text.endsWith("|")) cells.pop();
  return cells.map((entry) => entry.trim());
}

const TABLE_ALIGN_CELL = /^:?-+:?$/;

function tableAlign(cell: string): TableAlign | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * A pipe table is only recognised when the chunk is one entirely — the header, the
 * `---|---` row, then rows to the end. Text sharing the chunk keeps the chunk a
 * paragraph, so nothing is silently reflowed.
 */
function parseTable(lines: string[]): Block | null {
  if (lines.length < 2) return null;
  const [headerLine, dividerLine] = lines;
  if (!headerLine.includes("|") || !dividerLine.includes("|")) return null;
  const divider = splitTableRow(dividerLine);
  if (divider.length === 0 || !divider.every((cell) => TABLE_ALIGN_CELL.test(cell))) return null;
  const header = splitTableRow(headerLine);
  if (header.length !== divider.length) return null;
  const body = lines.slice(2);
  if (body.some((line) => !line.includes("|"))) return null;
  return {
    kind: "table",
    align: divider.map(tableAlign),
    header,
    rows: body.map((line) => {
      const row = splitTableRow(line);
      return header.map((_, i) => row[i] ?? "");
    }),
  };
}

export function parseBlock(raw: string): Block {
  const lines = raw.split("\n");
  const first = lines[0] ?? "";

  const fence = FENCE.exec(first);
  if (fence) {
    const last = lines[lines.length - 1];
    const body = last?.startsWith("```") ? lines.slice(1, -1) : lines.slice(1);
    return { kind: "code", lang: fence[1] ?? "", body: body.join("\n") };
  }

  if (DIVIDER.test(first.trim())) return { kind: "divider" };

  const embed = EMBED.exec(first);
  if (embed) {
    return {
      kind: "embed",
      text: embed[1].trim(),
      pageId: embed[2]?.trim(),
      depth: indentDepth(first),
    };
  }

  const image = IMAGE.exec(first);
  if (image) {
    const src = safeImageSrc(image[2]);
    // An unsafe URL stays on the page as the text it was typed as, never as a request.
    if (src) return { kind: "image", alt: image[1].trim(), src, depth: indentDepth(first) };
  }

  const heading = HEADING.exec(first);
  if (heading) {
    const level = Math.min(6, heading[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
    return { kind: "heading", level, depth: indentDepth(first), text: parseInline(heading[2].trim()) };
  }

  if (QUOTE.test(first)) {
    return {
      kind: "quote",
      depth: indentDepth(first),
      lines: lines.map((line) => parseInline(line.replace(QUOTE, ""))),
    };
  }

  if (TODO.test(first)) {
    return {
      kind: "todo",
      items: lines
        .filter((line) => line.trim())
        .map((line) => {
          const match = TODO.exec(line)!;
          return {
            text: parseInline(line.slice(match[0].length)),
            checked: match[1] !== " ",
            depth: indentDepth(line),
          };
        }),
    };
  }

  if (BULLET.test(first) || ORDERED.test(first)) {
    const ordered = ORDERED.test(first);
    return {
      kind: "list",
      ordered,
      items: lines
        .filter((line) => line.trim())
        .map((line) => ({
          text: parseInline(line.replace(ordered ? ORDERED : BULLET, "")),
          depth: indentDepth(line),
        })),
    };
  }

  const table = parseTable(lines);
  if (table) return table;

  // The editor draws a paragraph's first-line indent as `depth` (a margin) and strips
  // the spaces from the text, so the finished block must do the same — keeping both
  // would indent the line twice and make it shift the moment an edit commits.
  const body = lines.slice();
  body[0] = body[0].slice(/^\s*/.exec(first)![0].length);
  return { kind: "paragraph", depth: indentDepth(first), lines: body.map((line) => parseInline(line)) };
}

// Flips one checkbox inside a stored list block without touching anything else, so
// clicking a box in a finished document is a single-character edit.
export function setTodoChecked(raw: string, index: number, checked: boolean): string {
  let seen = -1;
  return raw
    .split("\n")
    .map((line) => {
      const match = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/.exec(line);
      if (!match) return line;
      seen += 1;
      if (seen !== index) return line;
      return `${match[1]}${checked ? "x" : " "}${match[3]}`;
    })
    .join("\n");
}

// Swaps the language on the `index`-th code block's opening fence. Line numbers and
// highlighting are presentation, but the language is part of the document, so the
// picker rewrites the source instead of keeping a side table of it.
export function setCodeLang(raw: string, index: number, lang: string): string {
  const lines = raw.split("\n");
  const fence = lang ? "```" + lang : "```";
  let seen = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!FENCE.test(lines[i])) continue;
    seen += 1;
    if (seen === index) {
      if (lines[i] === fence) return raw;
      lines[i] = fence;
      return lines.join("\n");
    }
    // A fence inside the body is code, not another block: skip to the closing one.
    i += 1;
    while (i < lines.length && !FENCE.test(lines[i])) i += 1;
  }
  return raw;
}

export function parseBlocks(src: string): Block[] {
  return splitBlocks(src).map(parseBlock);
}

/* ------------------------------------------------------------------ *
 * Mapping a rendered passage back onto the stored Markdown.
 *
 * The Overview's selection toolbar sees the text as the reader does — whitespace
 * collapsed, markers hidden — while the document is stored as source. Rebuilding the
 * same normalized text from the source, with every character remembering where it came
 * from, lets a quote turn back into an exact source range that can be wrapped in
 * emphasis markers or swapped for a task reference.
 * ------------------------------------------------------------------ */

export type PassageAnchor = { quote: string; occurrence: number };
export type PassageStyle = "bold" | "italic" | "strike" | "code";

type StyleSegment = {
  kind: Inline["type"];
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  open: string;
  close: string;
};

type MappedChar = { start: number; end: number; seg: StyleSegment | null };
type PassageMap = { text: string; chars: MappedChar[] };

// Same block markers parseBlock strips before inline parsing.
const BLOCK_PREFIXES = [
  /^\s*#{1,6}\s+/,
  /^\s*[-*+]\s+\[[ xX]\]\s?/,
  /^\s*[-*+]\s+/,
  /^\s*\d+[.)]\s+/,
  /^\s*>\s?/,
];

function blockPrefixLength(line: string): number {
  for (const re of BLOCK_PREFIXES) {
    const match = re.exec(line);
    if (match) return match[0].length;
  }
  return 0;
}

function nthIndexOf(text: string, quote: string, occurrence: number): number {
  let index = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    index = text.indexOf(quote, from);
    if (index < 0) return -1;
    from = index + quote.length;
  }
  return index;
}

function passageText(source: string): PassageMap {
  const chars: MappedChar[] = [];
  let text = "";
  let atSpace = false;
  let offset = 0;
  let fenced = false;

  const push = (ch: string, start: number, end: number, seg: StyleSegment | null) => {
    if (/\s/.test(ch)) {
      if (atSpace || text.length === 0) return;
      text += " ";
      chars.push({ start, end, seg });
      atSpace = true;
      return;
    }
    text += ch;
    chars.push({ start, end, seg });
    atSpace = false;
  };

  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      offset += line.length + 1;
      continue;
    }
    if (fenced) {
      for (let k = 0; k < line.length; k++) push(line[k], offset + k, offset + k + 1, null);
    } else {
      const prefix = blockPrefixLength(line);
      const base = offset + prefix;
      const body = line.slice(prefix);
      for (const token of tokenizeInline(body)) {
        const start = base + token.start;
        const visibleEnd = Math.min(base + token.inner + token.text.length, base + token.end);
        const seg: StyleSegment | null =
          token.type === "text"
            ? null
            : {
                kind: token.type,
                start,
                end: base + token.end,
                innerStart: base + token.inner,
                innerEnd: visibleEnd,
                open: body.slice(token.start, token.inner),
                close: body.slice(visibleEnd - base, token.end),
              };
        for (let k = 0; k < token.text.length; k++) {
          const at = base + token.inner + k;
          push(token.text[k], at, at + 1, seg);
        }
      }
    }
    // A line break reads as a space to the reader; blank lines add nothing.
    if (!atSpace && text.length > 0) {
      text += " ";
      chars.push({ start: offset + line.length, end: offset + line.length + 1, seg: null });
      atSpace = true;
    }
    offset += line.length + 1;
  }

  return { text, chars };
}

function locatePassage(map: PassageMap, anchor: PassageAnchor): number {
  if (!anchor.quote) return -1;
  const at = nthIndexOf(map.text, anchor.quote, Math.max(1, anchor.occurrence));
  return at >= 0 ? at : map.text.indexOf(anchor.quote);
}

const SPLITTABLE = new Set<Inline["type"]>(["bold", "italic", "bolditalic", "strike", "code"]);

// Cut a source range out of its surrounding emphasis runs, re-marking whatever is left
// on either side, so inserted markers never land inside `**…**` or between backticks.
function isolatePassage(
  source: string,
  map: PassageMap,
  from: number,
  to: number
): { src: string; start: number; end: number } | null {
  const first = map.chars[from];
  const last = map.chars[to - 1];
  if (!first || !last) return null;

  let src = source;
  let start = first.start;
  let end = last.end;
  const a = first.seg;
  const b = last.seg;

  if (a && a === b) {
    // The passage sits inside one run: wrap it whole, or split the run in three.
    if (start <= a.innerStart && end >= a.innerEnd) return { src, start, end };
    if (!SPLITTABLE.has(a.kind)) return { src, start: a.start, end: a.end };
    const before = src.slice(a.innerStart, start);
    const middle = src.slice(start, end);
    const after = src.slice(end, a.innerEnd);
    const head = before ? `${a.open}${before}${a.close}` : "";
    const tail = after ? `${a.open}${after}${a.close}` : "";
    src = src.slice(0, a.start) + head + middle + tail + src.slice(a.end);
    return { src, start: a.start + head.length, end: a.start + head.length + middle.length };
  }

  let delta = 0;
  if (a && start > a.innerStart && start < a.innerEnd) {
    if (SPLITTABLE.has(a.kind)) {
      const head = `${a.open}${src.slice(a.innerStart, start)}${a.close}`;
      delta = head.length - (start - a.start);
      src = src.slice(0, a.start) + head + src.slice(start);
      start = a.start + head.length;
      end += delta;
    } else {
      // Links and page/issue references are atomic: take the whole node.
      start = a.start;
    }
  }
  if (b && end > b.innerStart + delta && end < b.innerEnd + delta) {
    if (SPLITTABLE.has(b.kind)) {
      const tail = `${b.open}${src.slice(end, b.innerEnd + delta)}${b.close}`;
      src = src.slice(0, end) + tail + src.slice(b.end + delta);
    } else {
      end = b.end + delta;
    }
  }
  return { src, start, end };
}

// Styles one source range, toggling when the range already carries exactly that style.
function styleRange(
  source: string,
  map: PassageMap,
  from: number,
  to: number,
  style: PassageStyle
): string | null {
  const first = map.chars[from];
  const last = map.chars[to - 1];
  if (!first || !last) return null;

  const seg = first.seg;
  const whole = Boolean(
    seg && seg === last.seg && first.start === seg.innerStart && last.end === seg.innerEnd
  );
  if (whole && seg) {
    const inner = source.slice(seg.innerStart, seg.innerEnd);
    const withStyle = (prefix: string) =>
      source.slice(0, seg.start) + prefix + inner + prefix + source.slice(seg.end);
    const bare = source.slice(0, seg.start) + inner + source.slice(seg.end);
    // Pressing the same button again takes the markers away, the way every editor
    // toggles emphasis. Bold over italic (and back) is the one stack Markdown here
    // can carry; other combinations would render their own markers literally.
    if (seg.kind === style) return bare;
    if (seg.kind === "bold" && style === "italic") return withStyle("***");
    if (seg.kind === "italic" && style === "bold") return withStyle("***");
    if (seg.kind === "bolditalic" && style === "bold") return withStyle("*");
    if (seg.kind === "bolditalic" && style === "italic") return withStyle("**");
    return null;
  }

  const isolated = isolatePassage(source, map, from, to);
  if (!isolated) return null;
  const { src, start, end } = isolated;
  const token = { bold: "**", italic: "*", strike: "~~", code: "`" }[style];
  return src.slice(0, start) + token + src.slice(start, end) + token + src.slice(end);
}

export function formatPassage(
  source: string,
  anchor: PassageAnchor,
  style: PassageStyle
): string | null {
  const map = passageText(source);
  const at = locatePassage(map, anchor);
  if (at < 0) return null;
  const end = at + anchor.quote.length;

  // A selection can cover several blocks. Inline markers cannot cross a line break
  // without breaking the block, so every line gets its own pair of markers.
  const runs: [number, number][] = [];
  let runStart = at;
  for (let i = at; i < end; i++) {
    const ch = map.chars[i];
    if (ch && source[ch.start] === "\n") {
      if (i > runStart) runs.push([runStart, i]);
      runStart = i + 1;
    }
  }
  if (end > runStart) runs.push([runStart, end]);

  // Walk backwards so an edit never moves the indices of the runs still to come.
  let src = source;
  for (let i = runs.length - 1; i >= 0; i--) {
    const next = styleRange(src, map, runs[i][0], runs[i][1], style);
    if (next !== null) src = next;
  }
  return src === source ? null : src;
}

/* ------------------------------------------------------------------ *
 * Canonical inline formatting.
 *
 * The old formatting path inserted markers into a quote found by text search, which
 * could land in the wrong place, cut an existing `**…**` in half, or stack styles the
 * renderer cannot parse (leaving literal `*` on the page). This path instead models a
 * line as pieces of visible text, edits the style of the selected characters, and
 * writes every affected piece back with exactly one pair of markers — or with an
 * underscore variant when the text itself contains `*`, so nothing is ever left
 * half-marked.
 * ------------------------------------------------------------------ */

type InlineSet = Set<PassageStyle>;

// `null` marks an atomic inline node (link, page or task reference): it has its own
// syntax and cannot carry emphasis.
type InlinePiece = {
  text: string;
  raw: string;
  style: InlineSet | null;
  // True while `raw` still matches the style, so untouched pieces are emitted verbatim.
  keep: boolean;
};

function styleOfType(type: Inline["type"]): InlineSet | null {
  switch (type) {
    case "bold":
      return new Set(["bold"]);
    case "italic":
      return new Set(["italic"]);
    case "bolditalic":
      return new Set(["bold", "italic"]);
    case "strike":
      return new Set(["strike"]);
    case "code":
      return new Set(["code"]);
    case "link":
    case "page":
    case "issue":
    case "color":
      return null;
    default:
      return new Set();
  }
}

function inlinePieces(src: string): InlinePiece[] {
  return tokenizeInline(src).map((token) => ({
    text: token.text,
    raw: src.slice(token.start, token.end),
    style: styleOfType(token.type),
    keep: true,
  }));
}

function sameStyle(a: InlineSet | null, b: InlineSet | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.size !== b.size) return false;
  for (const style of a) if (!b.has(style)) return false;
  return true;
}

function addStyle(current: InlineSet, style: PassageStyle): InlineSet {
  // Code and strikethrough cannot stack with emphasis in this Markdown subset, so the
  // new style wins. Bold over italic (and back) is the one stack that renders.
  if (style === "code") return new Set(["code"]);
  if (style === "strike") return new Set(["strike"]);
  const next = new Set<PassageStyle>();
  for (const entry of current) if (entry === "bold" || entry === "italic") next.add(entry);
  next.add(style);
  return next;
}

function removeStyle(current: InlineSet, style: PassageStyle): InlineSet {
  const next = new Set(current);
  next.delete(style);
  return next;
}

// Markers that can wrap `inner` without the parser mistaking characters inside it for
// the closing delimiter. Returns null when no form is representable, in which case the
// piece is left as plain text rather than written as broken Markdown.
function markersFor(style: InlineSet, inner: string): string | null {
  const star = inner.includes("*");
  const under = inner.includes("_");
  if (style.has("code")) return inner.includes("`") ? null : "`";
  if (style.has("strike")) return inner.includes("~") ? null : "~~";
  const bold = style.has("bold");
  const italic = style.has("italic");
  if (bold && italic) {
    if (!star) return "***";
    if (!under) return "___";
    return null;
  }
  if (bold) {
    if (!star) return "**";
    if (!under) return "__";
    return null;
  }
  if (italic) {
    if (!star) return "*";
    if (!under) return "_";
    return null;
  }
  return null;
}

/**
 * Toggles `style` over visible character range [from, to) of one line body. Styled
 * runs are split or extended as a whole, so a partial selection inside `**bold**`
 * never produces an unclosed run.
 */
export function applyInlineStyle(
  src: string,
  from: number,
  to: number,
  style: PassageStyle
): string | null {
  const pieces = inlinePieces(src);
  const visible = pieces.map((piece) => piece.text).join("");
  let start = Math.max(0, Math.min(from, visible.length));
  let end = Math.max(start, Math.min(to, visible.length));
  while (start < end && /\s/.test(visible[start])) start += 1;
  while (end > start && /\s/.test(visible[end - 1])) end -= 1;
  if (start >= end) return null;

  let offset = 0;
  const emphasis = style === "bold" || style === "italic";
  let any = false;
  let all = true;
  const overlaps: { index: number; from: number; to: number }[] = [];
  pieces.forEach((piece, index) => {
    const at = offset;
    offset += piece.text.length;
    const a = Math.max(start, at);
    const b = Math.min(end, offset);
    if (b <= a || piece.style === null) return;
    // Whitespace carries no visible style, so it never counts as "already bold" and is
    // never wrapped. Without this, a line with spaces between bold words could not be
    // toggled back off.
    if (!piece.text.trim()) return;
    // Inline code and strikethrough are atomic: emphasis never rewrites them, and they
    // do not count against toggling emphasis off, so ⌘B on a mixed line is reversible.
    if (emphasis && (piece.style.has("code") || piece.style.has("strike"))) return;
    any = true;
    if (!piece.style.has(style)) all = false;
    overlaps.push({ index, from: a - at, to: b - at });
  });
  if (!any) return null;
  const removing = all;

  const next: InlinePiece[] = [];
  const at = new Map(overlaps.map((overlap) => [overlap.index, overlap]));
  pieces.forEach((piece, index) => {
    const overlap = at.get(index);
    if (!overlap || piece.style === null) {
      next.push(piece);
      return;
    }
    const target = removing ? removeStyle(piece.style, style) : addStyle(piece.style, style);
    const push = (text: string, styleSet: InlineSet, keep: boolean, raw = "") => {
      if (text) next.push({ text, raw, style: styleSet, keep });
    };
    // An untouched piece keeps its original bytes so an unrelated selection never
    // rewrites the surrounding Markdown.
    if (overlap.from === 0 && overlap.to === piece.text.length && sameStyle(target, piece.style)) {
      next.push(piece);
      return;
    }
    push(piece.text.slice(0, overlap.from), piece.style, false);
    push(piece.text.slice(overlap.from, overlap.to), target, false);
    push(piece.text.slice(overlap.to), piece.style, false);
  });

  // Neighbouring pieces that ended up with the same style become one run, so a
  // selection crossing two halves of a bold sentence gets one marker pair, not two.
  const merged: InlinePiece[] = [];
  for (const piece of next) {
    const prev = merged[merged.length - 1];
    if (prev && prev.style !== null && piece.style !== null && sameStyle(prev.style, piece.style)) {
      prev.text += piece.text;
      prev.keep = prev.keep && piece.keep;
      if (prev.keep) prev.raw += piece.raw;
      continue;
    }
    merged.push({ ...piece });
  }

  let out = serializePieces(tidyPieces(merged));
  // This subset has no escape syntax, so a marker character inside the text can make a
  // written run read back as something else (literal stars, a dropped stretch). Verify
  // by parsing the result: if the visible text would change, collapse the styled span
  // into one plain run, which cannot collide with itself. If even that does not read
  // back cleanly, leave the document alone rather than corrupt it.
  if (visibleOf(inlinePieces(out)) !== visible) {
    let at = 0;
    let first = -1;
    let last = -1;
    merged.forEach((piece, index) => {
      const end = at + piece.text.length;
      if (end > start && at < end) {
        if (first < 0) first = index;
        last = index;
      }
      at = end;
    });
    if (first < 0) return null;
    const group = merged.slice(first, last + 1);
    if (group.some((piece) => piece.style === null)) return null;
    const base = group[0].style as InlineSet;
    const uniform = group.every((piece) => sameStyle(piece.style, base));
    const collapsed: InlinePiece = {
      text: group.map((piece) => piece.text).join(""),
      raw: "",
      style: removing
        ? removeStyle(uniform ? base : new Set<PassageStyle>(), style)
        : addStyle(uniform ? base : new Set<PassageStyle>(), style),
      keep: false,
    };
    out = serializePieces(
      tidyPieces([...merged.slice(0, first), collapsed, ...merged.slice(last + 1)])
    );
    if (visibleOf(inlinePieces(out)) !== visible) return null;
  }
  return out === src ? null : out;
}

// A styled run never starts or ends with whitespace: markers hugging a space read badly
// and every toggle would otherwise keep dragging the space inside them. The spaces stay
// in the visible text, just outside the markers.
function tidyPieces(pieces: InlinePiece[]): InlinePiece[] {
  const out: InlinePiece[] = [];
  for (const piece of pieces) {
    if (piece.keep || !piece.style || piece.style.size === 0) {
      out.push(piece);
      continue;
    }
    const text = piece.text;
    const lead = text.match(/^\s+/)?.[0] ?? "";
    const tail = text.slice(lead.length).match(/\s+$/)?.[0] ?? "";
    const core = text.slice(lead.length, text.length - tail.length);
    if (lead) out.push({ text: lead, raw: "", style: new Set(), keep: false });
    if (core) out.push({ text: core, raw: "", style: piece.style, keep: false });
    if (tail) out.push({ text: tail, raw: "", style: new Set(), keep: false });
  }
  return out;
}

function serializePieces(pieces: InlinePiece[]): string {
  let out = "";
  for (const piece of pieces) {
    if (piece.keep) {
      out += piece.raw;
      continue;
    }
    if (piece.style === null || piece.style.size === 0) {
      out += piece.text;
      continue;
    }
    const marker = markersFor(piece.style, piece.text);
    out += marker ? `${marker}${piece.text}${marker}` : piece.text;
  }
  return out;
}

function visibleOf(pieces: InlinePiece[]): string {
  return pieces.map((piece) => piece.text).join("");
}

export type BlockSpan = { block: number; from: number; to: number };

/**
 * Applies `style` to visible offsets [from, to) of one stored block. A block can hold
 * several soft-broken lines, and inline markers cannot cross a line break without
 * turning the rest of the block into literal text, so each covered line is formatted
 * on its own.
 */
export function formatBlockSpan(
  source: string,
  from: number,
  to: number,
  style: PassageStyle
): string | null {
  const map = passageText(source);
  let start = Math.max(0, Math.min(from, map.text.length));
  let end = Math.max(start, Math.min(to, map.text.length));
  while (start < end && /\s/.test(map.text[start])) start += 1;
  while (end > start && /\s/.test(map.text[end - 1])) end -= 1;
  if (start >= end) return null;

  const lines = source.split("\n");
  const lineInfo: { start: number; bodyStart: number; bodyEnd: number }[] = [];
  let at = 0;
  for (const line of lines) {
    const prefix = blockPrefixLength(line);
    lineInfo.push({ start: at, bodyStart: at + prefix, bodyEnd: at + line.length });
    at += line.length + 1;
  }
  const lineOf = (sourceAt: number) => {
    let found = 0;
    for (let k = 0; k < lineInfo.length; k++) {
      if (lineInfo[k].start <= sourceAt) found = k;
      else break;
    }
    return found;
  };

  // Line breaks read as one visible space, so visible offsets must be rebased per line.
  // Feeding raw source offsets to applyInlineStyle (which speaks visible text) would
  // count `**` and `# ` markers as characters and format the wrong span.
  const lineVisibleStart = new Map<number, number>();
  for (let i = 0; i < map.chars.length; i++) {
    const char = map.chars[i];
    if (source[char.start] === "\n") continue;
    const index = lineOf(char.start);
    if (!lineVisibleStart.has(index)) lineVisibleStart.set(index, i);
  }

  const ranges = new Map<number, { from: number; to: number }>();
  const addRun = (a: number, b: number) => {
    const first = map.chars[a];
    if (!first || b <= a) return;
    const index = lineOf(first.start);
    const visibleStart = lineVisibleStart.get(index);
    if (visibleStart === undefined) return;
    const runFrom = a - visibleStart;
    const runTo = b - visibleStart;
    const prev = ranges.get(index);
    ranges.set(index, prev
      ? { from: Math.min(prev.from, runFrom), to: Math.max(prev.to, runTo) }
      : { from: runFrom, to: runTo });
  };

  let runStart = start;
  for (let i = start; i < end; i++) {
    const char = map.chars[i];
    if (!char) continue;
    if (source[char.start] === "\n") {
      if (i > runStart) addRun(runStart, i);
      runStart = i + 1;
    }
  }
  if (end > runStart) addRun(runStart, end);

  let changed = false;
  for (const [index, range] of ranges) {
    const info = lineInfo[index];
    const prefix = source.slice(info.start, info.bodyStart);
    const body = source.slice(info.bodyStart, info.bodyEnd);
    const nextBody = applyInlineStyle(body, range.from, range.to, style);
    if (nextBody === null || nextBody === body) continue;
    lines[index] = prefix + nextBody;
    changed = true;
  }
  return changed ? lines.join("\n") : null;
}

export function replacePassage(
  source: string,
  anchor: PassageAnchor,
  replacement: string
): string | null {
  const map = passageText(source);
  const at = locatePassage(map, anchor);
  if (at < 0) return null;
  const isolated = isolatePassage(source, map, at, at + anchor.quote.length);
  if (!isolated) return null;
  const { src, start, end } = isolated;
  return src.slice(0, start) + replacement + src.slice(end);
}

// A trashed task renders its title as ordinary text, so a selection there cannot be
// found in the visible source (which still reads `[PROJ-12](issue:…)`). Swapping the
// reference by id keeps that selection convertible until the task is restored.
export function replaceIssueReference(
  source: string,
  issueId: string,
  replacement: string
): string | null {
  const close = source.indexOf(`](issue:${issueId})`);
  if (close < 0) return null;
  const open = source.lastIndexOf("[", close);
  if (open < 0) return null;
  return source.slice(0, open) + replacement + source.slice(close + `](issue:${issueId})`.length);
}

// Visible text of a source fragment: block prefixes and inline markers stripped, runs of
// whitespace collapsed — the same projection `replacePassage` matches its anchors against.
export function visiblePassage(source: string): string {
  return passageText(source).text;
}

// 1-based occurrence of `quote` in the visible text of `sourcePrefix`, so a passage
// picked inside the editor (where emphasis markers are hidden) can be anchored with
// the same numbering a rendered selection uses.
export function occurrenceAt(sourcePrefix: string, quote: string): number {
  if (!quote) return 1;
  const text = passageText(sourcePrefix).text;
  let occurrence = 1;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + quote.length)) {
    occurrence += 1;
  }
  return occurrence;
}

export function issueReference(identifier: string, issueId: string): string {
  return `[${identifier}](issue:${issueId})`;
}

// Ids of the tasks referenced inline, so a page can resolve names for ones that no
// longer appear in its task list (for example after a task was trashed).
export function referencedIssueIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(/\]\(issue:([^)\s]+)\)/g)) ids.add(match[1]);
  return [...ids];
}

// The words the author wrote for each inline task reference. When the task row is gone
// (purged from the Trash) the label is all that is left, and it is what the page falls
// back to so a dead reference reads as ordinary text again.
export function referencedIssueLabels(source: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const match of source.matchAll(/\[([^\]\n]*)\]\(issue:([^)\s]+)\)/g)) {
    const [, label, id] = match;
    if (!(id in labels)) labels[id] = label;
  }
  return labels;
}
