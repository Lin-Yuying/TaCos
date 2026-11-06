"use client";

import { Repeat } from "lucide-react";
import { RECURRENCE_META, RECURRENCES, type Recurrence } from "@/lib/constants";
import type { FlatDetail, IssueUpdate } from "./types";
import { useT } from "@/components/i18n-context";

export function RecurrenceRow({ detail, onUpdate }: { detail: FlatDetail; onUpdate: IssueUpdate }) {
  const t = useT();
  return (
    <label className="flex items-center gap-2 text-small text-muted">
      <Repeat size={14} className="text-faint" />
      <span>{t("Recurrence")}</span>
      <select
        data-testid="recurrence"
        aria-label={t("Recurrence")}
        value={detail.recurrence ?? ""}
        onChange={(event) =>
          void onUpdate({ recurrence: event.target.value ? (event.target.value as Recurrence) : null })
        }
        className="bg-transparent text-small text-text"
      >
        <option value="">{t("No recurrence")}</option>
        {RECURRENCES.map((cadence) => (
          <option key={cadence} value={cadence}>
            {t(RECURRENCE_META[cadence].label)}
          </option>
        ))}
      </select>
    </label>
  );
}
