"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarRange, List, Target } from "lucide-react";
import { ProjectIcon } from "@/components/icons";
import { useT, useLocale } from "@/components/i18n-context";
import { INITIATIVE_STATUS_META } from "@/lib/constants";
import type { RoadmapGroup, RoadmapMilestone } from "@/lib/planning/initiatives";
import {
  addMonths,
  addQuarters,
  formatDay,
  monthKey,
  monthLabel,
  quarterKey,
  quarterLabel,
  todayDay,
} from "@/lib/planning/dates";
import { Pill, ProgressBar } from "@/components/planning-ui";

type Zoom = "month" | "quarter";
type Mode = "timeline" | "list";

/**
 * The roadmap is list/timeline only (plan decision 6): no drag scheduling, no project
 * bars. Milestones are the dated objects, so they are what lands in a month or quarter
 * column; an initiative's target date sits in its group header.
 */
export function PlanningRoadmap({
  workspaceId,
  groups,
}: {
  workspaceId: string;
  groups: RoadmapGroup[];
}) {
  const t = useT();
  const locale = useLocale();
  const [zoom, setZoom] = useState<Zoom>("month");
  const [mode, setMode] = useState<Mode>("timeline");
  const today = todayDay();
  const columns =
    zoom === "month"
      ? Array.from({ length: 8 }, (_, index) => addMonths(monthKey(today), index - 1))
      : Array.from({ length: 6 }, (_, index) => addQuarters(quarterKey(today), index - 1));
  const columnLabel = (column: string) =>
    zoom === "month" ? monthLabel(column, locale) : quarterLabel(column, locale);
  const columnOf = (day: string) => (zoom === "month" ? monthKey(day) : quarterKey(day));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body text-muted">
          {t("Projects and their milestones by target date, grouped by initiative.")}
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-elevated/50 p-0.5" role="group" aria-label={t("Roadmap scale")}>
            {(["month", "quarter"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={zoom === value}
                data-testid={`roadmap-zoom-${value}`}
                onClick={() => setZoom(value)}
                className={`rounded-md px-2.5 py-1 text-small transition-colors ${
                  zoom === value ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-text"
                }`}
              >
                {t(value === "month" ? "Month" : "Quarter")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-elevated/50 p-0.5" role="group" aria-label={t("Roadmap view")}>
            {(["timeline", "list"] as const).map((value) => {
              const Icon = value === "timeline" ? CalendarRange : List;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  aria-label={t(value === "timeline" ? "Timeline" : "List")}
                  title={t(value === "timeline" ? "Timeline" : "List")}
                  data-testid={`roadmap-mode-${value}`}
                  onClick={() => setMode(value)}
                  className={`flex h-7 w-8 items-center justify-center rounded-full transition-colors ${
                    mode === value ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-muted hover:text-text"
                  }`}
                >
                  <Icon size={13} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-body text-faint" data-testid="roadmap-empty">
          {t("No projects yet. Create a project, then group it under an initiative.")}
        </div>
      ) : mode === "timeline" ? (
        <div className="overflow-x-auto rounded-lg border border-border" data-testid="roadmap-timeline">
          <div className="min-w-[680px]">
            <div
              className="grid border-b border-border bg-surface text-caption text-faint"
              style={{
                gridTemplateColumns: `160px repeat(${columns.length}, minmax(${zoom === "month" ? "64px" : "84px"}, 1fr))`,
              }}
            >
              <div className="px-3 py-2">{t("Project")}</div>
              {columns.map((column) => (
                <div key={column} className="border-l border-border px-2 py-2">
                  {columnLabel(column)}
                </div>
              ))}
            </div>
            {groups.map((group) => (
              <section key={group.initiative?.id ?? "none"} data-testid="roadmap-group">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-elevated/40 px-3 py-2">
                  <span className="text-body font-semibold">
                    {group.initiative?.name ?? t("No initiative")}
                  </span>
                  {group.initiative && (
                    <>
                      <Pill color={INITIATIVE_STATUS_META[group.initiative.status].color}>
                        {t(INITIATIVE_STATUS_META[group.initiative.status].label)}
                      </Pill>
                      {group.initiative.targetDate && (
                        <span className="inline-flex items-center gap-1 text-caption text-faint">
                          <Target size={11} /> {formatDay(group.initiative.targetDate, locale)}
                        </span>
                      )}
                      <span className="text-caption text-faint tabular-nums">
                        {group.initiative.progress.percent}%
                      </span>
                      <ProgressBar
                        percent={group.initiative.progress.percent}
                        className="w-24"
                      />
                    </>
                  )}
                </div>
                {group.projects.length === 0 ? (
                  <div className="border-b border-border px-4 py-3 text-small text-faint">
                    {t("No projects linked to this initiative.")}
                  </div>
                ) : (
                  group.projects.map((project) => (
                    <div
                      key={project.id}
                      data-testid="roadmap-project-row"
                      className="grid border-b border-border last:border-b-0"
                      style={{
                        gridTemplateColumns: `160px repeat(${columns.length}, minmax(${zoom === "month" ? "64px" : "84px"}, 1fr))`,
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <ProjectIcon color={project.color} icon={project.icon} size={13} />
                        <Link
                          href={`/${workspaceId}/projects/${project.id}?tab=timeline`}
                          className="truncate text-body hover:underline"
                        >
                          {project.name}
                        </Link>
                        <span className="ml-auto shrink-0 text-caption text-faint tabular-nums">
                          {project.progress.percent}%
                        </span>
                      </div>
                      {columns.map((column) => {
                        const markers = project.milestones.filter(
                          (milestone) =>
                            milestone.targetDate && columnOf(milestone.targetDate) === column
                        );
                        return (
                          <div key={column} className="border-l border-border px-1.5 py-1.5">
                            {markers.map((milestone) => (
                              <MilestoneChip
                                key={milestone.id}
                                workspaceId={workspaceId}
                                projectId={project.id}
                                milestone={milestone}
                                locale={locale}
                                t={t}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="roadmap-list">
          {groups.map((group) => (
            <section
              key={group.initiative?.id ?? "none"}
              data-testid="roadmap-group"
              className="rounded-lg border border-border"
            >
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <Target size={13} className="text-faint" />
                <span className="text-body font-semibold">
                  {group.initiative?.name ?? t("No initiative")}
                </span>
                {group.initiative && (
                  <>
                    <Pill color={INITIATIVE_STATUS_META[group.initiative.status].color}>
                      {t(INITIATIVE_STATUS_META[group.initiative.status].label)}
                    </Pill>
                    {group.initiative.targetDate && (
                      <span className="text-caption text-faint">
                        {t("Target {date}", { date: formatDay(group.initiative.targetDate, locale) })}
                      </span>
                    )}
                    <span className="ml-auto text-small text-faint tabular-nums">
                      {t("{done} of {total} tasks", {
                        done: group.initiative.progress.done,
                        total: group.initiative.progress.total,
                      })}
                    </span>
                  </>
                )}
              </div>
              {group.projects.length === 0 ? (
                <p className="px-4 py-3 text-small text-faint">
                  {t("No projects linked to this initiative.")}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {group.projects.map((project) => (
                    <div key={project.id} data-testid="roadmap-project-row" className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProjectIcon color={project.color} icon={project.icon} size={13} />
                        <Link
                          href={`/${workspaceId}/projects/${project.id}?tab=timeline`}
                          className="text-body hover:underline"
                        >
                          {project.name}
                        </Link>
                        <span className="ml-auto text-caption text-faint tabular-nums">
                          {t("{done}/{total} done", {
                            done: project.progress.done,
                            total: project.progress.total,
                          })}
                        </span>
                      </div>
                      {project.milestones.length === 0 ? (
                        <p className="mt-1 pl-5 text-caption text-faint">{t("No milestones with dates.")}</p>
                      ) : (
                        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
                          {[...project.milestones]
                            .sort((a, b) =>
                              (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31")
                            )
                            .map((milestone) => (
                              <MilestoneChip
                                key={milestone.id}
                                workspaceId={workspaceId}
                                projectId={project.id}
                                milestone={milestone}
                                locale={locale}
                                t={t}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      <p className="text-caption text-faint">
        {t("Dates move by editing the milestone target in the project's Timeline tab. The roadmap does not schedule by drag.")}
      </p>
    </div>
  );
}

function MilestoneChip({
  workspaceId,
  projectId,
  milestone,
  locale,
  t,
}: {
  workspaceId: string;
  projectId: string;
  milestone: RoadmapMilestone;
  locale: "en" | "zh";
  t: (text: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <Link
      href={`/${workspaceId}/projects/${projectId}?tab=timeline`}
      data-testid="roadmap-milestone"
      title={
        milestone.targetDate
          ? t("{name} · {date}", { name: milestone.name, date: formatDay(milestone.targetDate, locale) })
          : milestone.name
      }
      className="mb-1 flex min-w-0 items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 text-caption transition-colors hover:border-border-strong"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="truncate">{milestone.name}</span>
      {milestone.targetDate && (
        <span className="shrink-0 text-faint">{formatDay(milestone.targetDate, locale)}</span>
      )}
      <span className="shrink-0 text-faint tabular-nums">
        {milestone.done}/{milestone.total}
      </span>
    </Link>
  );
}

