"use client";

import type { ReactNode } from "react";
import { PRIORITY_META, type Priority } from "@/lib/constants";
import { useT } from "@/components/i18n-context";

/** Shared planning glyphs: one progress bar and one colour pill everywhere. */
export function ProgressBar({
  percent,
  className = "",
}: {
  percent: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 overflow-hidden rounded-full bg-elevated ${className}`}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function Pill({
  color,
  children,
  dataTestId,
}: {
  color?: string;
  children: ReactNode;
  dataTestId?: string;
}) {
  return (
    <span
      data-testid={dataTestId}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-caption"
      style={
        color
          ? {
              borderColor: `${color}55`,
              backgroundColor: `${color}14`,
              color,
            }
          : undefined
      }
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}

export function PriorityText({ priority }: { priority: Priority }) {
  const t = useT();
  if (priority === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-caption text-faint">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: PRIORITY_META[priority].color }}
      />
      {t(PRIORITY_META[priority].label)}
    </span>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-small font-medium text-muted">{children}</span>;
}

export const inputClass =
  "w-full rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text placeholder:text-faint focus:border-border-strong";
export const selectClass =
  "rounded-md border border-border bg-bg px-2 py-1.5 text-body text-text";
export const primaryButton =
  "rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
export const quietButton =
  "rounded-md border border-border px-2.5 py-1.5 text-body text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50";
