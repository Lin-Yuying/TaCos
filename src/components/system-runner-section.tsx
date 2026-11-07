"use client";

import { useT } from "@/components/i18n-context";
import { formatAge, type RunnerAdminRow, type SystemSnapshot } from "@/lib/ops/shared";

function lastSeen(ageSeconds: number | null): string {
  if (ageSeconds == null) return "never";
  return formatAge(ageSeconds);
}

/**
 * U-12: read-only runner/tunnel state for workspace admins.
 * There is deliberately no start, restart or disconnect control here.
 */
export function SystemRunnerSection({ snapshot }: { snapshot: SystemSnapshot }) {
  const t = useT();
  const rows = snapshot.runners;
  const connected = rows.filter((row) => row.online).length;

  return (
    <section className="space-y-3" data-testid="system-runners">
      <div>
        <h2 className="text-title">{t("Runners")}</h2>
        <p className="max-w-3xl text-body text-muted">
          {t(
            "Read-only. Each member's computer runs Agent work and reaches the server through the SSH tunnel; TaCos never restarts a runner or a tunnel."
          )}
        </p>
        <p className="text-small text-muted" data-testid="runners-summary">
          {t("{online} of {total} computers online", {
            online: String(connected),
            total: String(rows.length),
          })}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-small text-muted">{t("No members are in this workspace yet.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <RunnerItem key={row.userId} row={row} />
          ))}
        </ul>
      )}
      <p className="text-small text-muted">
        {t(
          "If a computer is offline, open TaCos on that computer and check its SSH tunnel. There is no remote restart."
        )}
      </p>
    </section>
  );
}

function RunnerItem({ row }: { row: RunnerAdminRow }) {
  const t = useT();
  const seen = lastSeen(row.lastSeenAgeSeconds);
  return (
    <li className="space-y-1 px-3 py-2" data-testid={`runner-${row.userId}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-body font-medium">{row.displayName}</span>
        <span className="text-caption text-muted">@{row.username}</span>
        <span
          className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap border text-caption ${
            row.online ? "border-border text-muted" : "border-danger text-danger"
          }`}
        >
          {row.online ? t("Online") : t("Offline")}
        </span>
        <span className="text-small text-muted">
          {seen === "never"
            ? t("Never connected")
            : t("Last seen {age} ago", { age: seen })}
        </span>
      </div>
      {row.harnesses.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-caption">
          {row.harnesses.map((harness) => (
            <span
              key={harness.id}
              title={harness.error ?? undefined}
              className={`rounded border px-1.5 py-0.5 ${
                harness.ready ? "border-border text-muted" : "border-danger text-danger"
              }`}
            >
              {harness.label}
              {harness.version ? ` ${harness.version}` : ""}
              {harness.ready ? "" : ` · ${harness.error ? t("Not ready") : t("Not detected")}`}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-small text-muted">{t("No harness report yet.")}</p>
      )}
      {row.recentErrors.length > 0 && (
        <details className="text-small">
          <summary className="cursor-pointer text-muted">
            {t("Recent run errors ({count})", { count: String(row.recentErrors.length) })}
          </summary>
          <ul className="mt-1 space-y-1">
            {row.recentErrors.map((error) => (
              <li key={error.id} className="break-words text-danger">
                <span className="text-muted">
                  {error.status} · {error.finishedAt?.slice(0, 19).replace("T", " ") ?? ""} ·{" "}
                </span>
                {error.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
