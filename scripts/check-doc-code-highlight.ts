/**
 * Code highlighting in the document editor (docs/plans/team-2.3.md item 17).
 * The fence language is part of the document, and lowlight colors a known language.
 *   node --import tsx scripts/check-doc-code-highlight.ts
 */
import fs from "node:fs";
import { Editor } from "@tiptap/core";
import { documentExtensions } from "../src/lib/editor/extensions";
import { documentLowlight } from "../src/lib/editor/lowlight";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function saved(source: string): { markdown: string; language: string | null } {
  const manager = documentMarkdown();
  const editor = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, source),
  });
  let language: string | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") language = (node.attrs.language as string | null) ?? null;
  });
  const markdown = manager.serialize(editor.getJSON());
  editor.destroy();
  const again = new Editor({
    extensions: documentExtensions(),
    content: markdownToDocument(manager, markdown),
  });
  const twice = manager.serialize(again.getJSON());
  again.destroy();
  assert(twice === markdown, `a second save stays the same:\n${markdown}\n---\n${twice}`);
  return { markdown, language };
}

function highlighted(language: string, code: string): boolean {
  return JSON.stringify(documentLowlight.highlight(language, code)).includes("hljs-keyword");
}

function main() {
  const typed = saved("```typescript\nconst n = 1\n```\n");
  assert(typed.language === "typescript", `the code block keeps typescript: ${typed.language}`);
  assert(typed.markdown.includes("```typescript"), `the fence keeps typescript: ${JSON.stringify(typed.markdown)}`);
  assert(highlighted("typescript", "const n = 1"), "typescript keywords are highlighted");

  const short = saved("```ts\nconst n = 1\n```\n");
  assert(short.language === "ts", `a short language stays ts: ${short.language}`);
  assert(short.markdown.includes("```ts"), `the fence keeps ts: ${JSON.stringify(short.markdown)}`);
  assert(!short.markdown.includes("```typescript"), "ts is not rewritten to typescript");
  assert(highlighted("ts", "const n = 1"), "ts highlights as typescript");

  const plain = saved("```\nconst n = 1\n```\n");
  assert(plain.language === null, `a fence with no language stays empty: ${plain.language}`);
  assert(!/```\w/.test(plain.markdown), `no language is written back: ${JSON.stringify(plain.markdown)}`);

  const custom = saved("```madeup\nhello\n```\n");
  assert(custom.language === "madeup", `an unknown language stays madeup: ${custom.language}`);

  const panel = fs.readFileSync(new URL("../src/components/document-editor.tsx", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../src/lib/editor/extensions.ts", import.meta.url), "utf8");
  assert(schema.includes("CodeBlockLowlight"), "the editor uses the lowlight code block");
  assert(panel.includes('updateAttributes("codeBlock"'), "the toolbar can change the language");
  assert(panel.includes("doc-code-menu"), "the language control is in the editor");

  console.log("ok");
}

main();
