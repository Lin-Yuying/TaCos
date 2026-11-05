"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { startTaskChatAction } from "@/app/agent-actions";
import type { FlatDetail } from "./types";
import { useT } from "@/components/i18n-context";

// team-2.3: "Work on it in chat". Claims the task if nobody has it, opens the task chat,
// and on a brand-new chat queues the opening turn via sessionStorage. Hidden when the user
// cannot push the task forward.
export function AdvanceButton({
  workspaceId,
  detail,
  currentUserId,
  onClaimed,
  onError,
}: {
  workspaceId: string;
  detail: FlatDetail;
  currentUserId: string;
  onClaimed: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const closed = detail.status === "done" || detail.status === "canceled";
  const taken = Boolean(detail.claimedBy) && detail.claimedBy !== currentUserId;
  if (detail.reviewStatus !== "approved" || closed || taken) return null;

  async function open() {
    setBusy(true);
    const result = await startTaskChatAction(workspaceId, detail.id);
    setBusy(false);
    if (result.ok && !detail.claimedBy) onClaimed();
    if (result.ok) {
      const { thread, openingMessage } = result.data;
      if (openingMessage) {
        try {
          sessionStorage.setItem(
            `tacos:agent:pending:${thread.id}`,
            JSON.stringify({ text: openingMessage })
          );
        } catch {
          /* no storage — the chat still opens */
        }
      }
      router.push(`/${workspaceId}/agent?thread=${thread.id}`);
    } else onError(result.error);
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={open}
      data-testid="advance-button"
      className="flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-50"
    >
      <Bot size={13} />
      {busy ? t("Opening chat…") : t("Work on it in chat")}
    </button>
  );
}
