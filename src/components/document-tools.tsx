"use client";
import { documentMarkdown } from "@/lib/editor/document-markdown";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Menu, MenuItem } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
export function DocumentTools({
  title,
  doc,
  editor,
  width,
  onWidth,
}: {
  title: string;
  doc: string;
  editor: Editor | null;
  width: number;
  onWidth: (width: number) => void;
}) {
  const serializer = useMemo(() => documentMarkdown(), []);
  const t = useT(),
    { toast } = useUI();
  const [query, setQuery] = useState(""),
    [outline, setOutline] = useState<
      { title: string; level: number; pos: number }[]
    >([]),
    [matches, setMatches] = useState<{ from: number; to: number }[]>([]),
    [index, setIndex] = useState(0),
    [active, setActive] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const headings: { title: string; level: number; pos: number }[] = [],
        found: { from: number; to: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading")
          headings.push({
            title: node.textContent,
            level: node.attrs.level,
            pos,
          });
        if (query && node.isTextblock) {
          let text = "";
          const positions: number[] = [];
          node.descendants((child, offset) => {
            if (child.isText) {
              for (let at = 0; at < (child.text ?? "").length; at++) {
                text += child.text![at];
                positions.push(pos + 1 + offset + at);
              }
            }
          });
          const needle = query.toLocaleLowerCase();
          for (
            let at = 0;
            at + query.length <= text.length && found.length < 500;
            at++
          ) {
            if (
              text.slice(at, at + query.length).toLocaleLowerCase() !== needle
            )
              continue;
            if (positions[at] !== undefined)
              found.push({
                from: positions[at],
                to: positions[at + query.length - 1] + 1,
              });
            at += query.length - 1;
          }
        }
      });
      setOutline(headings);
      setMatches(found);
    };
    update();
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor, query, doc]);
  useEffect(() => {
    const scroller = root.current
      ?.closest("[data-document-root]")
      ?.querySelector("[data-document-scroll]");
    if (!scroller) return;
    const onScroll = () => {
      const top = scroller.getBoundingClientRect().top;
      const headings = [
        ...scroller.querySelectorAll(".tiptap h1,.tiptap h2,.tiptap h3"),
      ];
      let at = 0;
      for (const [index, heading] of headings.entries())
        if (heading.getBoundingClientRect().top < top + 120) at = index;
      setActive(at);
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [outline]);
  useEffect(()=>{CSS.highlights?.delete("document-find");return()=>{CSS.highlights?.delete("document-find");};},[query,editor]);
  function locate(from: number, to = from) {
    if (!editor) return;
    editor.commands.setTextSelection({ from, to });
    editor.commands.scrollIntoView();
    if(CSS.highlights&&typeof Highlight!=="undefined"&&to>from){const start=editor.view.domAtPos(from),end=editor.view.domAtPos(to);const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);CSS.highlights.set("document-find",new Highlight(range));}else editor.commands.focus();
  }
  function find(step: number) {
    if (!matches.length) return;
    const next = index<0?(step<0?matches.length-1:0):(index + step + matches.length) % matches.length;
    setIndex(next);
    locate(matches[next].from, matches[next].to);
  }
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
  return (
    <div
      ref={root}
      className="flex flex-wrap items-center gap-2 text-small text-muted"
    >
      <Menu trigger={t("Outline")} width={300}>
        {(close) => (
          <div className="max-h-80 overflow-auto p-1">
            {outline.length
              ? outline.map((heading, index) => (
                  <button
                    key={`${heading.pos}:${index}`}
                    onClick={() => {
                      locate(heading.pos + 1);
                      setActive(index);
                      close();
                    }}
                    aria-current={active === index ? "location" : undefined}
                    style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
                    className={`block w-full truncate py-1 text-left ${active === index ? "bg-elevated text-text" : ""}`}
                  >
                    {heading.title || t("Untitled")}
                  </button>
                ))
              : t("No headings yet.")}
          </div>
        )}
      </Menu>
      <Menu trigger={t("Find in document")} width={300}>
        {() => (
          <div className="space-y-2 p-2">
            <input
              aria-label={t("Find in document")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  find(e.shiftKey ? -1 : 1);
                }
              }}
              className="w-full rounded border border-border bg-bg p-1"
            />
            <div className="flex gap-3">
              <button disabled={!matches.length} onClick={() => find(-1)}>
                {t("Previous")}
              </button>
              <button disabled={!matches.length} onClick={() => find(1)}>
                {t("Next")}
              </button>
              <span>
                {matches.length ? Math.max(0, index + 1) : 0} / {matches.length}
                {matches.length === 500 ? "+" : ""}
              </span>
            </div>
          </div>
        )}
      </Menu>
      <Menu trigger={t("Document options")} width={280}>
        {(close) => (
          <>
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
            <label className="block px-2 py-1">
              {t("Reading width")}
              <input
                aria-label={t("Reading width")}
                type="range"
                min={560}
                max={1200}
                step={40}
                value={width}
                onChange={(e) => onWidth(Number(e.target.value))}
                className="block w-full"
              />
            </label>
          </>
        )}
      </Menu>
    </div>
  );
}
