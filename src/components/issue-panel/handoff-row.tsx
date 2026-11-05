"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import {
  answerHandoffAction,
  cancelHandoffAction,
  getHandoffAction,
  handTaskToAgentAction,
} from "@/app/agent-actions";
import type { HandoffPanel } from "@/lib/agent-handoff";
import { AGENT_APPROVALS } from "@/lib/ai-constants";
import { useT } from "@/components/i18n-context";
import type { FlatDetail } from "./types";

const POLL_MS = 3000;
const buttonClass =
  "flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] text-muted hover:bg-elevated hover:text-text disabled:opacity-50";
const selectClass = "rounded-md border border-border bg-bg px-1.5 py-1 text-[12px] text-text";

// Hand this task to the person's own Agent. It waits while their computer is off and reports
// back as a comment, so they can leave. Writes ask here by default.
export function HandoffRow({
  workspaceId,
  detail,
  currentUserId,
  onFinished,
}: {
  workspaceId: string;
  detail: FlatDetail;
  currentUserId: string;
  onFinished: () => void;
}) {
  const t = useT();
  const [panel, setPanel] = useState<HandoffPanel | null>(null);
  const [form, setForm] = useState(false);
  const [harness, setHarness] = useState("");
  const [approval, setApproval] = useState("ask");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issueId = detail.id;
  const wasOpen = useRef(false);

  const take = useCallback(
    (next: HandoffPanel) => {
      const open = next.handoff?.status === "queued" || next.handoff?.status === "running";
      if (wasOpen.current && !open) onFinished();
      wasOpen.current = open;
      setPanel(next);
    },
    [onFinished]
  );

  const status = panel?.handoff?.status;
  const open = status === "queued" || status === "running";

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getHandoffAction(workspaceId, issueId).then((result) => {
        if (!cancelled && result.ok) take(result.data);
      });
    load();
    if (!open) return () => void (cancelled = true);
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [workspaceId, issueId, open, take]);

  async function act(action: () => ReturnType<typeof getHandoffAction>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      take(result.data);
      setForm(false);
    } else setError(result.error);
  }

  if (!panel?.available) return null;
  const closed = detail.status === "done" || detail.status === "canceled";
  const taken = Boolean(detail.claimedBy) && detail.claimedBy !== currentUserId;
  const handoff = panel.handoff;
  if (!handoff && (detail.reviewStatus !== "approved" || closed || taken)) return null;
  const canHand = !open && detail.reviewStatus === "approved" && !closed && !taken && panel.harnesses.length > 0;
  const picked = harness || panel.harnesses[0]?.id || "";

  const statusText = !handoff
    ? ""
    : handoff.status === "queued"
      ? panel.online
        ? t("Your Agent is about to start")
        : t("Waiting for your computer to come online")
      : handoff.status === "running"
        ? handoff.pending.length > 0
          ? t("Waiting for your approval")
          : t("Your Agent is working")
        : handoff.status === "done"
          ? t("Your Agent finished")
          : handoff.status === "cancelled"
            ? t("Cancelled")
            : t("Your Agent could not finish: {reason}", { reason: t(handoff.error ?? "Unknown error") });

  return (
    <div className="flex flex-col gap-1.5 text-[12px]" data-testid="handoff-row">
      {handoff && (
        <div className="flex flex-wrap items-center gap-2 text-muted">
          <Bot size={13} className="shrink-0 text-faint" />
          <span data-handoff-status={handoff.status}>{statusText}</span>
          {handoff.threadId && (
            <Link href={`/${workspaceId}/agent?thread=${handoff.threadId}`} className="underline hover:text-text">
              {t("Open conversation")}
            </Link>
          )}
          {open && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => cancelHandoffAction(workspaceId, issueId, handoff.runId))}
              data-handoff-cancel
              className="underline hover:text-text disabled:opacity-50"
            >
              {t("Cancel")}
            </button>
          )}
        </div>
      )}

      {handoff?.pending.map((card) => (
        <div key={card.requestId} className="flex flex-col gap-1 rounded-md border border-border p-2" data-handoff-card>
          <span className="text-text">{card.message}</span>
          {card.params !== undefined && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted">
              {JSON.stringify(card.params, null, 2)}
            </pre>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              data-handoff-allow
              onClick={() => act(() => answerHandoffAction(workspaceId, issueId, handoff.runId, card.requestId, true))}
              className={buttonClass}
            >
              {t("Allow")}
            </button>
            <button
              type="button"
              disabled={busy}
              data-handoff-deny
              onClick={() => act(() => answerHandoffAction(workspaceId, issueId, handoff.runId, card.requestId, false))}
              className={buttonClass}
            >
              {t("Deny")}
            </button>
          </div>
        </div>
      ))}

      {canHand && !form && (
        <button type="button" onClick={() => setForm(true)} data-handoff-open className={buttonClass}>
          <Bot size={13} />
          {t("Hand to my Agent")}
        </button>
      )}

      {canHand && form && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2" data-handoff-form>
          <div className="flex flex-wrap items-center gap-1.5">
            <select value={picked} onChange={(event) => setHarness(event.target.value)} className={selectClass} data-handoff-harness>
              {panel.harnesses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <select value={approval} onChange={(event) => setApproval(event.target.value)} className={selectClass} data-handoff-approval>
              {AGENT_APPROVALS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={t("Anything your Agent should know (optional)")}
            className="resize-y rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-text"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !picked}
              data-handoff-submit
              onClick={() => act(() => handTaskToAgentAction(workspaceId, issueId, { harness: picked, approval, note }))}
              className={buttonClass}
            >
              {t("Hand over")}
            </button>
            <button type="button" onClick={() => setForm(false)} className={buttonClass}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}

      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
