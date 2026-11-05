/**
 * Link and color in the selection toolbar (docs/plans/team-2.3.md item 15).
 * A text color is stored as `{color:#rrggbb}…{/color}` and a link stays a Markdown link.
 *   node --import tsx scripts/check-doc-color-syntax.ts
 */
import fs from "node:fs";
import type { JSONContent } from "@tiptap/core";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { documentColor, documentLinkHref, parseInline } from "../src/lib/markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function textNodes(node: JSONContent): JSONContent[] {
  if (node.type === "text") return [node];
  return (node.content ?? []).flatMap(textNodes);
}

function mark(node: JSONContent, type: string): { type: string; attrs?: Record<string, unknown> } | undefined {
  return (node.marks ?? []).find((item) => item.type === type);
}

function main() {
  assert(documentColor("#abc") === "#aabbcc", "a short hex color expands");
  assert(documentColor("#175CD3") === "#175cd3", "a hex color is stored in lowercase");
  assert(documentColor("red") === null, "a named color is refused");
  assert(documentLinkHref("https://example.com") === "https://example.com", "an https address is a link");
  assert(documentLinkHref("mailto:ada@example.com") === "mailto:ada@example.com", "a mail address is a link");
  assert(documentLinkHref("javascript:alert(1)") === null, "a javascript address is refused");

  const colored = parseInline("{color:#175cd3}**Hi**{/color}");
  assert(colored.length === 1 && colored[0].type === "color" && colored[0].color === "#175cd3", "the reader sees a color");
  assert(
    colored[0].type === "color" && colored[0].children.some((child) => child.type === "bold" && child.text === "Hi"),
    "bold inside a color still reads as bold",
  );
  const literal = parseInline("{color:red}x{/color}");
  assert(literal.every((node) => node.type !== "color"), "a named color stays ordinary text");

  const manager = documentMarkdown();
  const source = "See {color:#175CD3}**Hi**{/color} and [docs](https://example.com).\n";
  const once = manager.serialize(markdownToDocument(manager, source));
  assert(once.includes("{color:#175cd3}**Hi**{/color}"), `color syntax round-trips: ${JSON.stringify(once)}`);
  assert(once.includes("[docs](https://example.com)"), `a link round-trips: ${JSON.stringify(once)}`);
  assert(!once.includes("#175CD3"), "the stored color is lowercase");
  const twice = manager.serialize(markdownToDocument(manager, once));
  assert(twice === once, `a second save stays the same: ${JSON.stringify(twice)}`);

  const doc = markdownToDocument(manager, once);
  const hi = textNodes(doc).find((node) => node.text === "Hi");
  assert(hi, "the colored word is still text");
  assert(mark(hi, "bold"), "the colored word keeps bold");
  assert(mark(hi, "textStyle")?.attrs?.color === "#175cd3", "the colored word keeps its color");
  const docs = textNodes(doc).find((node) => node.text === "docs");
  assert(docs && mark(docs, "link")?.attrs?.href === "https://example.com", "the link keeps its address");

  const unsafe = manager.serialize(markdownToDocument(manager, "{color:red}x{/color}\n"));
  assert(unsafe.includes("{color:red}"), `an unsafe color is not rewritten: ${JSON.stringify(unsafe)}`);
  assert(
    textNodes(markdownToDocument(manager, "{color:red}x{/color}\n")).every((node) => !mark(node, "textStyle")?.attrs?.color),
    "an unsafe color does not become a color mark",
  );

  const panel = fs.readFileSync(new URL("../src/components/document-editor.tsx", import.meta.url), "utf8");
  assert(panel.includes("setColor") && panel.includes("unsetColor"), "the toolbar sets and clears a color");
  assert(panel.includes("setLink") && panel.includes("unsetLink"), "the toolbar sets and clears a link");
  assert(panel.includes("doc-link-field"), "the toolbar asks for a web address");

  console.log("ok");
}

main();
