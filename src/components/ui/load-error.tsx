"use client";

import { useState } from "react";
import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

// The one shape for "this did not load": what failed, what to try, and the raw error on request.
export function LoadError({ title, hint, error, onRetry, testId, retryTestId }: {
  title: string; hint: string; error?: string; onRetry: () => void; testId?: string; retryTestId?: string;
}) {
  const t = useT();
  const [details, setDetails] = useState(false);
  return (
    <div className="flex min-h-0 flex-1" data-testid={testId}>
      <EmptyState title={title} hint={hint}>
        <button
          type="button"
          onClick={onRetry}
          data-testid={retryTestId}
          className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t("Retry")}
        </button>
        {error ? (
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
            className="rounded-md px-2 py-1.5 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            {t("Technical details")}
          </button>
        ) : null}
        {details && error ? (
          <p className="w-full max-w-[420px] break-words rounded-md bg-surface px-2 py-1 text-caption text-muted">{error}</p>
        ) : null}
      </EmptyState>
    </div>
  );
}
