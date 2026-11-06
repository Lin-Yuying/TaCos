// A document's reader outline. Heading ids are derived from the heading text, in
// document order, so the same Markdown always produces the same anchors. Duplicates get
// a numeric suffix; Chinese text is kept as-is instead of being dropped.
import { parseBlocks, type Inline } from "./markdown";

export type DocHeading = { id: string; level: number; text: string };

/** The text a heading shows, without its Markdown markers. */
function inlineText(nodes: Inline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "color") out += inlineText(node.children);
    else out += node.text;
  }
  return out;
}

/**
 * GitHub-style slug: lowercase, punctuation dropped, whitespace to hyphens, and CJK
 * letters preserved. A heading with no letters or digits still needs an anchor, so it
 * becomes `section`.
 */
export function headingSlug(text: string): string {
  const slug = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** One id per heading; a repeated heading gets `-1`, `-2`, … and never collides. */
export function outlineHeadings(headings: { level: number; text: string }[]): DocHeading[] {
  const used = new Set<string>();
  return headings.map((heading) => {
    const base = headingSlug(heading.text);
    let id = base;
    let n = 1;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return { id, level: heading.level, text: heading.text };
  });
}

/** The headings the reader shows. Fenced code and quotes have no headings; code is opaque. */
export function docOutline(doc: string): DocHeading[] {
  const headings: { level: number; text: string }[] = [];
  for (const block of parseBlocks(doc)) {
    if (block.kind !== "heading") continue;
    const text = inlineText(block.text).trim();
    headings.push({ level: block.level, text });
  }
  return outlineHeadings(headings);
}
