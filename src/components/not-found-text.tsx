"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundText() {
  const t = useT();
  return (
    <EmptyState
      icon={<Search size={16} />}
      title={t("This page could not be found")}
      hint={t("It may have been deleted, or the link may be wrong.")}
    >
      <Link href="/" className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white transition-colors hover:bg-accent-hover">
        {t("Go home")}
      </Link>
    </EmptyState>
  );
}
