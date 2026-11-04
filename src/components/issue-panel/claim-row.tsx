"use client";

import { useState } from "react";
import { Hand } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { AssigneeAvatar } from "@/components/issue-table";
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

  const button =
    "rounded-md border border-border px-2 py-0.5 text-[12px] text-muted transition-colors hover:text-text disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 text-[13px] text-muted" data-testid="claim-row">
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
              <Menu width={200} triggerClassName={button} trigger={<>{t("Hand over…")}</>}>
                {(close) => (
                  <>
                    {members
                      .filter((m) => m.id !== currentUserId)
                      .map((m) => (
                        <MenuItem
                          key={m.id}
                          onSelect={() => {
                            close();
                            void act(() => transferClaimAction(workspaceId, detail.id, m.id));
                          }}
                        >
                          <AssigneeAvatar displayName={m.displayName} avatar={m.avatar} size={16} />
                          {m.displayName}
                        </MenuItem>
                      ))}
                  </>
                )}
              </Menu>
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
  );
}
