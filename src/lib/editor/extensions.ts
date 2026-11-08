import { imagePreviewUrl } from "@/lib/image-preview-url";
import {
  Node,
  createBlockMarkdownSpec,
  mergeAttributes,
  type AnyExtension,
  type MarkdownLexerConfiguration,
  type MarkdownToken,
} from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { documentLowlight } from "@/lib/editor/lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow, renderTableToMarkdown } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { deleteSelectedImage, DOC_IMAGE_CLASS } from "@/lib/editor/doc-image";
import { documentColor } from "@/lib/markdown";
import { mentionText } from "@/lib/mentions";

const DocumentImage = Image.extend({
  addAttributes(){return {...this.parent?.(),src:{default:null,parseHTML:element=>element.getAttribute("data-original-src")??element.getAttribute("src")}};},
  renderHTML({HTMLAttributes}){return ["img",mergeAttributes(this.options.HTMLAttributes,HTMLAttributes,{src:imagePreviewUrl(String(HTMLAttributes.src??"")),"data-original-src":HTMLAttributes.src,loading:"lazy",decoding:"async"})];},
  // The original file is downloaded from the editor's right-click menu, so the image carries
  // its original address instead of a link under every picture.
  addNodeView(){return ({node})=>{
    const dom=document.createElement("span"),image=document.createElement("img");dom.contentEditable="false";dom.className="block";image.className=DOC_IMAGE_CLASS;image.loading="lazy";image.decoding="async";
    const paint=(value:typeof node)=>{const src=String(value.attrs.src??"");image.src=imagePreviewUrl(src);image.dataset.originalSrc=src;image.alt=String(value.attrs.alt??"");if(value.attrs.title)image.title=String(value.attrs.title);};paint(node);dom.append(image);return {dom,update(next){if(next.type!==node.type)return false;paint(next);return true;}};
  };},
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteSelectedImage(editor.state, (tr) => editor.view.dispatch(tr)),
      Delete: ({ editor }) => deleteSelectedImage(editor.state, (tr) => editor.view.dispatch(tr)),
    };
  },
}).configure({ HTMLAttributes: { class: DOC_IMAGE_CLASS } });

// Stored documents stay Markdown. These nodes carry the three things TaCos adds to it,
// so `[[page]]`, `![[page]]` and `[PROJ-1](issue:id)` come back from the editor unchanged.

// A toggle is a details block. The summary stays on the opening line, and `{open}` records
// that the section is expanded. A callout is the same kind of fence with no summary.
function takeFence(src: string, name: string): { raw: string; header: string; body: string } | undefined {
  const opening = new RegExp(`^:::${name}([^\\n]*)\\n`).exec(src);
  if (!opening) return undefined;
  const rest = src.slice(opening[0].length);
  const lines = rest.split("\n");
  let depth = 1;
  let close = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^:::(?:toggle|callout)\b/.test(lines[i])) depth += 1;
    else if (/^:::\s*$/.test(lines[i])) {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return undefined;
  const consumed = lines.slice(0, close + 1).join("\n");
  let end = opening[0].length + consumed.length;
  if (src[end] === "\n") end += 1;
  return { raw: src.slice(0, end), header: opening[1], body: lines.slice(0, close).join("\n") };
}

function toggleHeader(header: string): { open: boolean; summary: string } {
  const trimmed = header.trim();
  const open = /^\{open\}(?:\s|$)/.test(trimmed);
  return { open, summary: (open ? trimmed.replace(/^\{open\}\s*/, "") : trimmed).trim() };
}

const DocToggle = Details.extend({
  markdownTokenName: "details",
  markdownTokenizer: {
    name: "details",
    level: "block",
    start: (src: string) => src.indexOf(":::toggle"),
    tokenize: (src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) => {
      const taken = takeFence(src, "toggle");
      if (!taken) return undefined;
      const { open, summary } = toggleHeader(taken.header);
      const tokens = taken.body.trim() ? lexer.blockTokens(taken.body) : [];
      for (const token of tokens) {
        if (token.text && (!token.tokens || token.tokens.length === 0)) token.tokens = lexer.inlineTokens(token.text);
      }
      return { type: "details", raw: taken.raw, open, summary, tokens };
    },
  },
  parseMarkdown: (token, helpers) => {
    const tokenize = helpers.tokenizeInline;
    const summary = helpers.parseInline(tokenize ? tokenize(String(token.summary ?? "")) : []);
    const body = helpers.parseChildren(token.tokens || []);
    return helpers.createNode("details", { open: Boolean(token.open) }, [
      helpers.createNode("detailsSummary", undefined, summary),
      helpers.createNode("detailsContent", undefined, body.length > 0 ? body : [helpers.createNode("paragraph")]),
    ]);
  },
  renderMarkdown: (node, helpers) => {
    const [summary, content] = node.content ?? [];
    const title = helpers.renderChildren(summary?.content ?? []).replace(/\n/g, " ").trim();
    const body = helpers.renderChildren(content?.content ?? [], "\n\n").trim();
    const flag = node.attrs?.open ? " {open}" : "";
    const head = title ? `:::toggle${flag} ${title}` : `:::toggle${flag}`;
    return body ? `${head}\n\n${body}\n\n:::` : `${head}\n\n:::`;
  },
}).configure({ persist: true });

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "aside[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["aside", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0],
  ...createBlockMarkdownSpec({ nodeName: "callout" }),
});

// A text color is stored as `{color:#rrggbb}…{/color}`. The mark renders a CSS color in the
// editor, and this syntax is what gets written so the page stays Markdown.
const DocTextStyle = TextStyle.extend({
  priority: 200,
  markdownTokenName: "textColor",
  markdownTokenizer: {
    name: "textColor",
    level: "inline",
    start: (src: string) => src.indexOf("{color:"),
    tokenize: (src: string) => {
      const match = /^\{color:(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\}([^\n]*?)\{\/color\}/.exec(src);
      const color = match ? documentColor(match[1]) : null;
      if (!match || !color) return undefined;
      return { type: "textColor", raw: match[0], text: match[2], color };
    },
  },
  parseMarkdown: (token, helpers) => {
    const color = documentColor(String(token.color ?? ""));
    if (!color) return helpers.createTextNode(String(token.raw ?? token.text ?? ""));
    const tokenize = helpers.tokenizeInline;
    const inner = helpers.parseInline(tokenize ? tokenize(String(token.text ?? "")) : []);
    return helpers.applyMark("textStyle", inner.length > 0 ? inner : [helpers.createTextNode("")], { color });
  },
  renderMarkdown: (node, helpers) => {
    const color = documentColor(String(node.attrs?.color ?? ""));
    const inner = helpers.renderChildren(node);
    return color ? `{color:${color}}${inner}{/color}` : inner;
  },
});

export const PageRef = Node.create({
  name: "pageRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ title: { default: "" }, pageId: { default: null } }),
  parseHTML: () => [{ tag: "a[data-page-ref]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "a",
    mergeAttributes(HTMLAttributes, { "data-page-ref": node.attrs.pageId ?? node.attrs.title }),
    node.attrs.title,
  ],
  markdownTokenName: "pageRef",
  markdownTokenizer: {
    name: "pageRef",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string) => {
      const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n|]+))?\]\]/.exec(src);
      if (!match) return undefined;
      return { type: "pageRef", raw: match[0], title: match[1], pageId: match[2] };
    },
  },
  parseMarkdown: (token) => ({
    type: "pageRef",
    attrs: { title: token.title, pageId: token.pageId ?? null },
  }),
  renderMarkdown: (node) =>
    node.attrs?.pageId ? `[[${node.attrs.title}|${node.attrs.pageId}]]` : `[[${node.attrs?.title}]]`,
});

export const IssueRef = Node.create({
  name: "issueRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ label: { default: "" }, issueId: { default: "" } }),
  parseHTML: () => [{ tag: "a[data-issue-ref]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "a",
    mergeAttributes(HTMLAttributes, { "data-issue-ref": node.attrs.issueId }),
    node.attrs.label,
  ],
  markdownTokenName: "issueRef",
  markdownTokenizer: {
    name: "issueRef",
    level: "inline",
    start: (src: string) => src.indexOf("]("),
    tokenize: (src: string) => {
      const match = /^\[([^\]\n]+)\]\(issue:([^)\s]+)\)/.exec(src);
      if (!match) return undefined;
      return { type: "issueRef", raw: match[0], label: match[1], issueId: match[2] };
    },
  },
  parseMarkdown: (token) => ({
    type: "issueRef",
    attrs: { label: token.label, issueId: token.issueId },
  }),
  renderMarkdown: (node) => `[${node.attrs?.label}](issue:${node.attrs?.issueId})`,
});

export const PageEmbed = Node.create({
  name: "pageEmbed",
  group: "block",
  atom: true,
  addAttributes: () => ({ title: { default: "" }, pageId: { default: null } }),
  parseHTML: () => [{ tag: "div[data-page-embed]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-page-embed": node.attrs.pageId ?? node.attrs.title }),
    node.attrs.title,
  ],
  markdownTokenName: "pageEmbed",
  markdownTokenizer: {
    name: "pageEmbed",
    level: "block",
    start: (src: string) => src.indexOf("![["),
    tokenize: (src: string) => {
      const match = /^!\[\[([^\]\n|]+)(?:\|([^\]\n|]+))?\]\][ \t]*(?:\n|$)/.exec(src);
      if (!match) return undefined;
      return { type: "pageEmbed", raw: match[0], title: match[1], pageId: match[2] };
    },
  },
  parseMarkdown: (token) => ({
    type: "pageEmbed",
    attrs: { title: token.title, pageId: token.pageId ?? null },
  }),
  renderMarkdown: (node) =>
    node.attrs?.pageId ? `![[${node.attrs.title}|${node.attrs.pageId}]]` : `![[${node.attrs?.title}]]`,
});

// The stored form is plain `@username` or `@[any other name]`, the same words a comment uses,
// so anything reading the Markdown sees who is meant. An address such as a@b.com stays text.
const MENTION_BOUNDARY = /[A-Za-z0-9_.+\-/@]/;

export const DocMention = Mention.extend({
  markdownTokenName: "docMention",
  markdownTokenizer: {
    name: "docMention",
    level: "inline",
    start: (src: string) => {
      for (let at = src.indexOf("@"); at !== -1; at = src.indexOf("@", at + 1)) {
        if (at === 0 || !MENTION_BOUNDARY.test(src[at - 1])) return at;
      }
      return -1;
    },
    tokenize: (src: string, tokens: Array<{ raw?: string }>) => {
      const before = tokens?.at(-1)?.raw?.at(-1);
      if (before && MENTION_BOUNDARY.test(before)) return undefined;
      const match = /^@(?:\[([^\]\n]+)\]|([A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9_]|[A-Za-z0-9]))/.exec(src);
      if (!match) return undefined;
      return { type: "docMention", raw: match[0], username: match[1] ?? match[2] };
    },
  },
  parseMarkdown: (token) => ({ type: "mention", attrs: { id: token.username, label: null } }),
  renderMarkdown: (node) => mentionText(String(node.attrs?.id)),
}).configure({ HTMLAttributes: { class: "doc-mention", "data-testid": "mention-chip" } });

export function documentExtensions(
  options: { sharedHistory?: boolean; mention?: AnyExtension; embed?: AnyExtension; pageRef?: AnyExtension } = {}
): AnyExtension[] {
  return [
    options.mention ?? DocMention,
    DocTextStyle,
    Color,
    StarterKit.configure({
      link: { openOnClick: false, autolink: true },
      underline: false,
      codeBlock: false,
      // A shared document undoes through its own history, one person's changes at a time.
      ...(options.sharedHistory ? { undoRedo: false as const } : {}),
    }),
    CodeBlockLowlight.configure({ lowlight: documentLowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // The stock table writes a leading blank line, which the reader takes as an empty block.
    // Inside a list item that blank line has to stay: a table cannot interrupt the item's
    // text, so without it the next parse reads the table as plain text.
    Table.extend({
      renderMarkdown: (node, helpers, context) => {
        const table = renderTableToMarkdown(node, helpers).trim();
        return context?.parentType === "listItem" || context?.parentType === "taskItem" ? `\n${table}` : table;
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    DocumentImage,
    DocToggle,
    DetailsSummary,
    DetailsContent,
    Callout,
    options.pageRef ?? PageRef,
    IssueRef,
    options.embed ?? PageEmbed,
  ];
}
