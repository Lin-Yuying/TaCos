/**
 * Toggle and callout blocks (docs/plans/team-2.3.md item 16).
 * A toggle is `:::toggle`, a callout is `:::callout`, and both come back unchanged.
 *   node --import tsx scripts/check-doc-toggle-callout.ts
 */
import fs from "node:fs";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../src/lib/editor/extensions";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { parseBlocks } from "../src/lib/markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function roundTrip(source: string): string {
  const manager = documentMarkdown();
  const editor = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, source),
  });
  const once = manager.serialize(editor.getJSON());
  editor.destroy();
  const again = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, once),
  });
  const twice = manager.serialize(again.getJSON());
  again.destroy();
  assert(twice === once, `a second save stays the same:\n${once}\n---\n${twice}`);
  return once;
}

function main() {
  const closed = roundTrip(":::toggle The plan\n\nSee **this**.\n\n:::\n");
  assert(closed.includes(":::toggle The plan"), `the summary stays on the opening line: ${JSON.stringify(closed)}`);
  assert(closed.includes("**this**"), `bold inside a toggle stays bold: ${JSON.stringify(closed)}`);
  assert(!closed.includes("{open}"), `a closed toggle does not record open: ${JSON.stringify(closed)}`);

  const opened = roundTrip(":::toggle {open} The plan\n\nSee this.\n\n:::\n");
  assert(opened.includes(":::toggle {open} The plan"), `an open toggle stays open: ${JSON.stringify(opened)}`);

  const callout = roundTrip(":::callout\n\nWatch the date.\n\n:::\n");
  assert(callout.includes(":::callout"), `a callout stays a callout: ${JSON.stringify(callout)}`);
  assert(callout.includes("Watch the date."), `a callout keeps its text: ${JSON.stringify(callout)}`);

  const blocks = parseBlocks(closed);
  const toggle = blocks.find((block) => block.kind === "toggle");
  assert(toggle && toggle.kind === "toggle" && toggle.summary.some((node) => node.type === "text" && node.text === "The plan"), "the reader sees the toggle summary");
  assert(
    toggle && toggle.kind === "toggle" && toggle.body.some((block) => block.kind === "paragraph"),
    "the reader sees the toggle body",
  );
  const notes = parseBlocks(callout);
  assert(notes.some((block) => block.kind === "callout"), "the reader sees a callout");

  const panel = fs.readFileSync(new URL("../src/components/document-editor.tsx", import.meta.url), "utf8");
  assert(panel.includes("setDetails"), "the slash menu inserts a toggle");
  assert(panel.includes('type: "callout"'), "the slash menu inserts a callout");

  console.log("ok");
}

main();
