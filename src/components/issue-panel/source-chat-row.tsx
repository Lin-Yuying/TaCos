"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { getSourceThreadAction } from "@/app/agent-actions";
import type { SourceThread } from "@/lib/agent-threads";
import { useT } from "@/components/i18n-context";

// A task that an agent chat published links back to that chat (H-COLLAB-07).
// A private chat of another person stays hidden; the row then says only that it exists.
export function SourceChatRow({ workspaceId, threadId }: { workspaceId: string; threadId: string | null }) {
  const t = useT();
  const [thread, setThread] = useState<SourceThread | null | undefined>(undefined);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void getSourceThreadAction(workspaceId, threadId).then((result) => {
      if (!cancelled) setThread(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, threadId]);

  if (!threadId || thread === undefined) return null;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-body text-muted"
      data-testid="source-chat-row"
    >
      <MessageSquare size={13} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate">
        {thread
          ? t("Source chat: {title}", { title: thread.title || t("New conversation") })
          : t("Made in a private chat")}
      </span>
      {thread ? (
        <Link
          href={`/${workspaceId}/agent?thread=${thread.id}`}
          className="shrink-0 text-small text-muted transition-colors hover:text-text"
        >
          {t("Open conversation")}
        </Link>
      ) : null}
    </div>
  );
}
