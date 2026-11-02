"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function Menu({
  trigger,
  children,
  align = "left",
  width = 200,
  offset = 0,
  triggerClassName,
}: {
  // A function form lets a trigger react to the open state — the sidebar workspace
  // switcher uses it to sink the button and turn its chevron the way section headers do.
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  // Lets a panel ignore the padding its trigger sits inside, so it can line up with the
  // column instead of the trigger (the sidebar's Customize menu spans the whole sidebar).
  offset?: number;
  triggerClassName?: string | ((open: boolean) => string);
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Menus opened from a composer sit at the bottom of the window; without this the
  // panel renders past the viewport and gets clipped by the surrounding shell.
  const [dropUp, setDropUp] = useState(false);
  // A tall menu (the model catalogue) never fits below a composer, so the panel is also
  // capped to the space on the side it opens into.
  const [maxHeight, setMaxHeight] = useState<number | null>(null);
  // A right-aligned panel hangs its trigger on the right edge; when that trigger sits
  // near the left of the card that clips the panel (Resources with nothing in it yet),
  // the panel starts outside and comes back sliced. This slides it back inside.
  const [shiftX, setShiftX] = useState(0);

  const close = () => {
    setOpen(false);
    setDropUp(false);
    setMaxHeight(null);
    setShiftX(0);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const gap = 8;
    // A composer in the Agent empty state sits inside an overflow-y-auto column, which
    // clips the panel. Measure against the nearest clipping ancestor, not the viewport.
    let boundTop = 0;
    let boundBottom = window.innerHeight;
    for (let el = trigger.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowY === "visible") continue;
      const rect = el.getBoundingClientRect();
      boundTop = Math.max(boundTop, rect.top);
      boundBottom = Math.min(boundBottom, rect.bottom);
      break;
    }
    // Measure the content, not the clipped box: applying a cap must not feed back into
    // the choice of side, and scroll anchoring otherwise parks the panel mid-list.
    const content = panel.scrollHeight;
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = boundBottom - triggerRect.bottom - gap;
    const spaceAbove = triggerRect.top - boundTop - gap;
    const up = content > spaceBelow && spaceAbove > spaceBelow;
    setDropUp(up);
    setMaxHeight(Math.max(160, Math.min(content, up ? spaceAbove : spaceBelow)));
    panel.scrollTop = 0;

    // Same ancestor, horizontally: the card around a project is the usual clipping box.
    let boundLeft = 0;
    let boundRight = window.innerWidth;
    for (let el = trigger.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowX === "visible") continue;
      const rect = el.getBoundingClientRect();
      boundLeft = Math.max(boundLeft, rect.left);
      boundRight = Math.min(boundRight, rect.right);
      break;
    }
    const box = panel.getBoundingClientRect();
    const edge = 8;
    const shift =
      box.left < boundLeft + edge
        ? boundLeft + edge - box.left
        : box.right > boundRight - edge
          ? boundRight - edge - box.right
          : 0;
    setShiftX(Math.round(shift));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
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
        ref={triggerRef}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        className={
          (typeof triggerClassName === "function" ? triggerClassName(open) : triggerClassName) ??
          "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-text"
        }
      >
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`absolute z-50 overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/10 ${
            dropUp ? "bottom-full mb-1.5" : "mt-1.5"
          }`}
          style={{
            width,
            maxHeight: maxHeight ?? "calc(100dvh - 4rem)",
            overflowAnchor: "none",
            transform: shiftX ? `translateX(${shiftX}px)` : undefined,
            [align]: offset,
          }}
        >
          {children(close)}
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
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-elevated disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent ${
        danger ? "text-danger" : "text-text"
      }`}
    >
      {children}
      {active && <span className="ml-auto text-accent">✓</span>}
    </button>
  );
}
