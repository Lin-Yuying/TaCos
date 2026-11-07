"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useParams } from "next/navigation";
import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

export default function WorkspaceNotFound() {
  const t = useT();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <EmptyState
      icon={<Search size={16} />}
      title={t("This page could not be found")}
      hint={t("It may have been deleted, the link may be wrong, or it may not be shared with you.")}
    >
      <Link href={`/${workspaceId}/start`} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white transition-colors hover:bg-accent-hover">
        {t("Back to Start")}
      </Link>
      <Link href={`/${workspaceId}/trash`} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors bg-bg text-text hover:bg-active">
        {t("Open Trash")}
      </Link>
    </EmptyState>
  );
}
