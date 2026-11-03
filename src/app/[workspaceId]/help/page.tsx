import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { Markdown } from "@/components/markdown";
import { resolveLocale } from "@/lib/locale";

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

const GUIDE_ZH = `# Markdown

概览、文档、任务描述和评论都用同一套 Markdown，它是 Notion Markdown 的子集。输入时不会隐藏任何标记，写完后的样子和 Notion 里一样。

## 文字

- \`**粗体**\` 或 ⌘B → **粗体**
- \`*斜体*\` 或 \`_斜体_\` 或 ⌘I → *斜体*
- \`~~删除线~~\` 或 ⌘⇧X → ~~删除线~~
- 用反引号包住文字，或按 ⌘E，得到 \`行内代码\`。

在标记前加反斜杠，标记就按原样显示：\`\\*文字\\*\` 显示星号，不变成斜体。

## 标题

在行首输入 \`# \` 再按空格。\`##\` 到 \`######\` 依次是更小的标题，和 Notion 一样共六级。

## 列表

- \`- \` 开始一个无序列表；圆点正好落在文字原来开始的位置。
- \`1. \` 开始一个有序列表。
- 按 Tab 缩进当前行，按 Shift+Tab 退回。最多四级，足够写任何大纲。
- 按 Enter 开始下一项；在空的一项上再按一次 Enter 退出列表。

## 待办

- \`- [ ] \` 是未勾选的方框，\`- [x] \` 是已勾选的方框。
- 编辑器也接受 Notion 的快捷写法 \`[] \`，并把它变成待办。
- 在写完的任务描述里点方框，会直接勾选，不用打开编辑器。

## 引用和分隔线

- \`> \` 开始一个引用块。
- 在编辑器里，输入一个直引号再加空格，效果相同，和 Notion 的做法一样。
- 单独一行的 \`---\` 画一条分隔线。

## 代码

- 输入三个反引号再加空格，打开一个代码块；反引号后面写的语言会成为代码块的标签。
- 写完的代码块在标题栏显示语言，鼠标悬停时显示复制按钮。
- 代码块保留所有空格和换行，内容太宽时横向滚动，不自动折行。

## 链接和图片

- \`[文字](https://example.com)\` → [文字](https://example.com)
- \`<https://example.com>\` → <https://example.com>
- 单独一行的 \`![说明](https://example.com/photo.png)\` 显示图片，说明文字在图片下方。
- 链接只允许 \`http:\`、\`https:\` 和 \`mailto:\`，图片必须来自 \`http\` 或 \`https\`。其他地址按原文显示。

## 表格

- 先写表头行，再写一行 \`---\`，然后是各行内容：\`| 步骤 | 负责人 |\`。
- \`:---\`、\`:---:\` 和 \`---:\` 分别让一列左对齐、居中、右对齐。
- 单元格里要写竖线时用 \`\\|\`，要换行时用 \`<br>\`。
- 拖动列和行之间的分隔线可以调整大小；每篇文档各自记住布局。

## 页面里的页面

文档之间可以像 Notion 页面一样互相引用：

- \`[[页面标题]]\` 显示为带页面图标的下划线链接。
- \`[[页面标题|page-id]]\` 是完整写法，「链接页面」按钮插入的就是这种。
- 单独一行的 \`![[页面标题]]\` 把整个页面嵌进当前页面，显示在一个带边框的卡片里。
- 单独占一行的页面引用显示为子页面行，所以子页面可以放在文档任何位置：移动这一行，子页面行跟着移动。
- 还没写进正文的子页面列在顶部；点某一行上的 \\+，把它放到正文顶部。

## 编辑快捷键

- Enter 拆分一个块；在块开头按 Backspace，把它合并到上一个块。
- Shift+Enter 在段落或代码块里换行，不新开一个块。
- 拖动选中多行，就选中了整块；再按 Backspace 或 Delete 删除。
- ⌘A 选中所有块，⌘C / ⌘X 以 Markdown 复制或剪切，直接输入会替换选中的内容。
- ⌘Z 撤销当前行里的上一次编辑；再按 ⌘Z 在整篇文档里逐步回退。
- Esc 关闭斜杠菜单或块选择。
- 输入 \`/\` 打开斜杠菜单，可以插入标题、列表、待办、引用和代码块。
- 上下方向键在块之间移动光标。

## TaCos 不支持的 Notion 功能

TaCos 读写的是 Markdown 文件，不是 Notion API 文档。下面这些在 Notion 里有，在这里按纯文本显示：

- Notion 的 API 标签（\`<callout>\`、\`<toggle>\`、\`<span color>\`、\`<mention>\`、\`<date>\`、\`<table>\`、\`<columns>\`）只在 Notion API 里有意义。TaCos 按原文显示，也从不写入这些标签。
- 颜色、下划线、标注块和折叠块不属于这种文件格式。
- \`>\` 是引用，和 Markdown 文件里一样。（在 Notion 自己的编辑器里，\`>\` 加空格打开的是折叠块。）
- 有序列表只用数字：\`a.\` 和 \`i.\` 按文字显示。
- LaTeX 公式（\`$…$\`、\`$$\`）和 Mermaid 图表按原文显示；没有内置公式或图表渲染器。
- 图片或链接指向一个 URL。TaCos 不会把文件上传进文档。
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
      <div className="w-full px-10 pb-8 pt-6 lg:px-20 xl:px-32">
        <Markdown source={(await resolveLocale(user)) === "zh" ? GUIDE_ZH : GUIDE} />
      </div>
    </div>
  );
}
