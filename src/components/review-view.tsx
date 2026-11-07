"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewIssueAction } from "@/app/actions";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { friendlyDate, issueRef } from "@/lib/format";
import type { PendingReviewIssue, ReviewDecision } from "@/lib/issues";
import { useLocale, useT } from "@/components/i18n-context";
import { BTN, BTN_PRIMARY, LINE, LINE_SUB, PAGE_HINT, PAGE_INSET } from "@/lib/page-chrome";
import { useUI } from "@/components/ui-context";

// H-COLLAB-03: agent-published tasks wait here until a person approves or rejects them.
export function ReviewView({ workspaceId, issues }: { workspaceId: string; issues: PendingReviewIssue[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue } = useUI();
  const [error, setError] = useState<string | null>(null);

  async function decide(issue: PendingReviewIssue, decision: ReviewDecision) {
    const result = await reviewIssueAction(workspaceId, issue.id, decision);
    setError(result.ok ? null : t(result.error));
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className={PAGE_HINT}>
          {t("Tasks that an agent published wait here. Approve one to let anyone claim it. Reject one to remove it from the board.")}
        </p>
      <div className="min-h-0 flex-1 overflow-y-auto pb-10">
        {error && <div role="alert" className={`pb-3 text-small text-danger ${PAGE_INSET}`}>{error}</div>}
        {issues.length === 0 && (
          <div className={`py-3 text-body text-faint ${PAGE_INSET}`}>{t("No tasks wait for review.")}</div>
        )}
        {issues.length > 0 && (
          <div data-testid="review-list">
            {issues.map((issue) => (
              <div key={issue.id} className={`${LINE} flex-wrap`} data-testid="review-row">
                <span className="flex shrink-0 items-center">
                  <StatusIcon status={issue.status} size={14} />
                </span>
                <span className={`shrink-0 ${LINE_SUB}`}>{issueRef(issue)}</span>
                <div className="min-w-[200px] flex-1">
                  <div className="truncate">{issue.title}</div>
                  <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 ${LINE_SUB}`}>
                    <ProjectIcon color={issue.projectColor} icon={issue.projectIcon} size={12} />
                    <span className="truncate">{issue.projectName}</span>
                    <span className="shrink-0">
                      ·{" "}
                      {t("published by {name} through an agent on {date}", {
                        name: issue.publisherName ?? t("Agent"),
                        date: friendlyDate(issue.createdAt, locale),
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openIssue(issue.id, issue.latestReviewCommentId ?? undefined)}
                    data-testid="review-open-thread"
                    title={t("Open the review thread")}
                    className={BTN}
                  >
                    {issue.reviewCommentCount > 0
                      ? t("Thread ({count})", { count: issue.reviewCommentCount })
                      : t("Discuss")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(issue, "reject")}
                    className={BTN}
                  >
                    {t("Reject")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(issue, "approve")}
                    className={BTN_PRIMARY}
                  >
                    {t("Approve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
