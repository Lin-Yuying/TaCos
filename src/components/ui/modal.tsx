"use client";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export const MODAL_HEAD = "flex items-center gap-2 px-4 pb-2.5 pt-3.5";
export const MODAL_TITLE = "min-w-0 flex-1 text-lead font-semibold";
export const MODAL_BODY = "flex flex-col gap-2.5 px-4 pb-3 text-body";
export const MODAL_FOOT = "flex justify-end gap-2 border-t border-border px-4 py-2.5";

export function Modal({ open, onClose, title, children, className = "max-w-[640px]", bare = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string; bare?: boolean;
}) {
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-[rgba(13,13,13,.28)]" />
      <Dialog.Content aria-describedby={undefined} onEscapeKeyDown={(e) => e.stopPropagation()}
        className={`fixed left-1/2 top-24 z-[70] max-h-[calc(100dvh-7rem)] w-[92vw] -translate-x-1/2 overflow-y-auto rounded-xl bg-bg shadow-[0_12px_40px_rgba(0,0,0,.18)] ${bare ? "" : "p-4"} ${className}`}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>{children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
