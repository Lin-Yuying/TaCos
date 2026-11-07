"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ListTree, X } from "lucide-react";
import { SidePanel } from "@/components/ui/side-panel";
import type { DocHeading } from "@/lib/doc-outline";
import { useT } from "@/components/i18n-context";

/** The reader's outline: jump within the document, and copy a link to one heading. */
export function DocOutlinePanel({
  headings,
  title,
  compact,
  linkBase,
  onSelect,
  onSelectTitle,
  onClose,
}: {
  headings: DocHeading[];
  // The page title is the outline's first entry: it is the document's top level.
  title: string;
  compact: boolean;
  // Canonical path of the document, without a query string.
  linkBase: string;
  onSelect: (id: string) => void;
  onSelectTitle: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  // -1 is the page title, 0..n-1 the document headings.
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const scroller = root.current?.closest("[data-document-root]")?.querySelector("[data-document-scroll]");
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = scroller.getBoundingClientRect().top + 120;
        let current = -1;
        if (scroller.scrollTop > 4)
          scroller.querySelectorAll(".tiptap h1,.tiptap h2,.tiptap h3").forEach((heading, index) => {
            if (heading.getBoundingClientRect().top <= top) current = index;
          });
        setActive(current);
      });
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [headings]);

  function copy(id: string) {
    const href = `${window.location.origin}${linkBase}?heading=${encodeURIComponent(id)}`;
    void navigator.clipboard?.writeText(href).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1200);
    }).catch(() => {});
  }

  return (
    <SidePanel name="document-outline" compact={compact}>
      <aside
        ref={root}
        data-doc-outline
        className={`flex min-h-0 flex-col border-l border-border bg-bg ${
          compact ? "w-full border-l-0" : "w-full shrink-0"
        }`}
      >
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3 text-body font-medium text-text">
          <ListTree size={13} />
          {t("Outline")}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close outline")}
            title={t("Close outline")}
            className="ml-auto rounded p-1 text-muted hover:bg-elevated hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            data-outline-title
            onClick={onSelectTitle}
            title={title}
            aria-current={active === -1 ? "location" : undefined}
            style={{ paddingLeft: 8 }}
            className={`min-w-0 w-full truncate rounded-md px-1 py-1.5 text-left text-body transition-colors hover:bg-elevated/60 hover:text-text ${active === -1 && headings.length > 0 ? "bg-elevated text-text" : "text-text"}`}
          >
            {title}
          </button>
          {headings.length === 0 ? (
            <p className="p-2 text-small text-faint">{t("Add a heading with # to build an outline.")}</p>
          ) : (
            headings.map((heading, index) => (
              <div key={heading.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  data-outline-item={heading.id}
                  onClick={() => onSelect(heading.id)}
                  style={{ paddingLeft: 8 + Math.max(0, heading.level - 1) * 10 }}
                  title={heading.text}
                  aria-current={active === index + 1 ? "location" : undefined}
                  className={`min-w-0 flex-1 truncate rounded-md px-1 py-1.5 text-left text-body transition-colors hover:bg-elevated/60 hover:text-text ${active === index + 1 ? "bg-elevated text-text" : "text-muted"}`}
                >
                  {heading.text || t("Untitled")}
                </button>
                <button
                  type="button"
                  data-outline-copy={heading.id}
                  onClick={() => copy(heading.id)}
                  aria-label={t("Copy link to {title}", { title: heading.text })}
                  title={t("Copy link to heading")}
                  className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {copied === heading.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            ))
          )}
        </div>
      </aside>
    </SidePanel>
  );
}
