import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { Markdown } from "@/components/markdown";

const GUIDE = `# Markdown

Overviews, documents, task descriptions and comments all use the same subset of Notion's Markdown. Nothing is hidden while you type, and the finished text looks the way it does in Notion.

## Text

- \`**bold**\` or ⌘B → **bold**
- \`*italic*\` or \`_italic_\` or ⌘I → *italic*
- \`~~strike~~\` or ⌘⇧X → ~~strike~~
- Wrap text in backticks, or press ⌘E, for \`inline code\`.

A backslash keeps a marker literal: \`\\*text\\*\` shows the stars, not italic.

## Headings

Start a line with \`# \` and press space. \`##\` to \`######\` give smaller headings — the same six levels as Notion.

## Lists

- \`- \` starts a bullet; the dot sits exactly where the text began.
- \`1. \` starts a numbered list.
- Press Tab to indent the current line, Shift+Tab to bring it back. Four levels are enough for any outline.
- Enter starts the next item; press Enter again on an empty item to leave the list.

## To-dos

- \`- [ ] \` makes an unchecked box, \`- [x] \` a checked one.
- The editor also accepts \`[] \` — Notion's shortcut — and turns it into a to-do.
- Clicking a box in a finished task description ticks it now, without opening the editor.

## Quote and divider

- \`> \` starts a quote block.
- In the editor, a straight quotation mark followed by a space does the same, the way Notion does it.
- \`---\` on its own line draws a divider.

## Code

- Type three backticks and a space to open a code block; the language after the backticks labels it.
- The finished block shows the language on a header bar and a Copy button when you hover it.
- A code block keeps every space and line break, and scrolls sideways instead of wrapping.

## Links and pictures

- \`[label](https://example.com)\` → [label](https://example.com)
- \`<https://example.com>\` → <https://example.com>
- \`![caption](https://example.com/photo.png)\` on its own line shows the picture with the caption underneath.
- Only \`http:\`, \`https:\` and \`mailto:\` links are allowed, and pictures must come from \`http\` or \`https\`. Anything else stays visible as text.

## Tables

- A header row, a \`---\` row, then the rows: \`| Step | Owner |\`.
- \`:---\`, \`:---:\` and \`---:\` align a column left, centre or right.
- Put \`\\|\` inside a cell for a literal pipe, and \`<br>\` for a line break.
- Drag the lines between columns and rows to resize them; the layout is remembered per document.

## Pages inside pages

Docs can point at each other the way Notion pages do:

- \`[[Page title]]\` becomes an underlined link with the page icon.
- \`[[Page title|page-id]]\` is the explicit form the "Link a page" button inserts.
- \`![[Page title]]\` on its own line embeds the whole page inside this one, inside a bordered card.
- A page reference alone on its line is drawn as a subpage row, so a subpage can sit anywhere in the document — move the line and the row moves with it.
- Subpages that are not yet in the text are listed at the top; the \\+ on a row puts it at the top of the text.

## Editing shortcuts

- Enter splits a block; Backspace at the start of a block merges it back into the one above.
- Shift+Enter breaks a paragraph or a code block onto a new line without starting a new block.
- Drag across several lines to select whole blocks, then press Backspace or Delete to remove them.
- ⌘A selects every block, ⌘C / ⌘X copy or cut them as Markdown, and typing replaces the selection.
- ⌘Z undoes the last edit inside the open line; a second ⌘Z steps back through the document.
- Esc closes the slash menu or the block selection.
- The slash menu opens with \`/\` and inserts headings, lists, to-dos, quotes and code blocks.
- The up and down arrows move the caret between blocks.

## Where TaCos stops short of Notion

TaCos reads and writes Markdown files, not Notion's API documents. These exist in Notion and stay plain text here:

- Notion's API tags — \`<callout>\`, \`<toggle>\`, \`<span color>\`, \`<mention>\`, \`<date>\`, \`<table>\`, \`<columns>\` — are only meaningful through Notion's API. TaCos shows them literally and never writes them.
- Colours, underline, callouts and collapsible blocks are not part of the file format.
- \`>\` is a quote, as it is in a Markdown file. (In Notion's own editor \`>\` plus space opens a toggle.)
- Numbered lists are digits: \`a.\` and \`i.\` stay text.
- LaTeX math (\`$…$\`, \`$$\`) and Mermaid diagrams are shown as written; no math or diagram renderer is bundled.
- A picture or a link points at a URL. TaCos does not upload files into a document.
`;

export default function HelpPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <HelpContent params={params} />
    </Suspense>
  );
}

async function HelpContent({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-8">
        <Markdown source={GUIDE} />
      </div>
    </div>
  );
}
