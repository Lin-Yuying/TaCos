import { Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow, renderTableToMarkdown } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";

// Stored documents stay Markdown. These nodes carry the three things TaCos adds to it,
// so `[[page]]`, `![[page]]` and `[PROJ-1](issue:id)` come back from the editor unchanged.

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

// The stored form is plain `@username`, the same words a comment uses, so anything reading
// the Markdown sees who is meant. An address such as a@b.com stays text.
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
      const match = /^@([A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9_]|[A-Za-z0-9])/.exec(src);
      if (!match) return undefined;
      return { type: "docMention", raw: match[0], username: match[1] };
    },
  },
  parseMarkdown: (token) => ({ type: "mention", attrs: { id: token.username, label: null } }),
  renderMarkdown: (node) => `@${node.attrs?.id}`,
}).configure({ HTMLAttributes: { class: "doc-mention", "data-testid": "mention-chip" } });

export function documentExtensions(
  options: { sharedHistory?: boolean; mention?: AnyExtension } = {}
): AnyExtension[] {
  return [
    options.mention ?? DocMention,
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
    Image,
    PageRef,
    IssueRef,
    PageEmbed,
  ];
}
