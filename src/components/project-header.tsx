"use client";

import { Star } from "lucide-react";
import { ProjectIcon } from "@/components/icons";

export type ProjectTab = "overview" | "issues";

const TABS: { key: ProjectTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "issues", label: "Issues" },
];

export function ProjectHeader({
  project,
  tab,
  issueCount,
  favorite,
  onTab,
  onToggleFavorite,
}: {
  project: { name: string; color: string };
  tab: ProjectTab;
  issueCount: number;
  favorite: boolean;
  onTab: (tab: ProjectTab) => void;
  onToggleFavorite: () => void;
}) {
  return (
    <header className="shrink-0 border-b border-border px-4 pb-2 pt-3">
      <div className="flex items-center gap-2.5">
        <ProjectIcon color={project.color} size={22} />
        <h1 className="truncate text-[20px] font-semibold tracking-tight">{project.name}</h1>
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          className={`shrink-0 rounded-md p-1 transition-colors hover:bg-elevated ${
            favorite ? "text-[#f5b21a]" : "text-faint hover:text-muted"
          }`}
        >
          <Star size={15} className={favorite ? "fill-[#f5b21a]" : ""} />
        </button>
      </div>
      <nav className="mt-2 flex items-center gap-1.5">
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTab(item.key)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                active
                  ? "border-transparent bg-elevated font-medium text-text"
                  : "border-border text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              {item.label}
              {item.key === "issues" && (
                <span className={active ? "text-muted" : "text-faint"}>{issueCount}</span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
