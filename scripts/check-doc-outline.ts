/**
 * Reader outline and heading anchors (U-04): stable slugs (including Chinese and
 * duplicates), fenced code ignored, and the editor/reader wiring for "copy link to
 * heading".   npx tsx scripts/check-doc-outline.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

async function main() {
  const { docOutline, headingSlug, outlineHeadings } = await import("../src/lib/doc-outline");

  // Slugs keep words, lower-case them, and drop punctuation.
  assert(headingSlug("  Hello,  World!  ") === "hello-world", "spaces and punctuation become one hyphen");
  assert(headingSlug("中文 标题") === "中文-标题", "Chinese headings keep their characters");
  assert(headingSlug("A/B") === "ab", "slashes are not anchors");
  assert(headingSlug("⭐") === "section", "a heading with no letters still gets an anchor");

  // Duplicates get a suffix and never collide with a heading that already used it.
  const ids = outlineHeadings([
    { level: 2, text: "Repeat" },
    { level: 3, text: "Repeat" },
    { level: 2, text: "Repeat-1" },
  ]);
  assert(
    ids.map((heading) => heading.id).join(",") === "repeat,repeat-1,repeat-1-1",
    `duplicate ids: ${ids.map((heading) => heading.id).join(",")}`
  );

  const doc = [
    "# Hello World",
    "",
    "## 中文 标题",
    "",
    "```md",
    "# Not a heading",
    "```",
    "",
    "### Notes `#inline`",
    "",
    "## Hello World",
  ].join("\n");
  const outline = docOutline(doc);
  assert(
    outline.map((heading) => `${heading.level}:${heading.id}`).join(" ") ===
      "1:hello-world 2:中文-标题 3:notes-inline 2:hello-world-1",
    `outline order and ids: ${JSON.stringify(outline)}`
  );
  assert(outline.every((heading) => encodeURIComponent(heading.id).length > 0), "every id can be put in a link");
  assert(!outline.some((heading) => heading.text.includes("Not a heading")), "a fenced heading is code, not an outline row");

  // The editor draws the same ids as decorations and offers a copy link per heading.
  const editor = read("src/components/document-editor.tsx");
  assert(editor.includes("outlineHeadings"), "the editor derives ids with the shared helper");
  assert(editor.includes("data-doc-heading"), "headings carry a scrollable anchor");
  assert(editor.includes("doc-heading-anchor") && editor.includes("headingAnchor"), "headings get a copy-link anchor");
  assert(editor.includes("?heading="), "the copied link names the heading");
  assert(editor.includes("headingBase"), "the link points at the document's canonical path");

  // The reader panel and the deep link live on the document page.
  const page = read("src/components/doc-page.tsx");
  assert(page.includes("docOutline(doc)"), "the reader builds its outline from the document");
  assert(page.includes("DocOutlinePanel"), "the reader-sidebar outline is rendered");
  assert(page.includes("data-doc-outline-toggle"), "the outline has a stable toggle");
  assert(page.includes("requestedHeading") && page.includes("scrollToHeading"), "a copied heading link scrolls the reader");
  const panel = read("src/components/doc-outline.tsx");
  assert(panel.includes("data-outline-item") && panel.includes("data-outline-copy"), "outline rows and copy buttons are addressable");
  assert(read("src/app/globals.css").includes(".doc-heading-anchor"), "the heading anchor has print-safe positioning styles");

  console.log("check-doc-outline: ok");
}

void main();
