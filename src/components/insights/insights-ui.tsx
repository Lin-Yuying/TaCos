"use client";

import type { ReactNode } from "react";

export const cardClass = "rounded-lg border border-border bg-bg";

export function Section({
  title,
  caption,
  testId,
  action,
  children,
}: {
  title: string;
  caption?: string;
  testId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cardClass} data-testid={testId}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-body font-semibold">{title}</h2>
        {caption ? <span className="text-caption text-faint">{caption}</span> : null}
        {action ? <div className="ml-auto flex items-center gap-1.5">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  caption,
  testId,
}: {
  label: string;
  value: string;
  caption?: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-border px-3.5 py-3" data-testid={testId}>
      <b className="text-heading font-semibold tabular-nums">{value}</b>
      <span className="text-small text-faint">{caption ? `${label} · ${caption}` : label}</span>
    </div>
  );
}

export function EmptyNote({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p className="py-3 text-small text-faint" data-testid={testId}>
      {children}
    </p>
  );
}
