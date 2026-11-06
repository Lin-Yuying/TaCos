/**
 * docs/plans/team-2.3.md item 5: selected document images show a ring; delete keeps the cursor stable.
 *   node --import tsx scripts/check-doc-image-selection.ts
 */
import { readFileSync } from "node:fs";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { documentExtensions } from "../src/lib/editor/extensions";
import { deleteSelectedImage, DOC_IMAGE_CLASS } from "../src/lib/editor/doc-image";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function blockImagePos(doc: ProseNode) {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "image") {
      found = pos;
      return false;
    }
  });
  return found;
}

const css = readFileSync("src/app/globals.css", "utf8");
assert(css.includes(`img.${DOC_IMAGE_CLASS}.ProseMirror-selectednode`), "selected image ring is styled in globals.css");
assert(css.includes("box-shadow"), "selection uses a visible ring");

const extensions = readFileSync("src/lib/editor/extensions.ts", "utf8");
assert(extensions.includes("deleteSelectedImage"), "document image delete goes through the stable helper");

const schema = getSchema(documentExtensions());
const md = documentMarkdown();

function stateWithImage(markdown: string) {
  const doc = schema.nodeFromJSON(markdownToDocument(md, markdown));
  const pos = blockImagePos(doc);
  assert(pos >= 0, "sample has an image");
  return EditorState.create({ doc, schema, selection: NodeSelection.create(doc, pos) });
}

const middle = stateWithImage("before\n\n![x](https://example.com/a.png)\n\nafter");
let next = middle;
assert(deleteSelectedImage(middle, (tr) => {
  next = middle.apply(tr);
}), "deleteSelectedImage removes a selected image");
assert(next.selection.from === 9, "cursor lands at the next block, not the document root");
assert(blockImagePos(next.doc) < 0, "image node is gone");

const tail = stateWithImage("before\n\n![x](https://example.com/a.png)");
let tailNext = tail;
deleteSelectedImage(tail, (tr) => {
  tailNext = tail.apply(tr);
});
assert(tailNext.selection.from === 7, "cursor stays at the end of the previous paragraph when the image was last");
assert(tailNext.selection.from > 0, "cursor does not jump to document root");

const only = stateWithImage("![solo](https://example.com/s.png)");
let solo = only;
deleteSelectedImage(only, (tr) => {
  solo = only.apply(tr);
});
assert(solo.selection.from === 1, "solo image delete leaves cursor in the empty paragraph");
assert(solo.doc.childCount === 1 && solo.doc.child(0).type.name === "paragraph", "solo image becomes an empty paragraph");

console.log("check-doc-image-selection: pass");
