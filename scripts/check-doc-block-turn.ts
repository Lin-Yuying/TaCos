/**
 * Drag a block and turn it into another type (docs/plans/team-2.3.md item 14).
 * The move is the document change the drag handle produces. Turning a block keeps
 * its inline marks and comes back as Markdown.
 *   node --import tsx scripts/check-doc-block-turn.ts
 */
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../src/lib/editor/extensions";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { moveTopLevelBlock, turnBlock } from "../src/lib/editor/block-turn";
import { parseBlocks } from "../src/lib/markdown";

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
    content: markdownToDocument(manager, "Alpha **bold**\n\nBeta\n\nGamma\n"),
  });
  const moved = moveTopLevelBlock(editor.state, 2, 0);
  assert(moved, "a block can move to another index");
  let state = moved;
  const markdown = () => manager.serialize(state.doc.toJSON());
  assert(markdown().startsWith("Gamma"), "dragging the last block to the top lands it first");

  const posOf = (text: string) => {
    let found = -1;
    state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) found = pos;
    });
    assert(found >= 0, `${text} is still in the document`);
    return state.doc.resolve(found).before(1);
  };

  const headed = turnBlock(state, posOf("Alpha"), "heading-2");
  assert(headed, "a paragraph turns into a heading");
  state = headed;
  assert(markdown().includes("## Alpha **bold**"), "the heading keeps bold");

  const listed = turnBlock(state, posOf("Beta"), "bullet");
  assert(listed, "a paragraph turns into a bullet list");
  state = listed;
  const tasked = turnBlock(state, posOf("Beta"), "task");
  assert(tasked, "a bullet turns into a to-do");
  state = tasked;
  assert(markdown().includes("- [ ] Beta"), "the to-do is stored as a task list");

  const ordered = turnBlock(state, posOf("Alpha"), "ordered");
  assert(ordered, "a heading turns into a numbered list");
  state = ordered;
  assert(!markdown().includes("##"), "turning a heading into a list keeps the words, not the heading marker");
  assert(markdown().includes("1. Alpha **bold**"), "the numbered item keeps bold");

  const quoted = turnBlock(state, posOf("Gamma"), "quote");
  assert(quoted, "a paragraph turns into a quote");
  state = quoted;
  const coded = turnBlock(state, posOf("Gamma"), "code");
  assert(coded, "a quote turns into a code block");
  state = coded;
  assert(markdown().includes("```\nGamma\n```"), "the code block keeps its text");

  const back = manager.serialize(state.doc.toJSON());
  const again = manager.serialize(markdownToDocument(manager, back));
  assert(again === back, "a second round trip keeps the edited blocks");
  assert(parseBlocks(back).some((block) => block.kind === "code"), "the reader sees a code block");
  assert(parseBlocks(back).some((block) => block.kind === "list"), "the reader sees a list");

  const table = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, "| A |\n| --- |\n| 1 |\n"),
  });
  assert(turnBlock(table.state, 0, "bullet") === null, "a table is dragged, not turned into a list");
  assert(turnBlock(state, posOf("Beta"), "task") === null, "turning a block into the type it already is changes nothing");

  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/document-editor.tsx"), "utf8");
  for (const name of ["DragHandle", "turnBlock", "doc-block-handle", "doc-turn-into"]) {
    assert(panel.includes(name), `editor exposes ${name}`);
  }
  editor.destroy();
  table.destroy();
  console.log("check-doc-block-turn: ok");
}

main();
