"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useState, type ReactNode } from "react";

export const MODAL_HEAD = "flex items-center gap-2 px-4 pb-2.5 pt-3.5";
export const MODAL_TITLE = "min-w-0 flex-1 text-lead font-semibold";
export const MODAL_BODY = "flex flex-col gap-2.5 px-4 pb-3 text-body";
export const MODAL_FOOT = "flex justify-end gap-2 border-t border-border px-4 py-2.5";

// The design boards center overlays inside the workspace content column instead of the
// viewport, so the sidebar keeps its own visual weight. `main` is that column; pages
// without one (login, join, error pages) stay viewport-centered.
export function useContentColumnOffset(active: boolean) {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      const rect = document.querySelector("main")?.getBoundingClientRect();
      setOffset(
        rect && rect.width > 0 ? Math.round(rect.left + rect.width / 2 - window.innerWidth / 2) : 0,
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [active]);
  return offset;
}

export function Modal({ open, onClose, title, children, className = "max-w-[640px]", bare = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string; bare?: boolean;
}) {
  const offset = useContentColumnOffset(open);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-[rgba(13,13,13,.28)]" />
      <Dialog.Content aria-describedby={undefined} onEscapeKeyDown={(e) => e.stopPropagation()}
        style={{ left: `calc(50% + ${offset}px)` }}
        className={`fixed top-24 z-[70] max-h-[calc(100dvh-7rem)] w-[92vw] -translate-x-1/2 overflow-y-auto rounded-xl bg-bg shadow-[0_12px_40px_rgba(0,0,0,.18)] ${bare ? "" : "p-4"} ${className}`}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>{children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
