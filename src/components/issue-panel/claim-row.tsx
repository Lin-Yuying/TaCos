"use client";

import { useState } from "react";
import { Hand, Search, X } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { MODAL_BODY, MODAL_HEAD, MODAL_TITLE, Modal } from "@/components/ui/modal";
import { claimIssueAction, releaseIssueAction, transferClaimAction } from "@/app/actions";
import type { IssueDetail, Member } from "@/lib/issues";
import type { FlatDetail } from "./types";
import { useT } from "@/components/i18n-context";

type Result = { ok: true; data: IssueDetail } | { ok: false; error: string };

// One row that shows who pushes the task forward. Anyone in the workspace can claim an
// approved, open task. Only the claimer can release it or hand it to another member.
export function ClaimRow({
  workspaceId,
  detail,
  members,
  currentUserId,
  onDetail,
  onError,
}: {
  workspaceId: string;
  detail: FlatDetail;
  members: Member[];
  currentUserId: string;
  onDetail: (detail: IssueDetail) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [handOverOpen, setHandOverOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const claimer = detail.claimedBy ? members.find((m) => m.id === detail.claimedBy) : undefined;
  const mine = detail.claimedBy === currentUserId;
  const closed = detail.status === "done" || detail.status === "canceled";

  async function act(call: () => Promise<Result>) {
    setBusy(true);
    const result = await call();
    setBusy(false);
    if (result.ok) onDetail(result.data);
    else onError(result.error);
  }

  const query = memberQuery.trim().toLowerCase();
  const candidates = members.filter(
    (member) =>
      member.id !== currentUserId &&
      (!query ||
        member.displayName.toLowerCase().includes(query) ||
        member.username.toLowerCase().includes(query))
  );

  function closeHandOver() {
    if (busy) return;
    setHandOverOpen(false);
    setMemberQuery("");
  }

  async function handOver(toUserId: string) {
    setBusy(true);
    const result = await transferClaimAction(workspaceId, detail.id, toUserId);
    setBusy(false);
    if (result.ok) {
      onDetail(result.data);
      closeHandOver();
    } else onError(result.error);
  }

  const button =
    "rounded-md border border-border px-2 py-0.5 text-small text-muted transition-colors hover:text-text disabled:opacity-50";

  return (
    <>
      <div className="flex items-center gap-2 text-body text-muted" data-testid="claim-row">
        <Hand size={13} className="shrink-0 text-faint" />
        {detail.reviewStatus !== "approved" ? (
          <span>{t("Waiting for review — no one can claim it yet")}</span>
        ) : detail.claimedBy ? (
          <>
            {claimer && <AssigneeAvatar displayName={claimer.displayName} avatar={claimer.avatar} size={16} />}
            <span>
              {mine ? t("You claimed this task") : t("{name} claimed this task", { name: claimer?.displayName ?? "?" })}
            </span>
            {mine && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  className={button}
                  onClick={() => void act(() => releaseIssueAction(workspaceId, detail.id))}
                >
                  {t("Release")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={button}
                  data-testid="hand-over-open"
                  onClick={() => setHandOverOpen(true)}
                >
                  {t("Hand over…")}
                </button>
              </>
            )}
          </>
        ) : closed ? (
          <span>{t("Closed tasks cannot be claimed")}</span>
        ) : (
          <>
            <span>{t("No one has claimed this task")}</span>
            <button
              type="button"
              disabled={busy}
              className={button}
              onClick={() => void act(() => claimIssueAction(workspaceId, detail.id))}
            >
              {t("Claim")}
            </button>
          </>
        )}
      </div>

      <Modal
        open={handOverOpen}
        bare
        onClose={closeHandOver}
        title={t("Hand over task")}
        className="max-w-[420px]"
      >
        <div className={MODAL_HEAD}>
          <h2 className={MODAL_TITLE}>{t("Hand over task")}</h2>
          <button
            type="button"
            onClick={closeHandOver}
            aria-label={t("Close")}
            className="flex size-[26px] items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
        <div className={MODAL_BODY}>
          <p className="text-small text-muted">
            {t("After the hand-over the other person becomes the claimer, and you are no longer responsible for this task.")}
          </p>
          <div className="search-field relative">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              autoFocus
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              aria-label={t("Search members")}
              placeholder={t("Search members")}
              className="h-[34px] w-full rounded-lg border border-border-strong bg-bg pl-8 pr-2.5 text-body outline-none placeholder:text-faint focus:border-border-strong focus-visible:outline-none"
            />
          </div>
          <div className="overflow-hidden rounded-lg border border-border" data-testid="hand-over-members">
            {candidates.map((member) => (
              <button
                key={member.id}
                type="button"
                disabled={busy}
                onClick={() => void handOver(member.id)}
                className="flex h-10 w-full items-center gap-2.5 border-b border-border px-3 text-left text-body text-text transition-colors last:border-b-0 hover:bg-elevated disabled:opacity-50"
              >
                <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={20} />
                <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
              </button>
            ))}
            {candidates.length === 0 && (
              <p className="px-3 py-2 text-small text-faint">{t("No matches.")}</p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
