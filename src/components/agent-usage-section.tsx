"use client";

import type { AgentUsageSummary } from "@/lib/agent-usage";
import { formatTokens } from "@/lib/agent-usage.shared";
import { useT } from "@/components/i18n-context";

// #79: token usage is observe-only. No dollar amounts, no price table, no budget controls.
export function AgentUsageSection({ usage }: { usage: AgentUsageSummary }) {
  const t = useT();
  const totals = usage.totals;
  return (
    <section className="space-y-3" data-testid="agent-usage">
      <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-small text-faint">
          {t("Last {days} days", { days: "30" })}
        </span>
      </div>
      <p className="text-small leading-relaxed text-faint">
        {t("Tokens the harnesses and the built-in API agent reported. Usage never stops a run, and TaCos never shows a price or a budget.")}
      </p>
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-4" data-testid="agent-usage-totals">
        {(
          [
            ["Input", totals.inputTokens],
            ["Output", totals.outputTokens],
            ["Cached", totals.cachedTokens],
            ["Reasoning", totals.reasoningTokens],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-caption text-faint">{t(label)}</div>
            <div className="font-variant-numeric tabular-nums text-title">{formatTokens(value)}</div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-small text-muted">
          <span className="flex-1">{t("Agent")}</span>
          <span>{t("Runs")}</span>
          <span className="w-24 text-right">{t("Tokens")}</span>
        </div>
        {usage.byAgent.length === 0 && <p className="px-4 py-3 text-small text-faint">{t("No usage recorded yet.")}</p>}
        {usage.byAgent.map((row) => (
          <div key={row.agentId ?? "direct"} className="flex items-center gap-2 border-t border-border px-4 py-2 text-small">
            <span className="min-w-0 flex-1 truncate text-text">{row.agentName}</span>
            <span className="font-variant-numeric tabular-nums text-muted">{row.runs}</span>
            <span className="w-24 text-right font-variant-numeric tabular-nums text-text">
              {formatTokens(row.usage.totalTokens)}
            </span>
          </div>
        ))}
      </div>
      {usage.byTask.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border" data-testid="agent-usage-tasks">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-small text-muted">
            <span className="flex-1">{t("Task")}</span>
            <span className="w-24 text-right">{t("Tokens")}</span>
          </div>
          {usage.byTask.map((row) => (
            <div key={row.issueId} className="flex items-center gap-2 border-t border-border px-4 py-2 text-small">
              <span className="min-w-0 flex-1 truncate text-text">
                {row.task ? `${row.task} · ` : ""}
                {row.title}
              </span>
              <span className="w-24 text-right font-variant-numeric tabular-nums text-text">
                {formatTokens(row.usage.totalTokens)}
              </span>
            </div>
          ))}
        </div>
      )}
      {usage.byDay.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="agent-usage-days">
          {usage.byDay.map((row) => (
            <span key={row.date} className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap border border-border text-caption text-muted">
              {row.date} · {formatTokens(row.usage.totalTokens)}
            </span>
          ))}
        </div>
      )}
      {usage.byModel.length > 0 && (
        <div data-testid="agent-usage-models" className="flex flex-wrap gap-1.5">
          {usage.byModel.map((row) => (
            <span
              key={`${row.engine}|${row.model}`}
              className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap border border-border text-caption text-muted"
            >
              {row.engine} · {row.model} · {formatTokens(row.usage.totalTokens)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
