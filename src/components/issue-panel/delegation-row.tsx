"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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

// The row follows the DelegationStates canvas: a status pill, the sentence that explains
// that state, and the state's action on the same line. globals.css has no semantic status
// colours (only accent / danger / the desktop-update pair), so the tints below are mixed
// from the tokens that do exist instead of hard-coding new ones here.
const PRIMARY_BTN =
  "inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-2.5 text-small font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50";
const OUTLINE_BTN =
  "inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-bg px-2.5 text-small text-text transition-colors hover:bg-active disabled:opacity-40";
const TEXT_BTN =
  "inline-flex shrink-0 items-center gap-1 text-caption text-muted transition-colors hover:text-text disabled:opacity-50";
const PILL =
  "inline-flex h-[19px] shrink-0 items-center rounded-[5px] px-1.5 text-caption font-medium";
const TAG =
  "inline-flex h-[18px] items-center rounded-[5px] bg-elevated px-1.5 whitespace-nowrap text-caption text-faint";
const buttonClass = OUTLINE_BTN;
const selectClass = "rounded-md border border-border bg-bg px-1.5 py-1 text-small text-text";

type DelegationState =
  | "queued"
  | "running"
  | "review"
  | "changes_requested"
  | "approved"
  | "failed"
  | "cancelled";
type ShownState = DelegationState | "idle";

const STATE_PILL: Record<ShownState, string> = {
  idle: "Waiting",
  queued: "Waiting",
  running: "In Progress",
  review: "Review",
  changes_requested: "Changes",
  approved: "Approved",
  failed: "Not finished",
  cancelled: "Cancelled",
};
const STATE_PHRASE: Record<ShownState, string> = {
  idle: "Waiting for the agent",
  queued: "Waiting for the agent",
  running: "The agent is working",
  review: "Ready for review",
  changes_requested: "Changes requested",
  approved: "Approved",
  failed: "The agent could not finish",
  cancelled: "Cancelled",
};
const STATE_TONE: Record<ShownState, CSSProperties> = {
  idle: { backgroundColor: "var(--color-elevated)", color: "var(--color-muted)" },
  queued: { backgroundColor: "var(--color-elevated)", color: "var(--color-muted)" },
  running: { backgroundColor: "var(--color-update-bg)", color: "var(--color-update-text)" },
  review: {
    backgroundColor: "color-mix(in srgb, var(--color-code-keyword) 12%, var(--color-bg))",
    color: "var(--color-code-keyword)",
  },
  changes_requested: {
    backgroundColor: "color-mix(in srgb, var(--color-code-number) 12%, var(--color-bg))",
    color: "var(--color-code-number)",
  },
  approved: {
    backgroundColor: "color-mix(in srgb, var(--color-code-string) 10%, var(--color-bg))",
    color: "var(--color-code-string)",
  },
  failed: {
    backgroundColor: "color-mix(in srgb, var(--color-danger) 10%, var(--color-bg))",
    color: "var(--color-danger)",
  },
  cancelled: { backgroundColor: "var(--color-elevated)", color: "var(--color-muted)" },
};

// Run rows and the issue's stored state disagree for a moment during a review decision;
// the stored state is the one the board names, so prefer it once the run is done.
function shownStateOf(panel: DelegationPanel): ShownState {
  const run = panel.run;
  const declared = (value: string | null | undefined): DelegationState | null =>
    value === "queued" ||
    value === "running" ||
    value === "review" ||
    value === "changes_requested" ||
    value === "approved" ||
    value === "failed" ||
    value === "cancelled"
      ? value
      : null;
  if (run?.reviewStatus === "approved") return "approved";
  if (run?.reviewStatus === "changes_requested") return "changes_requested";
  if (run?.status === "done") return declared(panel.status) ?? "review";
  return declared(run?.status) ?? declared(panel.status) ?? "idle";
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

  const state = panel ? shownStateOf(panel) : "idle";
  const open = panel?.run?.status === "queued" || panel?.run?.status === "running";
  const review = panel?.run?.status === "done" && panel.run.reviewStatus === "pending";
  const failedOrChanges =
    panel?.run?.status === "failed" || panel?.status === "changes_requested" || panel?.status === "failed";

  // "Changes requested: <note>" from the review event, when the board's note exists.
  const requestedNote =
    state === "changes_requested"
      ? (() => {
          const event = [...detail.events]
            .reverse()
            .find((item) => item.type === "agent_changes_requested");
          const value = event?.data.note;
          return typeof value === "string" ? value.trim() : "";
        })()
      : "";
  const phrase =
    state === "changes_requested" && requestedNote
      ? t("Changes requested: {note}", { note: requestedNote })
      : t(STATE_PHRASE[state]);

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
  const cancel = () => void act(() => cancelDelegationAction(workspaceId, issueId));

  const rowActions = (
    <>
      {state === "queued" && (
        <button type="button" disabled={busy} onClick={cancel} data-delegation-cancel className={OUTLINE_BTN}>
          {t("Cancel")}
        </button>
      )}
      {state === "running" && (
        <>
          {run?.threadId && (
            <Link href={`/${workspaceId}/agent?thread=${run.threadId}`} className={OUTLINE_BTN}>
              {t("Open conversation")}
            </Link>
          )}
          <button type="button" disabled={busy} onClick={cancel} data-delegation-cancel className={TEXT_BTN}>
            {t("Cancel")}
          </button>
        </>
      )}
      {state === "review" && (
        <>
          <button
            type="button"
            disabled={busy}
            data-delegation-approve
            onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "approve"))}
            className={PRIMARY_BTN}
          >
            <CircleCheck size={13} />
            {t("Approve")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-delegation-changes
            onClick={() => setChanges((open) => !open)}
            className={OUTLINE_BTN}
          >
            {t("Request changes")}
          </button>
          <button
            type="button"
            disabled={busy}
            data-delegation-retry
            onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "retry"))}
            className={TEXT_BTN}
          >
            <RotateCcw size={12} />
            {t("Retry")}
          </button>
        </>
      )}
      {(state === "failed" || (state === "changes_requested" && !open)) && (
        <button
          type="button"
          disabled={busy}
          data-delegation-retry-failed
          onClick={() => act(() => reviewDelegationAction(workspaceId, issueId, "retry", note))}
          className={OUTLINE_BTN}
        >
          <RotateCcw size={13} />
          {t("Retry")}
        </button>
      )}
      {state === "cancelled" && panel.canDelegate && !closed && (
        <button
          type="button"
          onClick={() => setForm(true)}
          data-delegation-open
          className={OUTLINE_BTN}
        >
          <Bot size={13} />
          {t("Delegate again")}
        </button>
      )}
    </>
  );

  const extras = (
    <>
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
    </>
  );

  return (
    <div className="flex flex-col gap-1.5 text-small" data-testid="delegation-row">
      {panel.agent ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <span
              className={PILL}
              style={STATE_TONE[state]}
              data-delegation-status={state === "idle" ? "idle" : state}
            >
              {t(STATE_PILL[state])}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-body leading-snug text-text">{phrase}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-faint">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Bot size={11} className="shrink-0" />
                  <span className="truncate text-muted" data-testid="delegation-agent">
                    {panel.agent.name}
                  </span>
                </span>
                {run?.source && (
                  <span className={TAG} data-testid="delegation-source">
                    {run.source === "api" ? t("Built-in API agent") : t("Desktop runner")}
                    {run.fallback ? ` · ${t("fallback from runner")}` : ""}
                  </span>
                )}
                {run?.subscription && (
                  <span className={TAG} data-testid="delegation-subscription">
                    {run.subscription.windows[0]
                      ? t("{percent}% plan left", {
                          percent: String(Math.round(run.subscription.windows[0].remainingPercent)),
                        })
                      : t("Plan: not reported")}
                  </span>
                )}
                {run?.model && <span className="font-mono">{run.model}</span>}
                {usage && usage.totalTokens > 0 && (
                  <span className="font-variant-numeric tabular-nums" data-testid="delegation-tokens">
                    {t("{count} tokens", { count: usage.totalTokens.toLocaleString() })}
                  </span>
                )}
                {run?.threadId && state !== "running" && (
                  <Link
                    href={`/${workspaceId}/agent?thread=${run.threadId}`}
                    className="underline-offset-2 hover:text-text hover:underline"
                  >
                    {t("Open conversation")}
                  </Link>
                )}
              </div>
            </div>
            {rowActions && <div className="flex shrink-0 items-center gap-1.5">{rowActions}</div>}
          </div>
          {(run?.pending.length ?? 0) > 0 || run?.error || (changes && review) ? (
            <div className="flex flex-col gap-2 border-t border-border px-3 py-2">{extras}</div>
          ) : null}
        </div>
      ) : (
        extras
      )}

      {panel.agent?.source === "harness" && !panel.online && (
        <p className="rounded-lg border border-border px-3 py-2 text-small text-muted">
          {t(
            "The runner is offline. This agent falls back to the built-in API agent when you have a model API."
          )}
        </p>
      )}

      {!panel.agent && failedOrChanges && !review && (
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

      {panel.canDelegate && !closed && !form && !panel.run && (
        <button type="button" onClick={() => setForm(true)} data-delegation-open className="flex w-fit items-center gap-1.5 text-small text-muted transition-colors hover:text-text">
          <Bot size={13} />
          {t(panel.agent ? "Delegate again" : "Delegate to an agent")}
        </button>
      )}

      {panel.canDelegate && !closed && form && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2" data-delegation-form>
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
