"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutList } from "lucide-react";
import { listTaskViewsAction } from "@/app/task-view-actions";
import type { TaskViewSummary } from "@/lib/task-views";
import { useT } from "@/components/i18n-context";

/**
 * The shared workspace views in the sidebar. Personal views stay in the list menu:
 * the sidebar shows what the team can open, not one person's scratch filters.
 */
export function WorkspaceViews({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const [views, setViews] = useState<TaskViewSummary[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void listTaskViewsAction(workspaceId, { scope: "workspace", sharedOnly: true })
      .then((result) => {
        if (live && result.ok) setViews(result.data);
      })
      .catch(() => setViews([]));
    return () => {
      live = false;
    };
  }, [workspaceId, attempt]);

  // A view created in the list menu must appear here without a full reload.
  useEffect(() => {
    const refresh = () => setAttempt((current) => current + 1);
    window.addEventListener("tacos:task-views-changed", refresh);
    return () => window.removeEventListener("tacos:task-views-changed", refresh);
  }, []);

  if (views.length === 0) return null;
  const activeId = params.get("viewId");
  return (
    <div data-workspace-views className="space-y-0.5" aria-label={t("Shared views")}>
      {views.map((view) => {
        const active =
          pathname === `/${workspaceId}` && activeId === view.id;
        return (
          <Link
            key={view.id}
            href={`/${workspaceId}?viewId=${view.id}`}
            aria-current={active ? "page" : undefined}
            data-workspace-view={view.name}
            className={`flex items-center gap-2 rounded-md px-2 py-1 transition-colors ${
              active
                ? "bg-elevated font-medium text-text"
                : "text-muted hover:bg-elevated/60 hover:text-text"
            }`}
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-faint">
              <LayoutList size={13} />
            </span>
            <span className="truncate">{view.name}</span>
            {view.isDefault ? (
              <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap ml-auto shrink-0 border border-border text-caption text-faint">
                {t("Default")}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
