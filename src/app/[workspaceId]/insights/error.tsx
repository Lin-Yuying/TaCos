"use client";

import { useT } from "@/components/i18n-context";

export default function InsightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="insight-error">
      <div className="max-w-md rounded-lg border border-border px-4 py-5 text-center">
        <h1 className="text-body font-semibold">{t("Insights could not load")}</h1>
        <p className="mt-1 text-small text-faint">
          {t("The report query failed. Retry; if it keeps failing, narrow the date range.")}
        </p>
        {error.message ? (
          <p className="mt-2 break-words rounded-md bg-surface px-2 py-1 text-caption text-muted">
            {error.message}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-small text-muted hover:border-border-strong hover:text-text"
          data-testid="insight-error-retry"
        >
          {t("Retry")}
        </button>
      </div>
    </div>
  );
}
