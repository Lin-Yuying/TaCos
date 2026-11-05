"use client";

import { useState } from "react";
import { Bell, CalendarDays, X } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { ViaBadge } from "@/components/icons";
import { REMINDER_META, REMINDER_PRESETS } from "@/lib/constants";
import { dueDateLabel, fullTimestamp, shortDate } from "./format";
import {
  MONTH_NAMES,
  dateParts,
  daysInMonth,
  defaultDueDate,
  isoDate,
  todayValue,
} from "./due-date";
import type { FlatDetail, IssueUpdate } from "./types";
import { useLocale, useT } from "@/components/i18n-context";

export function DueRow({ detail, onUpdate }: { detail: FlatDetail; onUpdate: IssueUpdate }) {
  const t = useT();
  const locale = useLocale();
  const [dueDraft, setDueDraft] = useState<string | null>(null);

  const today = todayValue();
  const overdue =
    Boolean(detail.dueDate) &&
    detail.dueDate! < today &&
    detail.status !== "done" &&
    detail.status !== "canceled";
  const dueValue = dueDraft ?? detail.dueDate ?? defaultDueDate(detail.createdAt);
  const due = dateParts(dueValue);
  const thisYear = new Date().getFullYear();
  const firstYear = Math.min(new Date(detail.createdAt).getFullYear(), thisYear - 1);
  const dueYears = Array.from({ length: 8 }, (_, i) => firstYear + i);

  function pickDue(part: "year" | "month" | "day", raw: number) {
    const year = part === "year" ? raw : due.year;
    const month = part === "month" ? raw : due.month;
    const day = part === "day" ? raw : Math.min(due.day, daysInMonth(year, month));
    const value = isoDate(year, month, Math.min(day, daysInMonth(year, month)));
    setDueDraft(value);
    void onUpdate({ dueDate: value });
  }

  return (
    <div className="-mx-2 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-small text-faint">
      <div className="flex items-center gap-1.5 whitespace-nowrap pl-2">
        <ViaBadge via={detail.createdVia} />
        <span title={fullTimestamp(detail.createdAt, locale)}>
          {t("Created {date}", { date: shortDate(detail.createdAt, locale) })}
        </span>
        <span aria-hidden>·</span>
        <span title={fullTimestamp(detail.updatedAt, locale)}>
          {t("Updated {date}", { date: shortDate(detail.updatedAt, locale) })}
        </span>
      </div>

      <div className="relative flex items-center gap-0.5">
        <Menu
          width={252}
          triggerClassName={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-small transition-colors hover:border-border-strong hover:text-text ${
            detail.dueDate ? "border-border text-text" : "border-dashed border-border text-faint"
          }`}
          trigger={
            <>
              <CalendarDays
                size={13}
                className={overdue ? "text-danger" : detail.dueDate ? "text-accent" : "text-faint"}
              />
              <span className={overdue ? "text-danger" : ""}>
                {detail.dueDate ? dueDateLabel(detail.dueDate, locale) : t("Due date")}
              </span>
            </>
          }
        >
          {() => (
            <div className="flex items-center gap-1.5 p-1">
              <select
                aria-label={t("Due year")}
                value={due.year}
                onChange={(event) => pickDue("year", Number(event.target.value))}
                className="h-7 flex-1 rounded-md border border-border bg-bg px-1.5 text-small text-text focus:border-border-strong focus:outline-none"
              >
                {dueYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("Due month")}
                value={due.month}
                onChange={(event) => pickDue("month", Number(event.target.value))}
                className="h-7 flex-1 rounded-md border border-border bg-bg px-1.5 text-small text-text focus:border-border-strong focus:outline-none"
              >
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {locale === "zh" ? `${index + 1}月` : name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("Due day")}
                value={due.day}
                onChange={(event) => pickDue("day", Number(event.target.value))}
                className="h-7 w-16 rounded-md border border-border bg-bg px-1.5 text-small text-text focus:border-border-strong focus:outline-none"
              >
                {Array.from({ length: daysInMonth(due.year, due.month) }, (_, i) => i + 1).map(
                  (day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  )
                )}
              </select>
            </div>
          )}
        </Menu>
        {detail.dueDate && (
          <button
            type="button"
            onClick={() => {
              setDueDraft(null);
              void onUpdate({ dueDate: null });
            }}
            aria-label={t("Clear due date")}
            title={t("Clear due date")}
            className="rounded p-0.5 text-faint transition-colors hover:text-danger"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {detail.dueDate && (
        <Menu
          width={180}
          triggerClassName="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
          trigger={
            <>
              <Bell size={12} className={detail.reminder ? "text-accent" : "text-faint"} />
              {detail.reminder ? t(REMINDER_META[detail.reminder].label) : t("Remind me")}
            </>
          }
        >
          {(close) => (
            <>
              <MenuItem
                active={!detail.reminder}
                onSelect={() => {
                  close();
                  void onUpdate({ reminder: null });
                }}
              >
                {t("No reminder")}
              </MenuItem>
              {REMINDER_PRESETS.map((preset) => (
                <MenuItem
                  key={preset}
                  active={detail.reminder === preset}
                  onSelect={() => {
                    close();
                    void onUpdate({ reminder: preset });
                  }}
                >
                  {t(REMINDER_META[preset].label)}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      )}
    </div>
  );
}
