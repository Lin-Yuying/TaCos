import assert from "node:assert/strict";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { documentExtensions } from "../src/lib/editor/extensions";
import { insertStandalonePageRef } from "../src/lib/editor/page-ref";
import { pageReferenceMarkdown, pageReferences, parseBlocks, parseInline } from "../src/lib/markdown";

const manager = documentMarkdown();
const schema = getSchema(documentExtensions());
const reference = { title: "Child", id: "page-child" };
const syntax = "[[Child|page-child]]";

function editorState(source: string, from: number, to = from): EditorState {
  const parsed = markdownToDocument(manager, source);
  const doc = parsed.content?.length
    ? schema.nodeFromJSON(parsed)
    : schema.nodes.doc.create(null, schema.nodes.paragraph.create());
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
}

for (const [name, source, from, to, expected] of [
  ["paragraph start", "Before after", 1, 1, `${syntax}\n\nBefore after`],
  ["paragraph middle", "Before after", 7, 7, `Before\n\n${syntax}\n\nafter`],
  ["paragraph end", "Before after", 13, 13, `Before after\n\n${syntax}`],
  ["spaces around cursor", "Before  after", 8, 8, `Before\n\n${syntax}\n\nafter`],
  ["empty paragraph", "", 1, 1, syntax],
  ["selected text", "Before after", 1, 13, syntax],
] as const) {
  const tr = insertStandalonePageRef(editorState(source, from, to), reference);
  assert.ok(tr, `${name}: no transaction`);
  const back = manager.serialize(tr.doc.toJSON());
  assert.equal(back, expected, name);
  assert.ok(tr.doc.resolve(tr.selection.from).parent.isTextblock, `${name}: selection left the text block`);
  assert.equal(manager.serialize(markdownToDocument(manager, back)), back, `${name}: second round trip changed`);
}

for (const [name, source, pos] of [
  ["code block", "```\ncode\n```", 2],
  ["list item", "- item", 3],
] as const) {
  assert.equal(insertStandalonePageRef(editorState(source, pos), reference), null, `${name}: should be refused`);
}

const specialTitle = "A | B ] C \\ D\nE";
const specialSyntax = "[[A \\| B \\] C \\\\ D\\nE|page-child]]";
assert.equal(pageReferenceMarkdown(specialTitle, reference.id), specialSyntax, "reference delimiters are escaped");
assert.deepEqual(parseInline(specialSyntax), [
  { type: "page", text: specialTitle, pageId: reference.id },
]);
assert.deepEqual([...pageReferences(`Before ${specialSyntax} after`)], [
  {
    raw: specialSyntax,
    title: specialTitle,
    pageId: reference.id,
    embed: false,
    start: 7,
    end: 7 + specialSyntax.length,
    titleOffset: 2,
  },
]);

const specialTr = insertStandalonePageRef(editorState("Before after", 7), { title: specialTitle, id: reference.id });
assert.ok(specialTr, "a title with delimiters can be placed");
const specialSaved = manager.serialize(specialTr.doc.toJSON());
assert.equal(specialSaved, `Before\n\n${specialSyntax}\n\nafter`, "placement stores an escaped reference");
assert.equal(manager.serialize(markdownToDocument(manager, specialSaved)), specialSaved, "escaped placement survives reload");

const embedSyntax = pageReferenceMarkdown(specialTitle, reference.id, true);
assert.equal(embedSyntax, `!${specialSyntax}`, "embed uses the same escaping");
const [embed] = parseBlocks(embedSyntax);
assert.equal(embed.kind, "embed");
if (embed.kind === "embed") {
  assert.equal(embed.text, specialTitle);
  assert.equal(embed.pageId, reference.id);
}
assert.equal(manager.serialize(markdownToDocument(manager, embedSyntax)), embedSyntax, "escaped embed survives reload");

const [table] = parseBlocks(`| Link |\n| --- |\n| ${specialSyntax} |`);
assert.equal(table.kind, "table");
if (table.kind === "table") {
  assert.deepEqual(parseInline(table.rows[0][0]), [
    { type: "page", text: specialTitle, pageId: reference.id },
  ]);
}

console.log("check-page-ref-placement: 8 placements and escaped references passed");
