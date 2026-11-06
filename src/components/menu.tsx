"use client";

import { useState, type ReactNode } from "react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";

export function Menu({ trigger, children, align = "left", width = 200, offset = 0, triggerClassName, className, onOpenChange }: {
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: (close: () => void) => ReactNode;
  align?: "left" | "right"; width?: number; offset?: number;
  triggerClassName?: string | ((open: boolean) => string); className?: string; onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Dropdown.Root open={open} onOpenChange={(next) => {setOpen(next);onOpenChange?.(next);}} modal={false}>
    <span className={className}>
      <Dropdown.Trigger asChild><button type="button" className={(typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName) ?? "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-body text-muted hover:border-border-strong hover:text-text"}>
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button></Dropdown.Trigger>
    </span>
    <Dropdown.Portal><Dropdown.Content align={align === "left" ? "start" : "end"} alignOffset={offset} sideOffset={6} collisionPadding={8}
      onKeyDown={(e)=>{if(e.key!=="Escape"&&(e.target as HTMLElement).closest("input,textarea,[contenteditable=true]"))e.stopPropagation();}}
      onEscapeKeyDown={(e) => e.stopPropagation()}
      style={{ width, maxHeight: "var(--radix-dropdown-menu-content-available-height)" }}
      className="z-[80] overflow-y-auto rounded-lg border border-border bg-overlay p-1 text-body shadow-xl">
      {children(() => setOpen(false))}
    </Dropdown.Content></Dropdown.Portal>
  </Dropdown.Root>;
}

export function MenuItem({ children, onSelect, active, danger, disabled }: {
  children: ReactNode; onSelect: () => void; active?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return <Dropdown.Item disabled={disabled} onSelect={(e) => { e.preventDefault(); onSelect(); }}
    className={`flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-body outline-none data-[highlighted]:bg-elevated data-[disabled]:text-faint ${danger ? "text-danger" : "text-text"}`}>
    {children}{active && <span className="ml-auto text-accent">✓</span>}
  </Dropdown.Item>;
}
