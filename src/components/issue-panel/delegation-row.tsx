"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import {
  answerDelegationAction,
  cancelDelegationAction,
  delegateTaskAction,
  getDelegationAction,
  reviewDelegationAction,
} from "@/app/agent-actions";
import type { DelegationPanel } from "@/lib/agent-delegation";
import { AGENT_APPROVALS } from "@/lib/ai-constants";
import { useT } from "@/components/i18n-context";
import type { FlatDetail } from "./types";

const POLL_MS = 3000;
const buttonClass =
  "flex w-fit items-center gap-1.5 rounded-md border border-border px-2 py-1 text-small text-muted hover:bg-elevated hover:text-text disabled:opacity-50";
const selectClass = "rounded-md border border-border bg-bg px-1.5 py-1 text-small text-text";

function statusLabel(t: ReturnType<typeof useT>, status: string | null): string {
  switch (status) {
    case "queued":
      return t("Waiting for the agent");
    case "running":
      return t("The agent is working");
    case "review":
      return t("Ready for review");
    case "changes_requested":
      return t("Changes requested");
    case "approved":
      return t("Approved");
    case "failed":
      return t("The agent could not finish");
    case "cancelled":
      return t("Cancelled");
    default:
      return "";
  }
}

// #79: a task delegated to a named or personal agent. The human assignees stay in charge;
// approve / request changes / retry all live here.
export function DelegationRow({
  workspaceId,
  detail,
  onFinished,
}: {
  workspaceId: string;
  detail: FlatDetail;
  onFinished: () => void;
}) {
  const t = useT();
  const [panel, setPanel] = useState<DelegationPanel | null>(null);
  const [form, setForm] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [approval, setApproval] = useState("ask");
  const [note, setNote] = useState("");
  const [changes, setChanges] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issueId = detail.id;
  const wasOpen = useRef(false);

  const take = useCallback(
    (next: DelegationPanel) => {
      const open = next.run?.status === "queued" || next.run?.status === "running";
      if (wasOpen.current && !open) onFinished();
      wasOpen.current = open;
      setPanel(next);
      if (!agentId) {
        const first = next.agents.find((agent) => agent.available) ?? next.agents[0];
        if (first) setAgentId(first.id);
      }
    },
    [agentId, onFinished]
  );

  const status = panel?.run?.status;
  // After a review decision the run row is still `done`; the issue's delegation
  // state carries approved/changes_requested, so prefer that for the label.
  const shownStatus =
    panel?.run?.reviewStatus === "approved"
      ? "approved"
      : panel?.run?.reviewStatus === "changes_requested"
        ? "changes_requested"
        : status === "done"
          ? panel?.status ?? "review"
          : status ?? panel?.status ?? null;
  const open = status === "queued" || status === "running";
  const review = panel?.run?.status === "done" && panel.run.reviewStatus === "pending";
  const failedOrChanges =
    panel?.run?.status === "failed" || panel?.status === "changes_requested" || panel?.status === "failed";

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getDelegationAction(workspaceId, issueId).then((result) => {
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

  async function act(action: () => Promise<Awaited<ReturnType<typeof getDelegationAction>>>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      take(result.data);
      setForm(false);
      setChanges(false);
      setChangesNote("");
    } else setError(result.error);
  }

  if (!panel) return null;
  if (!panel.run && !panel.canDelegate && !panel.agent) return null;
  const closed = detail.status === "done" || detail.status === "canceled";
  const picked = agentId || panel.agents.find((agent) => agent.available)?.id || panel.agents[0]?.id || "";
  const current = panel.agents.find((agent) => agent.id === picked);
  const run = panel.run;
  const usage = run?.usage;

  return (
    <div className="flex flex-col gap-1.5 text-small" data-testid="delegation-row">
      {panel.agent && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <Bot size={13} className="shrink-0 text-faint" />
          <span className="text-text" data-testid="delegation-agent">
            {panel.agent.name}
          </span>
          <span data-delegation-status={shownStatus ?? "idle"}>
            {statusLabel(t, shownStatus)}
          </span>
          {run?.source && (
            <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption" data-testid="delegation-source">
              {run.source === "api" ? t("Built-in API agent") : t("Desktop runner")}
              {run.fallback ? ` · ${t("fallback from runner")}` : ""}
            </span>
          )}
          {run?.subscription && (
            <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-faint" data-testid="delegation-subscription">
              {run.subscription.windows[0]
                ? t("{percent}% plan left", {
                    percent: String(Math.round(run.subscription.windows[0].remainingPercent)),
                  })
                : t("Plan: not reported")}
            </span>
          )}
          {run?.model && <span className="font-mono text-caption text-faint">{run.model}</span>}
          {usage && usage.totalTokens > 0 && (
            <span className="font-variant-numeric tabular-nums text-caption text-faint" data-testid="delegation-tokens">
              {t("{count} tokens", { count: usage.totalTokens.toLocaleString() })}
            </span>
          )}
          {run?.threadId && (
            <Link href={`/${workspaceId}/agent?thread=${run.threadId}`} className="underline hover:text-text">
              {t("Open conversation")}
            </Link>
          )}
          {open && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => cancelDelegationAction(workspaceId, issueId))}
              data-delegation-cancel
              className="underline hover:text-text disabled:opacity-50"
            >
              {t("Cancel")}
            </button>
          )}
        </div>
      )}

      {run?.pending.map((card) => (
        <div key={card.requestId} className="flex flex-col gap-1 rounded-md border border-border p-2" data-delegation-card>
          <span className="text-text">{card.message}</span>
          {card.params !== undefined && (
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-caption text-muted">
              {JSON.stringify(card.params, null, 2)}
            </pre>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy}
              data-delegation-allow
              onClick={() => act(() => answerDelegationAction(workspaceId, issueId, run.runId, card.requestId, true))}
              className={buttonClass}
            >
              {t("Allow")}
            </button>
            <button
              type="button"
              disabled={busy}
              data-delegation-deny
              onClick={() => act(() => answerDelegationAction(workspaceId, issueId, run.runId, card.requestId, false))}
              className={buttonClass}
            >
              {t("Deny")}
            </button>
          </div>
        </div>
      ))}

      {run?.error && (
        <p className="flex items-start gap-1 text-danger">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          {run.error}
        </p>
      )}

      {review && (
        <div className="flex flex-wrap items-center gap-1.5" data-delegation-review>
          <button
            type="button"
            disabled={busy}
            data-delegation-approve
            onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "approve"))}
            className={buttonClass}
          >
            <CircleCheck size={13} />
            {t("Approve")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-delegation-changes
            onClick={() => setChanges((open) => !open)}
            className={buttonClass}
          >
            {t("Request changes")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-delegation-retry
            onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "retry"))}
            className={buttonClass}
          >
            <RotateCcw size={13} />
            {t("Retry")}
          </button>
        </div>
      )}

      {changes && review && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2" data-delegation-changes-form>
          <textarea
            value={changesNote}
            onChange={(event) => setChangesNote(event.target.value)}
            rows={2}
            aria-label={t("What should change?")}
            placeholder={t("What should change?")}
            className="resize-y rounded-lg border border-border-strong bg-bg px-2 py-1 text-small text-text"
          />
          <button
            type="button"
            disabled={busy}
            data-delegation-changes-submit
            onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "request_changes", changesNote))}
            className={buttonClass}
          >
            {t("Ask the agent again")}
          </button>
        </div>
      )}

      {failedOrChanges && !review && (
        <button
          type="button"
          disabled={busy}
          data-delegation-retry-failed
          onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "retry", note))}
          className={buttonClass}
        >
          <RotateCcw size={13} />
          {t("Retry")}
        </button>
      )}

      {panel.canDelegate && !closed && !open && !form && (
        <button type="button" onClick={() => setForm(true)} data-delegation-open className={buttonClass}>
          <Bot size={13} />
          {t(panel.agent ? "Delegate again" : "Delegate to an agent")}
        </button>
      )}

      {panel.canDelegate && !closed && form && (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-2" data-delegation-form>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={picked}
              onChange={(event) => setAgentId(event.target.value)}
              aria-label={t("Agent")}
              className={selectClass}
              data-delegation-agent-select
            >
              {panel.agents.map((agent) => (
                <option key={agent.id} value={agent.id} disabled={!agent.available}>
                  {agent.name}
                  {agent.available ? "" : ` — ${t("not available")}`}
                </option>
              ))}
            </select>
            <select
              value={approval}
              onChange={(event) => setApproval(event.target.value)}
              aria-label={t("Approval")}
              className={selectClass}
              data-delegation-approval
            >
              {AGENT_APPROVALS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
            {panel.online ? null : <span className="text-caption text-faint">{t("Desktop runner offline")}</span>}
          </div>
          {current?.hint && !current.available && <p className="text-caption text-faint">{t(current.hint)}</p>}
          {current?.source === "api" && <p className="text-caption text-faint">{t("Runs on the server; no desktop app needed.")}</p>}
          {current?.source === "harness" && !panel.online && (
            <p className="text-caption text-faint">
              {t("The runner is offline. This agent falls back to the built-in API agent when you have a model API.")}
            </p>
          )}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            aria-label={t("Anything the agent should know (optional)")}
            placeholder={t("Anything the agent should know (optional)")}
            className="resize-y rounded-lg border border-border-strong bg-bg px-2 py-1 text-small text-text"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !picked || !current?.available}
              data-delegation-submit
              onClick={() => act(() => delegateTaskAction(workspaceId, issueId, { agentId: picked, approval, note }))}
              className={buttonClass}
            >
              {t("Delegate")}
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
