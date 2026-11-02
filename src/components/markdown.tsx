"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  CodeCollapseButton,
  CodeCopyButton,
  CodeLanguageMenu,
  CodeOptionsMenu,
  CodeTokens,
  useLineNumbers,
} from "@/components/code-block-controls";
import { splitTokensByLine, tokenize } from "@/lib/code-highlight";
import { PriorityIcon } from "@/components/icons";
import type { Priority, Status } from "@/lib/constants";
import {
  parseBlocks,
  parseInline,
  setCodeLang,
  setTodoChecked,
  type Block,
  type Inline,
  type TableAlign,
} from "@/lib/markdown";

export type PageRefEntry = { id: string; title: string; icon: string | null };

/** Everything needed to draw an inline task reference with its live priority. */
export type IssueRefEntry = {
  id: string;
  identifier: string;
  title: string;
  priority: Priority;
  status: Status;
};

export type IssueContext = {
  lookup: Record<string, IssueRefEntry>;
  // Titles of referenced tasks that were deleted and therefore left the lookup. They
  // read as ordinary text again instead of a dead chip.
  deleted?: Record<string, string>;
  onOpen?: (id: string) => void;
};

/**
 * Everything the reader needs to turn [[Page]] / ![[Page]] into links: the pages it
 * may see (keyed by id and by lowercase title), how to link to one, and the bodies of
 * the pages embedded in this document.
 */
export type PageContext = {
  lookup: Record<string, PageRefEntry>;
  // prefix for a page URL, e.g. "/<workspace>/docs/" — kept as data so the context
  // can cross the server/client boundary
  base: string;
  embeds?: Record<string, string>;
  // Set where a page is better read beside the current one (a project Overview, a
  // document open in the split pane) than on its own tab: the reference becomes a
  // button that opens the page there instead of navigating away.
  onOpen?: (id: string) => void;
};

function findPage(ctx: PageContext | undefined, title: string, id?: string) {
  if (!ctx) return null;
  return (id ? ctx.lookup[id] : undefined) ?? ctx.lookup[title.trim().toLowerCase()] ?? null;
}

function PageChip({
  target,
  ctx,
  className,
}: {
  target: PageRefEntry;
  ctx: PageContext;
  className?: string;
}) {
  const body = (
    <>
      {/* The icon is chrome: the stored Markdown only has the page title, so leaving
          it in the text flow would shift every passage after the chip. */}
      <span data-md-glyph className="shrink-0">{target.icon ?? "📄"}</span>
      <span className="truncate underline decoration-border-strong underline-offset-2 hover:decoration-text">
        {target.title}
      </span>
    </>
  );
  const frame = `inline-flex max-w-full items-baseline gap-1 align-baseline text-text ${className ?? ""}`;
  if (ctx.onOpen) {
    return (
      <button
        type="button"
        onClick={(event) => {
          // The block underneath opens for editing on click; the chip opens the page.
          event.stopPropagation();
          ctx.onOpen?.(target.id);
        }}
        className={`${frame} cursor-pointer text-left`}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={`${ctx.base}${target.id}`} className={frame}>
      {body}
    </Link>
  );
}

// A page reference alone on its line is a subpage placed at this spot: it reads as the
// same row the page list draws, and moving that line is what moves the subpage.
export function PageRow({
  target,
  ctx,
  className,
}: {
  target: PageRefEntry;
  ctx: PageContext;
  className?: string;
}) {
  const body = (
    <>
      <span data-md-glyph className="shrink-0">{target.icon ?? "📄"}</span>
      <span className="truncate underline decoration-border-strong underline-offset-2 hover:decoration-text">
        {target.title}
      </span>
    </>
  );
  const frame = `flex items-center gap-2 rounded px-1 text-[14px] leading-relaxed text-text hover:bg-elevated/60 ${className ?? ""}`;
  if (ctx.onOpen) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          ctx.onOpen?.(target.id);
        }}
        className={`${frame} cursor-pointer text-left`}
      >
        {body}
      </button>
    );
  }
  return (
    <Link href={`${ctx.base}${target.id}`} className={frame}>
      {body}
    </Link>
  );
}

/** The single page reference of a line, when nothing else is on it. */
function lonePageRef(nodes: Inline[]): Extract<Inline, { type: "page" }> | null {
  let found: Extract<Inline, { type: "page" }> | null = null;
  for (const node of nodes) {
    if (node.type === "page") {
      if (found) return null;
      found = node;
    } else if (node.type !== "text" || node.text.trim() !== "") {
      return null;
    }
  }
  return found;
}

// Linear's inline issue reference: priority glyph, identifier, title, lifted off the
// page by a hairline border and a soft shadow rather than a filled chip.
function IssueChip({
  issueId,
  fallback,
  ctx,
}: {
  issueId: string;
  fallback: string;
  ctx?: IssueContext;
}) {
  const entry = ctx?.lookup[issueId];
  // A deleted task gives the sentence its words back. The reference stays in the
  // Markdown, so restoring the task from the Trash brings the chip back.
  const deletedTitle = ctx?.deleted?.[issueId];
  if (deletedTitle && !entry)
    return (
      // The id lets a selection here act on the reference itself: the title on screen
      // is not the markdown label, so a plain-text anchor would miss the source.
      <span data-issue-ref={issueId}>{deletedTitle}</span>
    );
  // Nothing resolves this id at all — purged from the Trash, or a task this reader
  // cannot see. An identifier-only chip would still look like a live task, so the
  // reference goes back to being the words that were typed.
  if (ctx && !entry) return <span data-issue-ref={issueId}>{fallback}</span>;
  const identifier = entry?.identifier ?? fallback;
  const title = entry?.title ?? "";
  const frame =
    "inline-flex max-w-full items-center gap-1 rounded-[4px] border border-border bg-elevated px-1.5 align-baseline text-[12.5px] font-medium leading-[18px] text-text shadow-[0_1px_2px_rgba(0,0,0,0.14)]";
  const body = (
    <>
      <span className="shrink-0" aria-hidden>
        <PriorityIcon priority={entry?.priority ?? 0} size={12} />
      </span>
      <span className={title ? "shrink-0 text-muted" : "truncate"}>{identifier}</span>
      {/* Only the identifier is in the Markdown; the title is live context. */}
      {title && (
        <span data-md-glyph className="truncate">
          {title}
        </span>
      )}
    </>
  );
  if (ctx?.onOpen) {
    return (
      <button
        type="button"
        title={title || identifier}
        onClick={(event) => {
          // The block underneath opens for editing on click; the chip opens the task.
          event.stopPropagation();
          ctx.onOpen?.(issueId);
        }}
        className={`${frame} cursor-pointer transition-colors hover:border-border-strong hover:bg-border`}
      >
        {body}
      </button>
    );
  }
  return (
    <span title={title || identifier} className={frame}>
      {body}
    </span>
  );
}

function renderInline(
  nodes: Inline[],
  keyPrefix: string,
  pages?: PageContext,
  issues?: IssueContext
): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {node.text}
          </strong>
        );
      case "bolditalic":
        return (
          <strong key={key} className="font-semibold">
            <em>{node.text}</em>
          </strong>
        );
      case "italic":
        return (
          <em key={key}>{node.text}</em>
        );
      case "strike":
        return (
          <s key={key}>{node.text}</s>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-text"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {node.text}
          </a>
        );
      case "page": {
        const target = findPage(pages, node.text, node.pageId);
        if (!target || !pages) {
          return (
            <span key={key} className="text-muted">
              {node.text}
            </span>
          );
        }
        return <PageChip key={key} target={target} ctx={pages} />;
      }
      case "issue":
        return <IssueChip key={key} issueId={node.issueId} fallback={node.text} ctx={issues} />;
      default:
        return node.text;
    }
  });
}

// Notion's code block: the fence's language rides on a header bar with the options, copy
// and collapse controls. They are always visible — a control that only appears on hover
// reads as a control that vanished the moment you click into the block.

function CodeBlock({
  block,
  onLangChange,
  moveHandle,
}: {
  block: Extract<Block, { kind: "code" }>;
  onLangChange?: (lang: string) => void;
  /** Drag affordance the editor drops into the header; absent in read-only renders. */
  moveHandle?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const showNumbers = useLineNumbers();
  const tokens = useMemo(() => tokenize(block.body, block.lang), [block.body, block.lang]);
  const lines = useMemo(() => splitTokensByLine(tokens), [tokens]);
  return (
    <div className="group/code my-2 rounded-lg border border-border bg-surface">
      <div
        className={`flex h-7 items-center gap-1 pl-1 pr-1 ${
          collapsed ? "" : "border-b border-border/70"
        }`}
      >
        {moveHandle}
        <CodeCollapseButton collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <div className="ml-auto flex items-center gap-1">
          <CodeLanguageMenu lang={block.lang} onChange={onLangChange} />
          <CodeOptionsMenu />
          <CodeCopyButton code={block.body} />
        </div>
      </div>
      {!collapsed && (
        // Soft-wrap like the open line's textarea: a long line takes as many rows as the
        // column gives it, so finishing an edit never re-flows the code.
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-b-lg p-3 font-mono text-[12.5px] leading-relaxed text-text">
          {showNumbers ? (
            <code className="block">
              {block.body.split("\n").map((line, i) => (
                // The gutter is skipped by text selection, so dragging across the block
                // copies the code and not the numbers.
                <span key={i} className="flex">
                  <span
                    aria-hidden
                    className="flex w-10 shrink-0 select-none justify-end pr-4 text-right tabular-nums text-faint"
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                    {line ? <CodeTokens tokens={lines[i] ?? []} /> : " "}
                  </span>
                </span>
              ))}
            </code>
          ) : (
            <code>
              {/* One block per source line, so a blank line at the end keeps its row
                  (same as the gutter layout and the open textarea). */}
              {block.body.split("\n").map((line, i) => (
                <span key={i} className="block whitespace-pre-wrap break-words">
                  {line ? <CodeTokens tokens={lines[i] ?? []} /> : " "}
                </span>
              ))}
            </code>
          )}
        </pre>
      )}
    </div>
  );
}

export function MarkdownBlock({
  block,
  onToggleTodo,
  onCodeLangChange,
  moveHandle,
  pages,
  issues,
  storageKey,
  listStart,
}: {
  block: Block;
  onToggleTodo?: (itemIndex: number, checked: boolean) => void;
  /** Makes the code header's language a picker; receives the language it wrote. */
  onCodeLangChange?: (lang: string) => void;
  moveHandle?: ReactNode;
  pages?: PageContext;
  issues?: IssueContext;
  storageKey?: string;
  /** Number of items before this list's first item, for a list drawn one item at a time. */
  listStart?: number;
}) {
  const inline = (nodes: Inline[], keyPrefix: string) =>
    renderInline(nodes, keyPrefix, pages, issues);
  switch (block.kind) {
    case "heading": {
      const size = ["text-[20px]", "text-[17px]", "text-[15px]", "text-[14px]", "text-[13px]", "text-[13px]"][
        block.level - 1
      ];
      const Tag = (`h${block.level}` as unknown) as "h1";
      return (
        <Tag
          className={`${size} mt-5 mb-1.5 whitespace-pre-wrap font-semibold tracking-tight first:mt-0`}
          style={{ marginLeft: block.depth * 20 }}
        >
          {inline(block.text, "h")}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote
          className="my-2 border-l-2 border-border-strong pl-3 text-muted"
          style={{ marginLeft: block.depth * 20 }}
        >
          {block.lines.map((line, i) => (
            <p key={i} className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
              {inline(line, `q${i}`)}
            </p>
          ))}
        </blockquote>
      );
    case "list": {
      // Markers are drawn here rather than by the browser: a native ::marker hangs off
      // the list container, so an indented item's dot stays at the article's left edge
      // while its text moves right. Drawing the dot in the item's own gutter keeps it
      // attached to the indent — the same geometry the editor uses while typing.
      const items = block.items.map((item, i) => (
        <li
          key={i}
          style={{ marginLeft: item.depth * 20 }}
          className="flex list-none items-start gap-2"
        >
          <span
            aria-hidden
            data-md-glyph
            className={`flex min-h-[24px] w-4 shrink-0 select-none text-[13.5px] leading-relaxed ${
              block.ordered ? "justify-end text-muted" : "justify-start text-faint"
            }`}
          >
            {block.ordered ? `${(listStart ?? 0) + i + 1}.` : "•"}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{inline(item.text, `l${i}`)}</span>
        </li>
      ));
      return block.ordered ? (
        <ol className="my-1.5 space-y-1 text-[13.5px] leading-relaxed">{items}</ol>
      ) : (
        <ul className="my-1.5 space-y-1 text-[13.5px] leading-relaxed">{items}</ul>
      );
    }
    case "todo":
      return (
        <div className="my-1.5 space-y-1">
          {block.items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-[13.5px] leading-relaxed"
              style={{ marginLeft: item.depth * 20 }}
            >
              <span data-md-glyph className="flex w-4 shrink-0 justify-start pt-[3px]">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.checked}
                  aria-label={item.checked ? "Mark as not done" : "Mark as done"}
                  // Without a handler the box is just how the block looks while you edit it.
                  disabled={!onToggleTodo}
                  onClick={(event) => {
                    // Ticking the box is not a request to edit the line.
                    event.stopPropagation();
                    onToggleTodo?.(i, !item.checked);
                  }}
                  className={`flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                    item.checked ? "border-accent bg-accent text-white" : "border-border-strong bg-bg"
                  } ${onToggleTodo ? "cursor-pointer transition-colors hover:border-accent" : ""}`}
                >
                  {item.checked ? "✓" : ""}
                </button>
              </span>
              <span className={`min-w-0 flex-1 whitespace-pre-wrap ${item.checked ? "text-faint line-through" : ""}`}>
                {inline(item.text, `t${i}`)}
              </span>
            </div>
          ))}
        </div>
      );
    case "code":
      return <CodeBlock block={block} onLangChange={onCodeLangChange} moveHandle={moveHandle} />;
    case "divider":
      return <hr className="my-4 border-border" />;
    case "image":
      return (
        <figure className="my-3" style={{ marginLeft: block.depth * 20 }}>
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-[520px] max-w-full rounded-lg border border-border bg-elevated object-contain"
          />
          {block.alt && (
            <figcaption className="mt-1 text-[12px] text-faint">{block.alt}</figcaption>
          )}
        </figure>
      );
    case "table":
      return <TableBlock block={block} pages={pages} issues={issues} storageKey={storageKey} />;
    case "embed": {
      const target = findPage(pages, block.text, block.pageId);
      const body = target && pages?.embeds ? pages.embeds[target.id] : undefined;
      return (
        <div className="my-3" style={{ marginLeft: block.depth * 20 }}>
          <div className="flex items-center gap-1.5 text-[13px]">
            {target && pages ? (
              <PageChip target={target} ctx={pages} className="font-medium text-muted" />
            ) : (
              <span className="text-faint">Missing page: {block.text}</span>
            )}
          </div>
          {target && body !== undefined && (
            <div className="mt-1.5 rounded-lg border border-border bg-surface/50 px-3 py-2">
              {body.trim() ? (
                <Markdown
                  source={body}
                  pages={pages ? { ...pages, embeds: {} } : undefined}
                  issues={issues}
                  storageId={target ? `doc:${target.id}` : undefined}
                />
              ) : (
                <p className="text-[12.5px] text-faint">This page is empty.</p>
              )}
            </div>
          )}
        </div>
      );
    }
    default: {
      if (block.lines.every((line) => line.length === 0)) {
        // A blank line the author left on purpose keeps the height the editor gives it,
        // so the rendered document and the one being edited occupy the same space.
        return <div className="my-1.5 min-h-[22px]" aria-hidden />;
      }
      const lone = block.lines.length === 1 ? lonePageRef(block.lines[0]) : null;
      const target = lone ? findPage(pages, lone.text, lone.pageId) : null;
      if (target && pages) {
        // A line that is only a page reference keeps the page's own line height, so
        // placing a subpage in the text never changes the geometry of the passage
        // around it when the editor swaps between source and rendered text.
        return (
          <div className="my-1.5" style={{ marginLeft: block.depth * 20 }}>
            <PageRow target={target} ctx={pages} />
          </div>
        );
      }
      return (
        <p
          className="my-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed"
          style={{ marginLeft: block.depth * 20 }}
        >
          {block.lines.map((line, i) => (
            <span key={i}>
              {inline(line, `p${i}`)}
              {i < block.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </p>
      );
    }
  }
}

type TableLayout = { c: number[]; r: Record<number, number> };

function readTableLayout(key: string, cols: number): TableLayout | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TableLayout;
    if (!Array.isArray(parsed.c) || parsed.c.length !== cols) return null;
    if (!parsed.c.every((n) => Number.isFinite(n) && n > 0)) return null;
    return { c: parsed.c, r: parsed.r ?? {} };
  } catch {
    return null;
  }
}

// Widths and row heights are owned outside React state so the measuring pass can
// publish them without a setState-inside-an-effect.
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const EMPTY_HEIGHTS: Record<number, number> = {};
const EMPTY_BOTTOMS: number[] = [];

const MIN_COL_PCT = 6;

// Notion-style table: the lines between columns and rows are draggable. Widths are
// relative (the table always fills its column, neighbours trade pixels); heights are
// per-row minimums. Both live in localStorage per document + table, never in the
// Markdown source, so the stored format the importer and API see stays untouched.
function TableBlock({
  block,
  pages,
  issues,
  storageKey,
}: {
  block: Extract<Block, { kind: "table" }>;
  pages?: PageContext;
  issues?: IssueContext;
  storageKey?: string;
}) {
  const cols = block.header.length;
  const [layoutStore] = useState(() => createStore<TableLayout | null>(null));
  const [bottomsStore] = useState(() => createStore<number[]>(EMPTY_BOTTOMS));
  const layout = useSyncExternalStore(layoutStore.subscribe, layoutStore.get, () => null);
  const rowBottoms = useSyncExternalStore(
    bottomsStore.subscribe,
    bottomsStore.get,
    () => EMPTY_BOTTOMS
  );
  const [dragging, setDragging] = useState<{ kind: "col" | "row"; index: number } | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const keyRef = useRef<string | null>(null);

  const widths = layout?.c ?? null;
  const heights = layout?.r ?? EMPTY_HEIGHTS;

  const cell = (text: string, keyPrefix: string) => {
    const parts = text.split(/<br\s*\/?>/i);
    return parts.map((part, i) => (
      <span key={i}>
        {i > 0 && <br />}
        {renderInline(parseInline(part), `${keyPrefix}-${i}`, pages, issues)}
      </span>
    ));
  };
  const alignOf = (align: TableAlign | null) => (align ? { textAlign: align } : undefined);

  // First paint is the browser's own column sizing; freeze those measurements so a
  // later drag has something to move. A saved layout wins over measuring.
  useEffect(() => {
    if (!storageKey) return;
    const current = layoutStore.get();
    if (keyRef.current === storageKey && current && current.c.length === cols) return;
    keyRef.current = storageKey;
    const stored = readTableLayout(storageKey, cols);
    if (stored) {
      layoutStore.set(stored);
      return;
    }
    const table = tableRef.current;
    if (!table) return;
    const measured = [...table.querySelectorAll("thead th")].map(
      (cell) => cell.getBoundingClientRect().width
    );
    const total = measured.reduce((sum, width) => sum + width, 0);
    if (!total) return;
    layoutStore.set({ c: measured.map((width) => (width / total) * 100), r: {} });
  }, [layoutStore, storageKey, cols]);

  // Row edges follow the content (a wrapped cell, a dragged height), so they are
  // measured from the DOM instead of derived from the state that moved them.
  useEffect(() => {
    if (!widths) return;
    const table = tableRef.current;
    const wrap = wrapRef.current;
    if (!table || !wrap) return;
    const measure = () => {
      const top = wrap.getBoundingClientRect().top;
      const next = [...table.rows].map((row) => row.getBoundingClientRect().bottom - top);
      const prev = bottomsStore.get();
      if (
        next.length === prev.length &&
        next.every((bottom, i) => Math.abs(bottom - prev[i]) < 0.5)
      ) {
        return;
      }
      bottomsStore.set(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return () => observer.disconnect();
  }, [bottomsStore, widths, heights, block]);

  const persist = () => {
    const current = layoutStore.get();
    if (!storageKey || !current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(current));
    } catch {
      // A full or blocked localStorage only costs the remembered layout.
    }
  };

  const endDrag = () => {
    setDragging(null);
    persist();
  };

  const beginColDrag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = layoutStore.get();
    const table = tableRef.current;
    if (!current || !table) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const tableWidth = table.getBoundingClientRect().width;
    if (!tableWidth) return;
    const base = current.c;
    const rows = current.r;
    const startX = event.clientX;
    const min = Math.min(MIN_COL_PCT, (64 / tableWidth) * 100);
    const move = (ev: PointerEvent) => {
      const delta = ((ev.clientX - startX) / tableWidth) * 100;
      let left = base[index] + delta;
      let right = base[index + 1] - delta;
      if (left < min) {
        right -= min - left;
        left = min;
      }
      if (right < min) {
        left -= min - right;
        right = min;
      }
      const next = base.slice();
      next[index] = left;
      next[index + 1] = right;
      layoutStore.set({ c: next, r: rows });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      endDrag();
    };
    setDragging({ kind: "col", index });
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  const beginRowDrag = (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = layoutStore.get();
    const row = tableRef.current?.rows[index];
    if (!current || !row) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = row.getBoundingClientRect().height;
    const move = (ev: PointerEvent) => {
      const next = {
        ...current.r,
        [index]: Math.max(28, startHeight + ev.clientY - startY),
      };
      layoutStore.set({ c: current.c, r: next });
    };
    const finish = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      endDrag();
    };
    setDragging({ kind: "row", index });
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  const cuts = widths
    ? widths.slice(0, -1).map((_, i) => widths.slice(0, i + 1).reduce((sum, w) => sum + w, 0))
    : [];

  return (
    // A wide reference table scrolls instead of squeezing every column. Horizontal
    // only: `overflow-x: auto` alone promotes the other axis to `auto` too, and the
    // row handles that sit on the last border overflow by a few pixels — which showed
    // up as a near-full-height scrollbar down the table's right edge.
    <div
      ref={wrapRef}
      className={`relative my-3 overflow-x-auto overflow-y-hidden ${
        dragging ? (dragging.kind === "col" ? "cursor-col-resize" : "cursor-row-resize") : ""
      }`}
    >
      <table
        ref={tableRef}
        className="w-full border-collapse text-[12.5px] leading-relaxed"
        style={widths ? { tableLayout: "fixed" } : undefined}
      >
        {widths && (
          <colgroup>
            {widths.map((width, i) => (
              <col key={i} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr style={heights[0] ? { height: heights[0] } : undefined}>
            {block.header.map((text, i) => (
              <th
                key={i}
                style={alignOf(block.align[i] ?? null)}
                className="border border-border bg-elevated px-2 py-1 text-left align-top font-semibold break-words text-text"
              >
                {cell(text, `th${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} style={heights[r + 1] ? { height: heights[r + 1] } : undefined}>
              {row.map((text, c) => (
                <td
                  key={c}
                  style={alignOf(block.align[c] ?? null)}
                  className="border border-border px-2 py-1 text-left align-top break-words text-text"
                >
                  {cell(text, `td${r}-${c}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {widths &&
        cuts.map((left, i) => (
          <div
            key={`c${i}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the column"
            title="Drag to resize the column"
            onPointerDown={beginColDrag(i)}
            style={{ left: `${left}%` }}
            className="group absolute top-0 bottom-0 z-10 w-2.5 -translate-x-1/2 cursor-col-resize touch-none select-none"
          >
            <span
              className={`mx-auto block h-full w-px transition-colors ${
                dragging?.kind === "col" && dragging.index === i
                  ? "bg-accent"
                  : "bg-transparent group-hover:bg-accent/70"
              }`}
            />
          </div>
        ))}
      {widths &&
        rowBottoms.map((bottom, r) => (
          <div
            key={`r${r}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the row"
            title="Drag to resize the row"
            onPointerDown={beginRowDrag(r)}
            style={{ top: bottom - 4 }}
            className="group absolute inset-x-0 z-10 h-2 cursor-row-resize touch-none select-none"
          >
            <span
              className={`mx-auto block h-px w-full transition-colors ${
                dragging?.kind === "row" && dragging.index === r
                  ? "bg-accent"
                  : "bg-transparent group-hover:bg-accent/70"
              }`}
            />
          </div>
        ))}
    </div>
  );
}

export function Markdown({
  source,
  pages,
  issues,
  storageId,
  onSourceChange,
}: {
  source: string;
  pages?: PageContext;
  issues?: IssueContext;
  /** Document id used to remember dragged table layouts; omit for one-off rendering. */
  storageId?: string;
  /**
   * Makes rendered checkboxes tickable. Receives the whole Markdown with one box
   * flipped, so the caller can save it back as a one-character edit.
   */
  onSourceChange?: (next: string) => void;
}) {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;
  let tables = 0;
  // The language picker rewrites the source, which only makes sense when the caller
  // can save it back (the issue description, not a comment thread).
  let codes = 0;
  // Checkbox positions are counted across the whole source: setTodoChecked walks every
  // checkbox line, while a block only knows the items inside itself.
  const todoCounts = blocks.map((block) => (block.kind === "todo" ? block.items.length : 0));
  const todoBases = todoCounts.map((_, i) =>
    todoCounts.slice(0, i).reduce((sum, count) => sum + count, 0)
  );
  return (
    <div>
      {blocks.map((block, i) => {
        const base = todoBases[i];
        const codeIndex = block.kind === "code" ? codes++ : -1;
        return (
          <MarkdownBlock
            key={i}
            block={block}
            pages={pages}
            issues={issues}
            onToggleTodo={
              onSourceChange && block.kind === "todo"
                ? (item, checked) => onSourceChange(setTodoChecked(source, base + item, checked))
                : undefined
            }
            onCodeLangChange={
              onSourceChange && codeIndex >= 0
                ? (lang) => onSourceChange(setCodeLang(source, codeIndex, lang))
                : undefined
            }
            storageKey={
              storageId && block.kind === "table"
                ? `tacos.table.${storageId}.${tables++}`
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
