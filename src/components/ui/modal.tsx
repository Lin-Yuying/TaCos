"use client";
import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

export function Modal({ open, onClose, title, children, className = "max-w-[640px]" }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string;
}) {
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
      <Dialog.Content aria-describedby={undefined} onEscapeKeyDown={(e) => e.stopPropagation()}
        className={`fixed left-1/2 top-1/2 z-[70] max-h-[90dvh] w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-overlay p-4 shadow-2xl ${className}`}>
        <Dialog.Title className="sr-only">{title}</Dialog.Title>{children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
