"use client";

import { DebouncedInput } from "./ui/debounced-input";
import { Menu, MenuItem } from "@/components/menu";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { LayoutToggle } from "@/components/issue-layout";
import { STATUS_META } from "@/lib/constants";
import type { Status } from "@/lib/constants";
import { useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

type View = "all" | "active" | "open" | "agent" | "delegated" | Status;

const TITLES: Record<string, string> = {
  all: "All Tasks",
  active: "Active",
  open: "Open Tasks",
  agent: "Agent tasks",
  delegated: "Delegated tasks",
};
for (const status of ["in_progress", "todo", "done", "canceled"] as const) {
  TITLES[status] = STATUS_META[status].label;
}

// The three views that used to sit in the sidebar are quick filters in the header now;
// the sidebar keeps the four main queues (My Tasks, Open Tasks, All Tasks, Review).
const QUICK_VIEWS: {
  key: "all" | "active" | "unassigned" | "agent" | "delegated";
  label: string;
  overrides: Record<string, string | undefined>;
}[] = [
  { key: "all", label: "All Tasks", overrides: { view: undefined, assignee: undefined } },
  { key: "active", label: "Active", overrides: { view: "active", assignee: undefined } },
  { key: "unassigned", label: "Unassigned", overrides: { view: undefined, assignee: "none" } },
  { key: "agent", label: "Agent tasks", overrides: { view: "agent", assignee: undefined } },
  { key: "delegated", label: "Delegated tasks", overrides: { view: "delegated", assignee: undefined } },
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
  const { phoneTaskToolsOpen: toolsOpen, setPhoneTaskToolsOpen } = useUI();
  const [value, setValue] = useState(q);

  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    setValue(q);
  }

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
    delegated: view === "delegated",
  };

  return (
    <header className={`flex min-h-[52px] shrink-0 items-center gap-2 overflow-hidden border-b border-border ${PAGE_INSET} max-[600px]:min-h-11 max-[600px]:flex-wrap max-[600px]:py-2 max-[600px]:pl-3 max-[600px]:pr-3`}>
      {/* Shrinks last: the person's name and the count stay readable while the search
          field gives up width as the detail panel eats into the list. */}
      <h1 className="min-w-[72px] shrink-[0.25] truncate text-lead font-semibold max-[600px]:flex-1">{heading}</h1>
      <button
        type="button"
        onClick={() => setPhoneTaskToolsOpen(!toolsOpen)}
        aria-label={t("Filter")}
        aria-expanded={toolsOpen}
        title={t("Filter")}
        className={`hidden size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-elevated hover:text-text max-[600px]:flex ${toolsOpen ? "bg-elevated text-text" : "text-muted"}`}
      >
        <Filter size={15} />
      </button>
      {toolsOpen && <span aria-hidden="true" className="order-1 hidden basis-full max-[600px]:block" />}
      <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-caption text-muted max-[600px]:hidden">
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
      <div className={`shrink-0 @min-[640px]:hidden ${toolsOpen ? "max-[600px]:order-2" : "max-[600px]:hidden"}`}>
        <Menu
          width={200}
          trigger={<span className="text-small">{t("Views")}</span>}
          triggerClassName="flex h-7 shrink-0 items-center rounded-full border border-border bg-elevated/40 px-2 text-small text-muted transition-colors hover:text-text"
        >
          {(close) => (
            <>
              {QUICK_VIEWS.map((item) => (
                <MenuItem
                  key={item.key}
                  active={quickViewActive[item.key]}
                  onSelect={() => {
                    close();
                    router.replace(buildUrl(item.overrides), { scroll: false });
                  }}
                >
                  {t(item.label)}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
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
      <div className={`ml-auto flex min-w-0 shrink items-center gap-2 ${toolsOpen ? "max-[600px]:order-2" : "max-[600px]:hidden"}`}>
        <div className={`flex w-40 min-w-[56px] shrink items-center gap-2 rounded-full ${value || toolsOpen ? "" : "max-[600px]:hidden "} border border-border bg-elevated/50 px-3 py-1.5 focus-within:border-border-strong`}>
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
              onClick={() => {
                setValue("");
                router.replace(buildUrl({ q: undefined }), { scroll: false });
              }}
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
