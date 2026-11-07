"use client";
import { documentIndex, searchDocument } from "@/lib/editor/document-index";
import { documentMarkdown } from "@/lib/editor/document-markdown";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, MoreHorizontal, X } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";

const READING_WIDTHS = [
  { label: "Narrow", width: 680 },
  { label: "Medium", width: 880 },
  { label: "Wide", width: 1120 },
] as const;

/** The floating find bar over a document. */
export function DocFindBar({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState(""),
    [matches, setMatches] = useState<{ from: number; to: number }[]>([]),
    [index, setIndex] = useState(-1);
  const [revision, setRevision] = useState(0);
  useEffect(()=>{if(!editor)return;const changed=()=>setRevision(value=>value+1);editor.on("update",changed);return()=>{editor.off("update",changed);};},[editor]);
  const indexed=useMemo(()=>editor?documentIndex(editor.state.doc):null,[editor,revision]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{if(!cancelled)setMatches(indexed?searchDocument(indexed,query):[]);},100);return()=>{cancelled=true;clearTimeout(timer);};},[indexed,query]);
  useEffect(()=>{CSS.highlights?.delete("document-find");return()=>{CSS.highlights?.delete("document-find");};},[query,editor]);
  function locate(from: number, to = from) {
    if (!editor) return;
    editor.commands.setTextSelection({ from, to });
    editor.commands.scrollIntoView();
    if(CSS.highlights&&typeof Highlight!=="undefined"&&to>from){const start=editor.view.domAtPos(from),end=editor.view.domAtPos(to);const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);CSS.highlights.set("document-find",new Highlight(range));}else editor.commands.focus();
  }
  function step(by: number, fresh = matches) {
    if (!fresh.length) return;
    const next = index < 0 ? (by < 0 ? fresh.length - 1 : 0) : (index + by + fresh.length) % fresh.length;
    setIndex(next);
    locate(fresh[next].from, fresh[next].to);
  }
  const iconButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40";
  return (
    <div
      role="search"
      data-doc-find
      className="flex max-w-full items-center gap-1 rounded-lg border border-border bg-overlay p-1.5 text-small text-muted shadow-xl"
    >
      <input
        autoFocus
        aria-label={t("Find in document")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const fresh = indexed ? searchDocument(indexed, query) : [];
            setMatches(fresh);
            step(e.shiftKey ? -1 : 1, fresh);
          }
        }}
        className="h-[34px] rounded-lg px-2.5 w-[180px] min-w-0 border border-border-strong bg-bg text-body text-text"
      />
      <span className="shrink-0 px-1 tabular-nums">
        {matches.length ? Math.max(0, index + 1) : 0} / {matches.length}
      </span>
      <button type="button" disabled={!matches.length} aria-label={t("Previous")} title={t("Previous")} onClick={() => step(-1)} className={iconButton}>
        <ChevronUp size={14} />
      </button>
      <button type="button" disabled={!matches.length} aria-label={t("Next")} title={t("Next")} onClick={() => step(1)} className={iconButton}>
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label={t("Close find")} title={t("Close find")} onClick={onClose} className={iconButton}>
        <X size={14} />
      </button>
    </div>
  );
}

/** The document's ⋯ menu: panels, export and reading width. */
export function DocumentTools({
  title,
  doc,
  editor,
  width,
  onWidth,
  onOutline,
  onLinks,
  onFind,
  children,
}: {
  title: string;
  doc: string;
  editor: Editor | null;
  width: number;
  onWidth: (width: number) => void;
  onOutline: () => void;
  onLinks: () => void;
  onFind: () => void;
  // Actions on the document itself, listed last. They get the menu's close function.
  children?: (close: () => void) => ReactNode;
}) {
  const serializer = useMemo(() => documentMarkdown(), []);
  const t = useT(),
    { toast } = useUI();
  const markdown = () =>
    (editor ? serializer.serialize(editor.getJSON()) : doc).replace(
      /\]\((\/api\/files\/[^)]+)\)/g,
      (_match, url) => `](${location.origin}${url})`,
    );
  async function print() {
    const source = editor?.view.dom;
    if (!source) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px";
    document.body.append(frame);
    const target = frame.contentDocument;
    if (!target) {
      frame.remove();
      toast(t("Could not prepare PDF. Retry."));
      return;
    }
    target.open();
    target.write(
      "<!doctype html><html><head><style>@page{margin:16mm}body{font:12pt/1.6 sans-serif;color:#111}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px}pre{white-space:pre-wrap}a{color:inherit}button,input,iframe,[data-doc-comment]{display:none}</style></head><body></body></html>",
    );
    target.close();
    target.title = title;
    const heading = target.createElement("h1");
    heading.textContent = title;
    target.body.append(heading);
    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("contenteditable");
    clone
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((box) => {
        const mark = target.createElement("span");
        mark.textContent = box.checked ? "☑ " : "☐ ";
        box.replaceWith(mark);
      });
    clone
      .querySelectorAll("[contenteditable]")
      .forEach((element) => element.removeAttribute("contenteditable"));
    clone.querySelectorAll("[data-page-embed]").forEach((element) => {
      const link = target.createElement("a");
      const id = element.getAttribute("data-page-embed");
      link.textContent = element.querySelector("[data-embed-title]")?.textContent ?? id;
      const workspace = location.pathname.split("/")[1];
      if (id) link.href = new URL(
        `/${workspace}/docs/${encodeURIComponent(id ?? "")}`,
        location.origin,
      ).href;
      element.replaceWith(link);
    });
    clone.querySelectorAll("a[href],img[src]").forEach((element) => {
      const attr = element.tagName === "IMG" ? "src" : "href";
      const value = element.getAttribute(attr);
      if (value?.startsWith("/"))
        element.setAttribute(attr, location.origin + value);
    });
    target.body.append(clone);
    await Promise.race([
      Promise.all(
        [...target.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.onload = resolve;
                image.onerror = resolve;
              }),
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  }
  const nearest = READING_WIDTHS.reduce((best, option) => (Math.abs(option.width - width) < Math.abs(best.width - width) ? option : best));
  return (
    <Menu
      width={230}
      align="right"
      triggerClassName="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text"
      trigger={
        <span aria-label={t("Document options")} title={t("Document options")} data-doc-options>
          <MoreHorizontal size={15} />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuItem onSelect={() => { close(); onOutline(); }}>
            <span data-doc-outline-toggle>{t("Outline")}</span>
          </MenuItem>
          <MenuItem onSelect={() => { close(); onLinks(); }}>
            <span data-doc-links-toggle>{t("Linked from")}</span>
          </MenuItem>
          <MenuItem onSelect={() => { close(); onFind(); }}>{t("Find in document")}</MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem
            onSelect={() => {
              close();
              void navigator.clipboard
                .writeText(markdown())
                .then(() => toast(t("Copied")))
                .catch(() => toast(t("Could not copy. Retry.")));
            }}
          >
            {t("Copy Markdown")}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              const url = URL.createObjectURL(
                new Blob([markdown()], {
                  type: "text/markdown;charset=utf-8",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `${title.replace(/[\\/:*?"<>|]/g, "-") || "document"}.md`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t("Export Markdown")}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              void print().catch(() =>
                toast(t("Could not prepare PDF. Retry.")),
              );
            }}
          >
            {t("Print / Save as PDF")}
          </MenuItem>
          <p className="px-2 py-1 text-caption text-faint">
            {t(
              "Current document only. Attachment links are kept; child documents are excluded.",
            )}
          </p>
          <div className="my-1 h-px bg-border" />
          <div className="px-2 pb-1 pt-1 text-caption text-faint">{t("Reading width")}</div>
          <div role="group" aria-label={t("Reading width")} className="mx-2 mb-1.5 flex rounded-md border border-border p-0.5">
            {READING_WIDTHS.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={option === nearest}
                onClick={() => onWidth(option.width)}
                className={`flex-1 rounded px-2 py-0.5 text-small transition-colors ${option === nearest ? "bg-elevated font-medium text-text" : "text-muted hover:text-text"}`}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          {children?.(close)}
        </>
      )}
    </Menu>
  );
}
