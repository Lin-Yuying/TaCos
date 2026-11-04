"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { LayoutToggle } from "@/components/issue-layout";
import { STATUS_META } from "@/lib/constants";
import type { Status } from "@/lib/constants";
import { useT } from "@/components/i18n-context";

type View = "all" | "active" | "open" | Status;

const TITLES: Record<string, string> = {
  all: "All Tasks",
  active: "Active",
  open: "Open Tasks",
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
  const t = useT();
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

  // Filtering by a person is what the header is actually about, so it replaces the
  // generic "All Issues" title instead of adding a second chip next to it.
  const heading =
    view === "all" && assigneeParam
      ? assigneeParam === "none"
        ? t("Unassigned")
        : assigneeName
          ? t("{name}’s tasks", { name: assigneeName })
          : t("All Tasks")
      : t(TITLES[view] ?? "Tasks");

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-border pl-[52px] pr-10 lg:pr-20 xl:pr-32">
      {/* The title hangs from the same 52px column as the project page's "All tasks",
          so switching between the two lists doesn't shift the heading sideways. */}
      {/* Shrinks last: the person's name and the count stay readable while the search
          field gives up width as the detail panel eats into the list. */}
      <h1 className="min-w-0 shrink-[0.25] truncate text-[14px] font-semibold">{heading}</h1>
      <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
        {count}
      </span>
      {projectName && (
        <span className="hidden max-w-[140px] shrink-0 truncate rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted @min-[420px]:inline">
          {projectName}
        </span>
      )}
      {label && (
        <button
          type="button"
          onClick={() => router.replace(buildUrl({ label: undefined }), { scroll: false })}
          className="hidden max-w-[140px] shrink-0 items-center gap-1 truncate rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted hover:text-text @min-[420px]:flex"
        >
          {t("label: {label}", { label })} <X size={11} className="shrink-0" />
        </button>
      )}
      <div className="ml-auto flex min-w-0 shrink items-center gap-2">
        <div className="flex w-40 min-w-[56px] shrink items-center gap-2 rounded-full border border-border bg-elevated/50 px-3 py-1.5 focus-within:border-border-strong">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("Search tasks…")}
            className="min-w-0 w-full bg-transparent text-[13px] text-text placeholder:text-faint"
          />
          {value && (
            <button
              type="button"
              onClick={() => setValue("")}
              className="shrink-0 text-faint hover:text-muted"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <LayoutToggle />
      </div>
    </header>
  );
}
