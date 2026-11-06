/**
 * Comment count in the page margin (docs/plans/team-2.3.md item 18).
 * Comments on one block add up; a block with none shows nothing.
 *   node --import tsx scripts/check-doc-comment-count.ts
 */
import fs from "node:fs";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../src/lib/editor/extensions";
import { anchorFromSelection, commentCountsByBlock } from "../src/lib/editor/anchors";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function main() {
  const manager = documentMarkdown();
  const editor = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, "Alpha\n\nBeta\n\nGamma\n"),
  });
  const at = (text: string, id: string) => {
    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (pos < 0 && node.isText && node.text === text) pos = nodePos;
    });
    assert(pos >= 0, `${text} is in the document`);
    const anchor = anchorFromSelection(editor.state.doc, pos, pos + text.length);
    assert(anchor, `${text} can be commented on`);
    return { id, ...anchor };
  };

  const counts = commentCountsByBlock(editor.state.doc, [at("Alpha", "a"), at("Beta", "b"), at("Beta", "c")]);
  assert(counts.length === 2, `two blocks have comments: ${counts.length}`);
  assert(counts[0].count === 1 && counts[0].ids[0] === "a", "Alpha has one comment");
  assert(counts[1].count === 2 && counts[1].ids.join(",") === "b,c", "Beta's two comments add up");
  assert(counts[0].from < counts[1].from, "counts follow the page");

  const gone = commentCountsByBlock(editor.state.doc, [
    { id: "missing", quote: "not in the page", prefix: "", suffix: "" },
  ]);
  assert(gone.length === 0, "a comment whose text is gone is not counted");
  editor.destroy();

  const panel = fs.readFileSync(new URL("../src/components/document-editor.tsx", import.meta.url), "utf8");
  assert(panel.includes("doc-comment-count"), "the margin shows the count");
  assert(panel.includes("anchorsKey.getState") && panel.includes("setMarginCounts"), "the margin reuses located plugin ranges for block counts");

  console.log("ok");
}

main();
