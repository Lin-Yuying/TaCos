"use client";

import { useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { ActivityEvent } from "@/lib/issues";
import { actorName, eventText } from "./format";
import { useLocale, useT } from "@/components/i18n-context";

export function ChangelogSection({ events }: { events: ActivityEvent[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  if (events.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-elevated/30">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-muted transition-colors hover:text-text"
      >
        <History size={13} className="text-faint" />
        <span>{t("Changelog")}</span>
        <span className="text-faint">
          · {t(events.length === 1 ? "{count} update" : "{count} updates", { count: events.length })}
        </span>
        <ChevronDown
          size={13}
          className={`ml-auto text-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-3 py-2">
          {events.map((event) => {
            const text = eventText(event, t, locale);
            if (!text) return null;
            return (
              <div key={event.id} className="flex items-baseline gap-2">
                <span className="text-[12px] text-faint">
                  <span className="text-muted">{actorName(event, t)}</span> {text}
                </span>
                <span suppressHydrationWarning className="text-[11px] text-faint">
                  {timeAgo(event.createdAt, locale)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
