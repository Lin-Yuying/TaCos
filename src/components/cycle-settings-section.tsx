"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT, useLocale } from "@/components/i18n-context";
import {
  CYCLE_COOLDOWN_RANGE,
  CYCLE_START_DAYS,
  CYCLE_UPCOMING_RANGE,
  CYCLE_WEEK_RANGE,
} from "@/lib/constants";
import type { CycleSettings, CycleSummary } from "@/lib/planning/cycles";
import { formatDayRange, todayDay } from "@/lib/planning/dates";
import { ProgressBar, quietButton, selectClass } from "@/components/planning-ui";
import { saveCycleSettingsAction } from "@/app/planning-actions";

/**
 * Settings › Cycles. One workspace-level configuration (plan decision 1). The form keeps
 * a local copy and writes the whole configuration at once; saving also runs the lazy
 * lifecycle so upcoming cycles appear immediately.
 */
export function CycleSettingsSection({
  workspaceId,
  settings,
  cycles,
  isAdmin,
}: {
  workspaceId: string;
  settings: CycleSettings;
  cycles: CycleSummary[];
  isAdmin: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [durationWeeks, setDurationWeeks] = useState(settings.durationWeeks);
  const [startDay, setStartDay] = useState(settings.startDay);
  const [cooldownWeeks, setCooldownWeeks] = useState(settings.cooldownWeeks);
  const [upcomingCount, setUpcomingCount] = useState(settings.upcomingCount);
  const [autoAdd, setAutoAdd] = useState(settings.autoAdd);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const today = todayDay();
  const preview = cycles
    .filter((cycle) => cycle.endsAt >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, Math.max(3, upcomingCount + 1));

  async function save() {
    setSaving(true);
    setError(null);
    const result = await saveCycleSettingsAction(workspaceId, {
      enabled,
      durationWeeks,
      startDay,
      cooldownWeeks,
      upcomingCount,
      autoAdd,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEnabled(result.data.enabled);
    setDurationWeeks(result.data.durationWeeks);
    setStartDay(result.data.startDay);
    setCooldownWeeks(result.data.cooldownWeeks);
    setUpcomingCount(result.data.upcomingCount);
    setAutoAdd(result.data.autoAdd);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-3" data-testid="cycle-settings">
      <div className="space-y-2.5">
        <div>
          <p className="text-small leading-relaxed text-faint">
            {t("Time-box work in a shared cycle. Upcoming cycles are created ahead of time; this server runs no background job, so the schedule is filled the next time someone opens Planning.")}
          </p>
        </div>
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!isAdmin}
            onChange={(event) => setEnabled(event.target.checked)}
            data-testid="cycle-settings-enabled"
          />
          {t("Enable cycles")}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1">
          <span className="block text-small font-medium text-muted">{t("Cycle length")}</span>
          <select
            value={durationWeeks}
            disabled={!isAdmin || !enabled}
            onChange={(event) => setDurationWeeks(Number(event.target.value))}
            className={`${selectClass} w-full disabled:opacity-50`}
            data-testid="cycle-duration"
          >
            {Array.from(
              { length: CYCLE_WEEK_RANGE.max - CYCLE_WEEK_RANGE.min + 1 },
              (_, index) => CYCLE_WEEK_RANGE.min + index
            ).map((weeks) => (
              <option key={weeks} value={weeks}>
                {t("{count} weeks", { count: weeks })}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-small font-medium text-muted">{t("Start day")}</span>
          <select
            value={startDay}
            disabled={!isAdmin || !enabled}
            onChange={(event) => setStartDay(Number(event.target.value))}
            className={`${selectClass} w-full disabled:opacity-50`}
            data-testid="cycle-start-day"
          >
            {CYCLE_START_DAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {t(day.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-small font-medium text-muted">{t("Cooldown")}</span>
          <select
            value={cooldownWeeks}
            disabled={!isAdmin || !enabled}
            onChange={(event) => setCooldownWeeks(Number(event.target.value))}
            className={`${selectClass} w-full disabled:opacity-50`}
            data-testid="cycle-cooldown"
          >
            {Array.from(
              { length: CYCLE_COOLDOWN_RANGE.max + 1 },
              (_, index) => index
            ).map((weeks) => (
              <option key={weeks} value={weeks}>
                {weeks === 0 ? t("None") : t("{count} weeks", { count: weeks })}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-small font-medium text-muted">{t("Upcoming cycles")}</span>
          <select
            value={upcomingCount}
            disabled={!isAdmin || !enabled}
            onChange={(event) => setUpcomingCount(Number(event.target.value))}
            className={`${selectClass} w-full disabled:opacity-50`}
            data-testid="cycle-upcoming"
          >
            {Array.from(
              { length: CYCLE_UPCOMING_RANGE.max + 1 },
              (_, index) => index
            ).map((count) => (
              <option key={count} value={count}>
                {count === 1 ? t("1 cycle") : t("{count} cycles", { count })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-start gap-2 text-body">
        <input
          type="checkbox"
          checked={autoAdd}
          disabled={!isAdmin || !enabled}
          onChange={(event) => setAutoAdd(event.target.checked)}
          className="mt-1"
          data-testid="cycle-auto-add"
        />
        <span>
          <span className="font-medium">{t("Add active tasks without a cycle to the current one")}</span>
          <span className="mt-0.5 block text-small text-muted">
            {t("Off by default: an opt-in never silently changes a plan. When on, todo and in-progress tasks that already exist join the current cycle. Done and canceled tasks never do.")}
          </span>
        </span>
      </label>

      {preview.length > 0 && (
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-1.5 text-small font-medium text-muted">
            {t("Scheduled cycles")}
          </div>
          <div className="divide-y divide-border">
            {preview.map((cycle) => (
              <Link
                key={cycle.id}
                href={`/${workspaceId}/planning?tab=cycles&cycle=${cycle.id}`}
                className="flex items-center gap-2 px-3 py-1.5 text-small hover:bg-elevated/50"
              >
                <span className="w-20 shrink-0 font-medium">{cycle.name}</span>
                <span className="shrink-0 text-faint">
                  {formatDayRange(cycle.startsAt, cycle.endsAt, locale)}
                </span>
                <ProgressBar percent={cycle.progress.percent} className="ml-auto max-w-[140px] flex-1" />
                <span className="w-10 shrink-0 text-right text-caption text-faint tabular-nums">
                  {cycle.progress.done}/{cycle.progress.total - cycle.progress.canceled}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            data-testid="cycle-save"
          >
            {saving ? t("Saving…") : t("Save cycles")}
          </button>
        ) : (
          <span className="text-small text-faint">{t("Only workspace admins can change cycle settings.")}</span>
        )}
        {enabled && (
          <Link href={`/${workspaceId}/planning?tab=cycles`} className={quietButton}>
            {t("Open Planning")}
          </Link>
        )}
        {saved && !saving && <span className="text-small text-muted">{t("Cycles saved.")}</span>}
        {error && (
          <span role="alert" className="text-small text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
