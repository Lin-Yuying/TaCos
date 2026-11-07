"use client";

import { useState } from "react";
import { OctagonAlert } from "lucide-react";
import type { ActivityEvent } from "@/lib/issues";
import { useT } from "@/components/i18n-context";
import { actorName } from "./format";

export function BlockerReport({
  events,
  busy,
  onSubmit,
}: {
  events: ActivityEvent[];
  busy: boolean;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const reports = events.filter((event) => event.type === "blocker_reported");

  async function submit() {
    if (!body.trim() || busy) return;
    const ok = await onSubmit(body);
    if (!ok) return;
    setBody("");
    setOpen(false);
  }

  return (
    <div className="space-y-2" data-testid="blocker-report">
      {reports.map((event) => (
        <p key={event.id} className="rounded-lg bg-elevated px-3 py-2 text-small text-muted">
          <span className="font-medium text-text">{actorName(event, t)}</span>{" "}
          {typeof event.data.body === "string" && event.data.body
            ? t("reported a blocker: {text}", { text: event.data.body })
            : t("reported a blocker")}
        </p>
      ))}
      {open ? (
        <div className="rounded-lg border border-border bg-elevated/30 p-2">
          <textarea
            value={body}
            rows={2}
            placeholder={t("What is blocking this task?")}
            onChange={(event) => setBody(event.target.value)}
            className="w-full resize-none bg-transparent text-body text-text placeholder:text-faint"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setBody("");
              }}
              className="rounded-md px-2.5 py-1 text-small text-muted hover:text-text"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={!body.trim() || busy}
              onClick={() => void submit()}
              className="rounded-md bg-accent px-2.5 py-1 text-small font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Report")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-small text-muted hover:text-text"
        >
          <OctagonAlert size={14} />
          {t("Report a blocker")}
        </button>
      )}
    </div>
  );
}
