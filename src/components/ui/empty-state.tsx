import type { ReactNode } from "react";

// The one shape for "nothing here": a title, what to do next, and at most a couple of actions.
export function EmptyState({ title, hint, children, className = "flex-1" }: {
  title: ReactNode; hint?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-5 py-12 text-center ${className}`}>
      <h3 className="text-lead font-semibold text-text">{title}</h3>
      {hint && <p className="max-w-[420px] text-small leading-relaxed text-muted">{hint}</p>}
      {children && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}
