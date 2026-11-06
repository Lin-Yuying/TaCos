/**
 * Embedded page content in the editor (docs/plans/team-2.3.md item 19).
 * The editor used to draw only the page title. The card now shows that page's body,
 * and the document still stores the reference, not a copy of the body.
 *   node --import tsx scripts/check-doc-page-embed.ts
 */
import fs from "node:fs";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../src/lib/editor/extensions";
import { embedPreview } from "../src/lib/editor/page-embed";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function main() {
  const pages = {
    lookup: {
      "page-1": { id: "page-1", title: "Notes" },
      notes: { id: "page-1", title: "Notes" },
    },
    embeds: { "page-1": "The body.\n" },
  };
  const shown = embedPreview(pages, "Notes", "page-1");
  assert(shown.id === "page-1" && shown.body === "The body.\n" && !shown.missing, "a known embed shows its body");
  assert(embedPreview(pages, "Old name", "page-1").label === "Notes", "the live title wins over the stored one");

  const missing = embedPreview(pages, "Gone", null);
  assert(missing.missing && missing.body === null, "an unknown page is missing");

  const waiting = embedPreview(undefined, "Notes", "page-1");
  assert(!waiting.missing && waiting.body === null, "before the pages load, the card is not marked missing");

  const empty = embedPreview({ ...pages, embeds: { "page-1": "" } }, "Notes", "page-1");
  assert(empty.body === "", "an empty page is an empty body, not a missing one");

  const manager = documentMarkdown();
  const source = "![[Notes|page-1]]\n";
  const editor = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, source),
  });
  const saved = manager.serialize(editor.getJSON());
  editor.destroy();
  assert(saved.includes("![[Notes|page-1]]"), `the reference is what gets stored: ${JSON.stringify(saved)}`);
  assert(!saved.includes("The body"), "the embedded body is not copied into this page");

  const panel = fs.readFileSync(new URL("../src/components/document-editor.tsx", import.meta.url), "utf8");
  assert(panel.includes("doc-page-embed") && panel.includes("embedPreview"), "the editor card draws the preview");

  console.log("ok");
}

main();
