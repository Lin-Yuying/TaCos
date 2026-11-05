import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { documentExtensions } from "./extensions";

type TextEncoder = {
  encodeTextForMarkdown: (text: string, node: { marks?: unknown[] }, parent?: { type?: string }) => string;
  applyMarkToContent: (mark: string, content: JSONContent[], attrs?: unknown) => JSONContent[];
};

// The stock manager writes `&` as `&amp;` for readers that decode HTML entities. The TaCos
// reader treats Markdown as text and never decodes them, so `R&D` would come back as
// `R&amp;D` after one edit. `escapeMarkdownSyntax` still runs through the original method
// on a text with no `&`, `<` or `>` to encode.
export function documentMarkdown(): MarkdownManager {
  const manager = new MarkdownManager({ extensions: documentExtensions() });
  const target = manager as unknown as TextEncoder;
  const encode = target.encodeTextForMarkdown.bind(manager);
  target.encodeTextForMarkdown = (text, node, parent) => {
    const placeholders = ["\u0001", "\u0002", "\u0003"];
    const hidden = text.replace(/&/g, placeholders[0]).replace(/</g, placeholders[1]).replace(/>/g, placeholders[2]);
    return encode(hidden, node, parent)
      .replaceAll(placeholders[0], "&")
      .replaceAll(placeholders[1], "<")
      .replaceAll(placeholders[2], ">");
  };
  // The manager marks only text, so `**@sam**` would lose its bold as a chip. It stays text,
  // and a notice still goes out because the stored words are the same.
  const applyMark = target.applyMarkToContent.bind(manager);
  target.applyMarkToContent = (mark, content, attrs) =>
    applyMark(
      mark,
      content.map((node) => (node.type === "mention" ? { type: "text", text: `@${node.attrs?.id}` } : node)),
      attrs
    );
  return manager;
}

// A list item wrapped over several source lines is one item. The manager keeps the line
// break inside its text and then loses the indent on the way out, which breaks the list.
function joinWrappedListLines(node: JSONContent, inList = false): JSONContent {
  const here = inList || node.type === "listItem" || node.type === "taskItem";
  return {
    ...node,
    ...(node.type === "text" && here && node.text ? { text: node.text.replace(/\n[ \t]*/g, " ") } : {}),
    ...(node.content ? { content: node.content.map((child) => joinWrappedListLines(child, here)) } : {}),
  };
}

export function markdownToDocument(manager: MarkdownManager, source: string): JSONContent {
  return joinWrappedListLines(manager.parse(source));
}
