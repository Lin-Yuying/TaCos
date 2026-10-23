"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Menu({
  trigger,
  children,
  align = "left",
  width = 200,
  triggerClassName,
}: {
  // A function form lets a trigger react to the open state — the sidebar workspace
  // switcher uses it to sink the button and turn its chevron the way section headers do.
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  triggerClassName?: string | ((open: boolean) => string);
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          (typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName) ??
          "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-text"
        }
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1.5 overflow-hidden rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/10"
          style={{ width, [align]: 0 }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  active,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-elevated ${
        danger ? "text-danger" : "text-text"
      }`}
    >
      {children}
      {active && <span className="ml-auto text-accent">✓</span>}
    </button>
  );
}
