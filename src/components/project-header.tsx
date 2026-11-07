"use client";

import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { ProjectIcon } from "@/components/icons";
import { Menu } from "@/components/menu";
import { WatchControl } from "@/components/watch-control";
import { useParams } from "next/navigation";
import { useT } from "@/components/i18n-context";

export type ProjectTab = "overview" | "issues" | "documents";

const TABS: { key: ProjectTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "issues", label: "Tasks" },
  { key: "documents", label: "Documents" },
];

// Same idea as a document's page icon: pick one emoji, or fall back to the cube.
const ICONS = [
  "🚀", "🧪", "🐟", "🌱", "📦", "🎯",
  "🧭", "💡", "🛠️", "🔬", "📊", "🎨",
  "🧬", "🏗️", "🗺️", "⚡", "🔥", "☕",
];

export function ProjectHeader({
  project,
  tab,
  issueCount,
  documentCount,
  favorite,
  canViewOverview,
  canPickIcon,
  onPickIcon,
  onTab,
  onToggleFavorite,
  meta,
  metaMenu,
}: {
  project: { id: string; name: string; color: string; icon: string | null };
  tab: ProjectTab;
  issueCount: number;
  documentCount: number;
  favorite: boolean;
  // Without a grant, the Overview pill is not shown at all — the document is private.
  canViewOverview: boolean;
  canPickIcon: boolean;
  onPickIcon: (icon: string | null) => void;
  onTab: (tab: ProjectTab) => void;
  onToggleFavorite: () => void;
  // Properties and Resources sit under the pills so the header reads top to bottom:
  // title, tabs, then what the project is made of.
  meta?: ReactNode;
  // Restores a row the reader folded away; only rendered while one is hidden.
  metaMenu?: ReactNode;
}) {
  const t = useT();
  const workspaceId = useParams<{ workspaceId: string }>().workspaceId;
  const mark = <ProjectIcon color={project.color} icon={project.icon} size={22} />;
  return (
    <header className="shrink-0 border-b border-border px-4 pb-3 pt-3">
      {/* Every header row hangs from the card's own gutter, so the pills and the
          properties line up under the icon rather than one column in. */}
      <div className="flex items-center gap-2.5">
        {canPickIcon ? (
          <Menu
            width={232}
            triggerClassName="shrink-0 rounded-md p-0.5 transition-colors hover:bg-elevated"
            trigger={<span title={t("Change icon")}>{mark}</span>}
          >
            {(close) => (
              <div className="p-1">
                <div className="grid grid-cols-6 gap-1">
                  {ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        close();
                        onPickIcon(emoji);
                      }}
                      className="rounded p-1 text-title transition-colors hover:bg-elevated"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                {project.icon && (
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      onPickIcon(null);
                    }}
                    className="mt-1 w-full rounded px-2 py-1.5 text-left text-small text-muted transition-colors hover:bg-elevated hover:text-text"
                  >
                    {t("Use the cube instead")}
                  </button>
                )}
              </div>
            )}
          </Menu>
        ) : (
          <span className="shrink-0 p-0.5">{mark}</span>
        )}
        <h1 className="truncate text-heading font-semibold tracking-tight">{project.name}</h1>
        <WatchControl workspaceId={workspaceId} scopeType="project" scopeId={project.id} compact />
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          title={favorite ? t("Remove from favorites") : t("Add to favorites")}
          aria-label={favorite ? t("Remove from favorites") : t("Add to favorites")}
          className={`shrink-0 rounded-md p-1 transition-colors hover:bg-elevated ${
            favorite ? "text-[#f5b21a]" : "text-faint hover:text-muted"
          }`}
        >
          <Star size={15} className={favorite ? "fill-[#f5b21a]" : ""} />
        </button>
      </div>
      <nav className="mt-2 flex items-center gap-1.5">
        {TABS.filter((item) => item.key !== "overview" || canViewOverview).map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTab(item.key)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-small transition-colors ${
                active
                  ? "border-transparent bg-elevated font-medium text-text"
                  : "border-border text-muted hover:border-border-strong hover:text-text"
              }`}
            >
              {t(item.label)}
              {item.key === "issues" && (
                <span className={active ? "text-muted" : "text-faint"}>{issueCount}</span>
              )}
              {item.key === "documents" && documentCount > 0 && (
                <span className={active ? "text-muted" : "text-faint"}>{documentCount}</span>
              )}
            </button>
          );
        })}
        {/* A folded properties row costs no height, so its way back lives here. */}
        {metaMenu && <div className="ml-auto">{metaMenu}</div>}
      </nav>
      {meta}
    </header>
  );
}
