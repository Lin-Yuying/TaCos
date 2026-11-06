"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getHarnessSubscriptionAction } from "@/app/agent-actions";
import type { SubscriptionInfo } from "@/lib/harness/types";
import { useT } from "@/components/i18n-context";

function resetText(t: ReturnType<typeof useT>, iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const minutes = Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000));
  if (minutes < 60) return t("resets in {minutes}m", { minutes: String(minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t("resets in {hours}h", { hours: String(hours) });
  return t("resets {date}", { date: date.toLocaleDateString() });
}

// #79: plan usage only where the harness reports it. Codex does; the rest say so.
export function HarnessSubscription({ workspaceId, harnessId }: { workspaceId: string; harnessId: string }) {
  const t = useT();
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const result = await getHarnessSubscriptionAction(workspaceId, harnessId);
    setBusy(false);
    if (result.ok) setInfo(result.data);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, harnessId]);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small" data-testid={`subscription-${harnessId}`}>
      {!info ? (
        <span className="text-faint">{t("Checking plan usage…")}</span>
      ) : info.windows.length > 0 ? (
        info.windows.map((window) => (
          <span key={window.id} className="flex items-center gap-1.5 rounded-full bg-elevated px-2 py-0.5">
            <span className="text-muted">{window.label}</span>
            <span className="font-variant-numeric tabular-nums text-text">
              {t("{percent}% left", { percent: String(Math.round(window.remainingPercent)) })}
            </span>
            {window.resetsAt && <span className="text-caption text-faint">{resetText(t, window.resetsAt)}</span>}
          </span>
        ))
      ) : (
        <span className="text-faint" data-testid={`subscription-none-${harnessId}`}>
          {t("Not reported")}
          {info.hint ? <span className="text-caption"> · {t(info.hint)}</span> : null}
        </span>
      )}
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        aria-label={t("Refresh plan usage")}
        className="rounded-md border border-border p-1 text-muted hover:bg-elevated disabled:opacity-40"
      >
        <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
      </button>
    </div>
  );
}
