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
      className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small w-fit border border-border transition-colors disabled:opacity-50 bg-bg text-text hover:bg-active"
    >
      <Bot size={13} />
      {busy ? t("Opening chat…") : t("Work on it in chat")}
    </button>
  );
}
