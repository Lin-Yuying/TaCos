"use client";

import Link from "next/link";
import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundText() {
  const t = useT();
  return (
    <EmptyState
      title={t("This page could not be found")}
      hint={t("It may have been deleted, or the link may be wrong.")}
    >
      <Link href="/" className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover">
        {t("Go home")}
      </Link>
    </EmptyState>
  );
}
