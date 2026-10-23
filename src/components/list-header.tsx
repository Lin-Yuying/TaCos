"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { LayoutToggle } from "@/components/issue-layout";
import { STATUS_META } from "@/lib/constants";
import type { Status } from "@/lib/constants";

type View = "all" | "active" | Status;

const TITLES: Record<string, string> = {
  all: "All Issues",
  active: "Active",
};
for (const status of ["in_progress", "todo", "done", "canceled"] as const) {
  TITLES[status] = STATUS_META[status].label;
}

export function ListHeader({
  view,
  q,
  label,
  count,
  projectParam,
  projectName,
  assigneeParam,
  assigneeName,
}: {
  view: View | string;
  q: string;
  label: string;
  count: number;
  projectParam?: string;
  projectName?: string;
  assigneeParam?: string;
  assigneeName?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(q);

  useEffect(() => setValue(q), [q]);

  const buildUrl = (over: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = {
      view: view === "all" ? undefined : view,
      q: q || undefined,
      label: label || undefined,
      project: projectParam || undefined,
      assignee: assigneeParam || undefined,
      ...over,
    };
    for (const [key, val] of Object.entries(merged)) {
      if (val) sp.set(key, val);
    }
    return `?${sp.toString()}`;
  };

  useEffect(() => {
    if (value === q) return;
    const timer = setTimeout(() => {
      router.replace(buildUrl({ q: value.trim() || undefined }), { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="min-w-[92px] text-[14px] font-semibold">{TITLES[view] ?? "Issues"}</h1>
      <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">{count}</span>
      {projectName && (
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          {projectName}
        </span>
      )}
      {assigneeParam && (
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          {assigneeParam === "me"
            ? "Assigned to me"
            : assigneeParam === "none"
              ? "Unassigned"
              : `Assigned to ${assigneeName ?? "member"}`}
        </span>
      )}
      {label && (
        <button
          type="button"
          onClick={() => router.replace(buildUrl({ label: undefined }), { scroll: false })}
          className="flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted hover:text-text"
        >
          label: {label} <X size={11} />
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <div className="flex w-60 items-center gap-2 rounded-md border border-border bg-elevated/50 px-2 py-1.5 focus-within:border-border-strong">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search issues…"
            className="w-full bg-transparent text-[13px] text-text placeholder:text-faint"
          />
          {value && (
            <button type="button" onClick={() => setValue("")} className="text-faint hover:text-muted">
              <X size={12} />
            </button>
          )}
        </div>
        <LayoutToggle />
      </div>
    </header>
  );
}
