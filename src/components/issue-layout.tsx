"use client";

import { Columns3, List, Plus } from "lucide-react";
import { IssueBoard } from "@/components/issue-board";
import { IssueTable } from "@/components/issue-table";
import { useUI, type IssueLayout as Layout } from "@/components/ui-context";
import type { IssueWithLabels } from "@/lib/issues";

const LAYOUTS: { key: Layout; label: string; icon: typeof List }[] = [
  { key: "list", label: "List", icon: List },
  { key: "board", label: "Board", icon: Columns3 },
];

export function LayoutToggle() {
  const { layout, setLayout } = useUI();
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-elevated/50 p-0.5">
      {LAYOUTS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setLayout(key)}
          aria-pressed={layout === key}
          aria-label={label}
          title={label}
          className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
            layout === key
              ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
              : "text-muted hover:text-text"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function Empty() {
  const { setComposerOpen } = useUI();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="text-[15px] font-medium text-muted">No issues found</div>
      <div className="text-[13px] text-faint">
        Adjust your filters, or press{" "}
        <kbd className="rounded border border-border px-1 font-mono text-[11px]">C</kbd> to create
        one.
      </div>
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
      >
        <Plus size={13} /> New issue
      </button>
    </div>
  );
}

export function IssueLayout({ issues }: { issues: IssueWithLabels[] }) {
  const { layout } = useUI();
  if (issues.length === 0) return <Empty />;
  return layout === "board" ? <IssueBoard issues={issues} /> : <IssueTable issues={issues} />;
}
