"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { reviewIssueAction } from "@/app/actions";
import { ProjectIcon, StatusIcon } from "@/components/icons";
import { formatDate, issueRef } from "@/lib/format";
import type { PendingReviewIssue, ReviewDecision } from "@/lib/issues";
import { useLocale, useT } from "@/components/i18n-context";

// H-COLLAB-03: agent-published tasks wait here until a person approves or rejects them.
export function ReviewView({ workspaceId, issues }: { workspaceId: string; issues: PendingReviewIssue[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function decide(issue: PendingReviewIssue, decision: ReviewDecision) {
    const result = await reviewIssueAction(workspaceId, issue.id, decision);
    setError(result.ok ? null : t(result.error));
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto px-10 pb-10 pt-6 lg:px-20 xl:px-32">
      <div className="space-y-4">
        <p className="text-body leading-relaxed text-muted">
          {t("Tasks that an agent published wait here. Approve one to let anyone claim it. Reject one to remove it from the board.")}
        </p>
        {error && <div className="rounded-lg border border-danger/40 p-3 text-body text-danger">{error}</div>}
        {issues.length === 0 && (
          <div className="rounded-lg border border-border p-4 text-body text-faint">{t("No tasks wait for review.")}</div>
        )}
        {issues.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border" data-testid="review-list">
            {issues.map((issue) => (
              <div key={issue.id} className="flex items-start gap-3 px-4 py-2.5" data-testid="review-row">
                <span className="mt-[3px] flex shrink-0 items-center">
                  <StatusIcon status={issue.status} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-small text-faint">{issueRef(issue)}</span>
                    <span className="truncate text-body">{issue.title}</span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-small text-faint">
                    <ProjectIcon color={issue.projectColor} size={12} />
                    <span className="truncate">{issue.projectName}</span>
                    <span className="shrink-0">
                      ·{" "}
                      {t("published by {name} through an agent on {date}", {
                        name: issue.publisherName ?? t("Agent"),
                        date: formatDate(issue.createdAt, locale),
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void decide(issue, "approve")}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
                  >
                    <Check size={13} />
                    {t("Approve")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(issue, "reject")}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-small text-faint transition-colors hover:bg-elevated hover:text-danger"
                  >
                    <X size={13} />
                    {t("Reject")}
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
