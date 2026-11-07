"use client";

import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

export default function InsightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1" data-testid="insight-error">
      <EmptyState
        title={t("Insights could not load")}
        hint={t("The report query failed. Retry; if it keeps failing, narrow the date range.")}
      >
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover"
          data-testid="insight-error-retry"
        >
          {t("Retry")}
        </button>
        {error.message ? (
          <details className="w-full text-small text-muted">
            <summary className="cursor-pointer">{t("Technical details")}</summary>
            <p className="mt-1 break-words rounded-md bg-surface px-2 py-1 text-caption">{error.message}</p>
          </details>
        ) : null}
      </EmptyState>
    </div>
  );
}
