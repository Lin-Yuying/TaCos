"use client";

import { useT } from "@/components/i18n-context";
import { LoadError } from "@/components/ui/load-error";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  return (
    <LoadError
      title={t("This page could not load")}
      hint={t("Retry; if it keeps failing, reload the page.")}
      error={error.message}
      onRetry={reset}
    />
  );
}
