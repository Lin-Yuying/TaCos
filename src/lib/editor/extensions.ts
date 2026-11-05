import { Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow, renderTableToMarkdown } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { deleteSelectedImage, DOC_IMAGE_CLASS } from "@/lib/editor/doc-image";
import { documentColor } from "@/lib/markdown";
import { mentionText } from "@/lib/mentions";

const DocumentImage = Image.extend({
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteSelectedImage(editor.state, (tr) => editor.view.dispatch(tr)),
      Delete: ({ editor }) => deleteSelectedImage(editor.state, (tr) => editor.view.dispatch(tr)),
    };
  },
}).configure({ HTMLAttributes: { class: DOC_IMAGE_CLASS } });

// Stored documents stay Markdown. These nodes carry the three things TaCos adds to it,
// so `[[page]]`, `![[page]]` and `[PROJ-1](issue:id)` come back from the editor unchanged.

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
  options: { sharedHistory?: boolean; mention?: AnyExtension } = {}
): AnyExtension[] {
  return [
    options.mention ?? DocMention,
    DocTextStyle,
    Color,
    StarterKit.configure({
      link: { openOnClick: false, autolink: true },
      underline: false,
      // A shared document undoes through its own history, one person's changes at a time.
      ...(options.sharedHistory ? { undoRedo: false as const } : {}),
    }),
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
    PageRef,
    IssueRef,
    PageEmbed,
  ];
}
