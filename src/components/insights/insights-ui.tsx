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
    <div className="rounded-lg border border-border px-3 py-2.5" data-testid={testId}>
      <div className="text-caption uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className="mt-0.5 font-variant-numeric tabular-nums text-title">{value}</div>
      {caption ? <div className="mt-0.5 text-caption text-faint">{caption}</div> : null}
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
