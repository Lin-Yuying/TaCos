/**
 * Table rows and columns (docs/plans/team-2.3.md item 13): an edited table comes back as Markdown
 * the reader renders the same way, including alignment and inline marks.
 *   node --import tsx scripts/check-doc-table-edit.ts
 */
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { addColumnAfter, addRowAfter, deleteColumn, deleteRow } from "@tiptap/pm/tables";
import { documentExtensions } from "../src/lib/editor/extensions";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { parseBlocks } from "../src/lib/markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

type Command = (state: EditorState, dispatch?: (tr: EditorState["tr"]) => void) => boolean;

function selectText(state: EditorState, text: string): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos !== -1) return false;
    if (node.isText && node.text === text) {
      pos = at;
      return false;
    }
  });
  assert(pos >= 0, `text ${JSON.stringify(text)} is in the document`);
  const selection = TextSelection.near(state.doc.resolve(pos + 1));
  return state.apply(state.tr.setSelection(selection));
}

function selectEmptyHeader(state: EditorState): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos !== -1) return false;
    if (node.type.name === "tableHeader" && node.textContent === "") {
      pos = at;
      return false;
    }
  });
  assert(pos >= 0, "the added column has an empty header cell");
  const selection = TextSelection.near(state.doc.resolve(pos + 1));
  return state.apply(state.tr.setSelection(selection));
}

function apply(state: EditorState, command: Command, name: string): EditorState {
  let next = state;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  assert(ok, `${name} applies inside the table`);
  return next;
}

function main() {
  const source = `Intro

| Name | Count |
| --- | ---: |
| one | **1** |
| two | 2 |
`;
  const manager = documentMarkdown();
  const editor = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, source),
  });
  let state = editor.state;
  assert(addRowAfter(state) === false, "add row outside a table does nothing");
  assert(deleteRow(state) === false, "delete row outside a table does nothing");
  assert(addColumnAfter(state) === false, "add column outside a table does nothing");
  assert(deleteColumn(state) === false, "delete column outside a table does nothing");

  state = apply(selectText(state, "one"), addRowAfter, "add row");
  state = apply(selectText(state, "Count"), addColumnAfter, "add column");
  state = apply(selectText(state, "two"), deleteRow, "delete row");
  state = apply(selectEmptyHeader(state), deleteColumn, "delete column");

  const back = manager.serialize(state.doc.toJSON());
  const again = manager.serialize(markdownToDocument(manager, back));
  assert(again === back, "a second round trip keeps the edited table");
  const table = parseBlocks(back).find((block) => block.kind === "table");
  assert(table?.kind === "table", "the edited document still has a table");
  if (table?.kind !== "table") return;
  assert(JSON.stringify(table.align) === JSON.stringify([null, "right"]), "the untouched column keeps its alignment");
  assert(JSON.stringify(table.header) === JSON.stringify(["Name", "Count"]), "header cells survive the edits");
  assert(
    JSON.stringify(table.rows) === JSON.stringify([["one", "**1**"], ["", ""]]),
    "the added row stays, the deleted row is gone, and bold in a cell stays"
  );

  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/document-editor.tsx"), "utf8");
  for (const name of ["addRowAfter", "deleteRow", "addColumnAfter", "deleteColumn", "doc-table-menu"]) {
    assert(panel.includes(name), `editor exposes ${name}`);
  }
  editor.destroy();
  console.log("check-doc-table-edit: ok");
}

main();
