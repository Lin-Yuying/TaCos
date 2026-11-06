"use client";

import { DebouncedInput } from "./ui/debounced-input";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { LayoutToggle } from "@/components/issue-layout";
import { STATUS_META } from "@/lib/constants";
import type { Status } from "@/lib/constants";
import { useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

type View = "all" | "active" | "open" | "agent" | Status;

const TITLES: Record<string, string> = {
  all: "All Tasks",
  active: "Active",
  open: "Open Tasks",
  agent: "Agent tasks",
};
for (const status of ["in_progress", "todo", "done", "canceled"] as const) {
  TITLES[status] = STATUS_META[status].label;
}

// The three views that used to sit in the sidebar are quick filters in the header now;
// the sidebar keeps the four main queues (My Tasks, Open Tasks, All Tasks, Review).
const QUICK_VIEWS: {
  key: "all" | "active" | "unassigned" | "agent";
  label: string;
  overrides: Record<string, string | undefined>;
}[] = [
  { key: "all", label: "All Tasks", overrides: { view: undefined, assignee: undefined } },
  { key: "active", label: "Active", overrides: { view: "active", assignee: undefined } },
  { key: "unassigned", label: "Unassigned", overrides: { view: undefined, assignee: "none" } },
  { key: "agent", label: "Agent tasks", overrides: { view: "agent", assignee: undefined } },
];

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

  // Filtering by a person is what the header is actually about, so it replaces the
  // generic "All Issues" title instead of adding a second chip next to it.
  const heading =
    view === "all" && assigneeParam
      ? assigneeParam === "none"
        ? t("Unassigned")
        : assigneeParam === "me"
          ? t("My Tasks")
          : assigneeName
            ? t("{name}’s tasks", { name: assigneeName })
            : t("All Tasks")
      : t(TITLES[view] ?? "Tasks");
  const quickViewActive: Record<(typeof QUICK_VIEWS)[number]["key"], boolean> = {
    all: view === "all" && !assigneeParam,
    active: view === "active",
    unassigned: view === "all" && assigneeParam === "none",
    agent: view === "agent",
  };

  return (
    <header className={`flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-border ${PAGE_INSET}`}>
      {/* The title hangs from the same 52px column as the project page's "All tasks",
          so switching between the two lists doesn't shift the heading sideways. */}
      {/* Shrinks last: the person's name and the count stay readable while the search
          field gives up width as the detail panel eats into the list. */}
      <h1 className="min-w-[72px] shrink-[0.25] truncate text-body font-semibold">{heading}</h1>
      <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
        {count}
      </span>
      <div
        data-task-quick-views
        className="hidden shrink-0 items-center gap-0.5 rounded-full border border-border bg-elevated/40 p-0.5 @min-[640px]:flex"
      >
        {QUICK_VIEWS.map((item) => {
          const on = quickViewActive[item.key];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => router.replace(buildUrl(item.overrides), { scroll: false })}
              aria-pressed={on}
              className={`flex h-6 items-center rounded-full px-2 text-small transition-colors ${
                on
                  ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-muted hover:text-text"
              }`}
            >
              {t(item.label)}
            </button>
          );
        })}
      </div>
      {projectName && (
        <span className="hidden max-w-[140px] shrink-0 truncate rounded-full bg-elevated px-2 py-0.5 text-caption text-muted @min-[420px]:inline">
          {projectName}
        </span>
      )}
      {label && (
        <button
          type="button"
          onClick={() => router.replace(buildUrl({ label: undefined }), { scroll: false })}
          className="hidden max-w-[140px] shrink-0 items-center gap-1 truncate rounded-full bg-elevated px-2 py-0.5 text-caption text-muted hover:text-text @min-[420px]:flex"
        >
          {t("label: {label}", { label })} <X size={11} className="shrink-0" />
        </button>
      )}
      <div className="ml-auto flex min-w-0 shrink items-center gap-2">
        <div className="flex w-40 min-w-[56px] shrink items-center gap-2 rounded-full border border-border bg-elevated/50 px-3 py-1.5 focus-within:border-border-strong">
          <Search size={13} className="shrink-0 text-faint" />
          <DebouncedInput
            value={value}
            onCommit={(value)=>{setValue(value);router.replace(buildUrl({q:value.trim()||undefined}),{scroll:false});}}
            placeholder={t("Search tasks…")}
            className="min-w-0 w-full bg-transparent text-body text-text placeholder:text-faint"
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
