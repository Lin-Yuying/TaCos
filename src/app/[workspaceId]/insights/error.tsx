"use client";

import { useT } from "@/components/i18n-context";
import { LoadError } from "@/components/ui/load-error";

export default function InsightsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <LoadError
      title={t("Insights could not load")}
      hint={t("The report query failed. Retry; if it keeps failing, narrow the date range.")}
      error={error.message}
      onRetry={reset}
      testId="insight-error"
      retryTestId="insight-error-retry"
    />
  );
}
