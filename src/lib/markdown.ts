// A deliberately small Markdown subset: enough for project documents, parsed into
// plain data so the renderer can emit React nodes (never raw HTML) and the editor
// can round-trip every block back to its source text.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "code"; text: string }
  | { type: "strike"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; depth: number; text: Inline[] }
  | { kind: "paragraph"; depth: number; lines: Inline[][] }
  | { kind: "quote"; depth: number; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: { text: Inline[]; depth: number }[] }
  | { kind: "todo"; items: { text: Inline[]; checked: boolean; depth: number }[] }
  | { kind: "code"; lang: string; body: string }
  | { kind: "divider" };

const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*(\d+)[.)]\s+/;
const TODO = /^\s*[-*+]\s+\[( |x|X)\]\s+/;
const QUOTE = /^\s*>\s?/;
const FENCE = /^```(\w*)\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})$/;

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
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const start = i++;
      while (i < lines.length && !FENCE.test(lines[i])) i += 1;
      if (i < lines.length) i += 1;
      blocks.push(lines.slice(start, i).join("\n"));
      continue;
    }
    if (HEADING.test(line) || DIVIDER.test(line.trim())) {
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

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  let i = 0;

  const pushBuffer = () => {
    if (buffer) {
      out.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    const rest = text.slice(i);

    const code = rest.match(/^`([^`\n]+)`/);
    if (code) {
      pushBuffer();
      out.push({ type: "code", text: code[1] });
      i += code[0].length;
      continue;
    }

    const bold = rest.match(/^\*\*([^*\n]+)\*\*/);
    if (bold) {
      pushBuffer();
      out.push({ type: "bold", text: bold[1] });
      i += bold[0].length;
      continue;
    }

    const strike = rest.match(/^~~([^~\n]+)~~/);
    if (strike) {
      pushBuffer();
      out.push({ type: "strike", text: strike[1] });
      i += strike[0].length;
      continue;
    }

    const italic = rest.match(/^\*([^*\n]+)\*/) ?? rest.match(/^_([^_\n]+)_/);
    if (italic) {
      pushBuffer();
      out.push({ type: "italic", text: italic[1] });
      i += italic[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]\n]*)\]\(([^)\s]+)\)/);
    if (link) {
      pushBuffer();
      out.push({ type: "link", text: link[1] || link[2], href: safeHref(link[2]) });
      i += link[0].length;
      continue;
    }

    const autoLink = rest.match(/^<(https?:\/\/[^>\s]+)>/);
    if (autoLink) {
      pushBuffer();
      out.push({ type: "link", text: autoLink[1], href: safeHref(autoLink[1]) });
      i += autoLink[0].length;
      continue;
    }

    buffer += text[i];
    i += 1;
  }

  pushBuffer();
  return out;
}

// javascript:/data: URLs would turn a document into an attack on the reader.
function safeHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : "#";
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

  return { kind: "paragraph", depth: indentDepth(first), lines: lines.map((line) => parseInline(line)) };
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

export function parseBlocks(src: string): Block[] {
  return splitBlocks(src).map(parseBlock);
}
