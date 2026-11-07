"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useT } from "@/components/i18n-context";
import { EmptyState } from "@/components/ui/empty-state";

export default function WorkspaceNotFound() {
  const t = useT();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <EmptyState
      title={t("This page could not be found")}
      hint={t("It may have been deleted, the link may be wrong, or it may not be shared with you.")}
    >
      <Link href={`/${workspaceId}/start`} className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover">
        {t("Back to Start")}
      </Link>
      <Link href={`/${workspaceId}/trash`} className="rounded-md border border-border px-3 py-1.5 text-small text-muted transition-colors hover:text-text">
        {t("Open Trash")}
      </Link>
    </EmptyState>
  );
}
