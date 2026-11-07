"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { systemSnapshotAction } from "@/app/ops-actions";
import { useT } from "@/components/i18n-context";
import { SystemBackupSection } from "@/components/system-backup-section";
import { SystemUpdateSection } from "@/components/system-update-section";
import { SystemRunnerSection } from "@/components/system-runner-section";
import { safeAction } from "@/lib/ui/safe-action";
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  DIAGNOSTICS_MAX_BYTES,
  formatAge,
  formatBytes,
  formatUptime,
  type HealthState,
  type SystemSnapshot,
} from "@/lib/ops/shared";

const STATE_BADGE: Record<HealthState, string> = {
  ok: "border-border text-muted",
  warn: "border-update-border bg-update-bg text-update-text",
  fail: "border-danger text-danger",
};

function stateLabel(state: HealthState, t: (text: string) => string): string {
  return state === "fail" ? t("Action needed") : state === "warn" ? t("Needs attention") : t("Healthy");
}

export function SystemView({
  workspaceId,
  snapshot,
  isOwner,
}: {
  workspaceId: string;
  snapshot: SystemSnapshot;
  isOwner: boolean;
}) {
  const t = useT();
  const [data, setData] = useState<SystemSnapshot>(snapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = data.health;
  const onlineRunners = data.runners.filter((runner) => runner.online).length;
  const lastSeenAges = data.runners
    .map((runner) => runner.lastSeenAgeSeconds)
    .filter((age): age is number => age != null);
  const lastRunnerAge = lastSeenAges.length > 0 ? Math.min(...lastSeenAges) : null;
  const check = (id: "database" | "disk" | "wal" | "backup"): HealthState =>
    health.checks.find((item) => item.id === id)?.state ?? "ok";

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await safeAction(async () => systemSnapshotAction(workspaceId));
      if (!result.ok) throw new Error(result.error);
      setData(result.data);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("Could not read system status. Retry."));
    } finally {
      setBusy(false);
    }
  }

  const stats: Array<{
    id: string;
    label: string;
    value: string;
    detail: string;
    state: HealthState;
  }> = [
    {
      id: "service",
      label: t("Service"),
      value: t("Running"),
      detail: t("Up {uptime}", { uptime: formatUptime(health.uptimeSeconds) }),
      state: "ok",
    },
    {
      id: "database",
      label: t("Database"),
      value: formatBytes(health.database.sizeBytes + health.database.walBytes),
      detail:
        check("database") === "ok" ? t("Integrity check passed") : t("Integrity check failed"),
      state: check("database"),
    },
    {
      id: "backup",
      label: t("Last backup"),
      value: health.backup.ageSeconds == null ? t("Never") : t("{age} ago", { age: formatAge(health.backup.ageSeconds) }),
      detail: t("Keep {days} days", { days: String(health.backup.retentionDays || DEFAULT_BACKUP_RETENTION_DAYS) }),
      state: check("backup"),
    },
    {
      id: "disk",
      label: t("Free disk"),
      value: formatBytes(health.disk.freeBytes),
      detail: t("of {total}", { total: formatBytes(health.disk.totalBytes) }),
      state: check("disk"),
    },
    {
      id: "runner",
      label: t("Runners"),
      value: `${onlineRunners}/${data.runners.length}`,
      detail:
        data.runners.length === 0
          ? t("No computer has connected")
          : lastRunnerAge != null
            ? t("Last seen {age} ago", { age: formatAge(lastRunnerAge) })
            : t("Not connected"),
      state: onlineRunners > 0 || data.runners.length === 0 ? "ok" : "warn",
    },
    {
      id: "update",
      label: t("Version"),
      value: health.version,
      detail: t("Stable channel"),
      state: "ok",
    },
  ];

  const checks: Array<{ id: string; label: string; detail: string; state: HealthState }> = [
    {
      id: "database",
      label: t("Database integrity"),
      detail:
        health.database.integrity === "ok"
          ? t("SQLite quick_check passed.")
          : health.database.integrity,
      state: check("database"),
    },
    {
      id: "disk",
      label: t("Free disk"),
      detail: t("{free} free of {total} on the data volume.", {
        free: formatBytes(health.disk.freeBytes),
        total: formatBytes(health.disk.totalBytes),
      }),
      state: check("disk"),
    },
    {
      id: "wal",
      label: t("Write-ahead log"),
      detail:
        check("wal") === "ok"
          ? t("Within the expected size: {size}.", { size: formatBytes(health.database.walBytes) })
          : t("Larger than 512 MB: {size}. It should shrink after the next checkpoint.", {
              size: formatBytes(health.database.walBytes),
            }),
      state: check("wal"),
    },
    {
      id: "backup",
      label: t("Backups"),
      detail:
        health.backup.ageSeconds == null
          ? t("No backup has been recorded yet.")
          : t("Last backup was {age} ago.", { age: formatAge(health.backup.ageSeconds) }),
      state: check("backup"),
    },
  ];

  return (
    <div className="min-w-0 flex-1 overflow-auto p-6" data-testid="system-page">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-heading font-semibold">{t("System")}</h1>
            <p className="text-small text-muted">{t("Instance health, backups, updates and runners.")}</p>
          </div>
          <span
            className={`rounded-full border px-2 py-0.5 text-caption ${STATE_BADGE[health.status]}`}
            data-testid="system-overall"
          >
            {stateLabel(health.status, t)}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text disabled:opacity-50"
              data-testid="system-refresh"
            >
              <RefreshCw size={12} className={busy ? "animate-spin" : undefined} />
              {t("Refresh")}
            </button>
            <Link className="text-small text-muted underline" href={`/${workspaceId}/settings`}>
              {t("Settings")}
            </Link>
          </div>
        </header>

        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.id}
              className="rounded-lg border border-border p-3"
              data-testid={`system-stat-${stat.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-small font-medium text-muted">{stat.label}</h2>
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-caption ${STATE_BADGE[stat.state]}`}
                >
                  {stateLabel(stat.state, t)}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-title tabular-nums">{stat.value}</p>
              <p className="text-small text-muted">{stat.detail}</p>
            </div>
          ))}
        </section>

        <section className="space-y-2" data-testid="system-checks">
          <h2 className="text-title">{t("Health checks")}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {checks.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-caption ${STATE_BADGE[item.state]}`}
                >
                  {stateLabel(item.state, t)}
                </span>
                <span className="min-w-0 flex-1 text-body">
                  <span className="font-medium">{item.label}</span>
                  <span className="block break-words text-small text-muted">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <SystemUpdateSection
          workspaceId={workspaceId}
          snapshot={data}
          onSnapshot={setData}
          onError={setError}
        />

        <SystemBackupSection
          workspaceId={workspaceId}
          snapshot={data}
          isOwner={isOwner}
          onSnapshot={setData}
          onError={setError}
        />

        <SystemRunnerSection snapshot={data} />

        <section className="space-y-2" data-testid="system-diagnostics">
          <h2 className="text-title">{t("Diagnostics")}</h2>
          <p className="max-w-3xl text-body text-muted">
            {t(
              "Exports redacted configuration, the schema version, the server log and recent Agent turn logs. It contains no tasks, documents, accounts or API keys, and is capped at {size}.",
              { size: formatBytes(DIAGNOSTICS_MAX_BYTES) }
            )}
          </p>
          <a
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-small transition-colors hover:text-text"
            href={`/api/internal/${workspaceId}/ops/diagnostics`}
            data-testid="system-download-diagnostics"
          >
            <Download size={13} /> {t("Download diagnostics bundle")}
          </a>
        </section>

        <details className="rounded-lg border border-border px-3 py-2" data-testid="system-details">
          <summary className="cursor-pointer text-small font-medium text-muted">
            {t("Technical details")}
          </summary>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-small sm:grid-cols-[minmax(140px,auto)_1fr]">
            <dt className="text-muted">{t("Database file")}</dt>
            <dd className="break-all font-mono">{health.database.path}</dd>
            <dt className="text-muted">{t("Database size")}</dt>
            <dd className="font-mono tabular-nums">{formatBytes(health.database.sizeBytes)}</dd>
            <dt className="text-muted">{t("WAL")}</dt>
            <dd className="font-mono tabular-nums">{formatBytes(health.database.walBytes)}</dd>
            <dt className="text-muted">{t("Schema version")}</dt>
            <dd className="font-mono tabular-nums">
              {health.database.schemaVersion} · {t("{count} tables", { count: String(health.database.tables) })}
            </dd>
            <dt className="text-muted">{t("Uploads")}</dt>
            <dd className="font-mono tabular-nums">
              {formatBytes(health.uploads.bytes)} · {t("{count} files", { count: String(health.uploads.files) })}
            </dd>
            <dt className="text-muted">{t("Data directory")}</dt>
            <dd className="break-all font-mono">{health.disk.path}</dd>
            <dt className="text-muted">{t("Node")}</dt>
            <dd className="font-mono">{health.nodeVersion}</dd>
            <dt className="text-muted">{t("SQLite")}</dt>
            <dd className="font-mono">{health.sqliteVersion}</dd>
            <dt className="text-muted">{t("Started")}</dt>
            <dd className="font-mono tabular-nums">{health.startedAt}</dd>
            <dt className="text-muted">{t("Backup folders")}</dt>
            <dd className="font-mono tabular-nums">{health.backup.count}</dd>
            <dt className="text-muted">{t("Next scheduled backup")}</dt>
            <dd className="font-mono tabular-nums">{health.backup.nextScheduledAt}</dd>
          </dl>
        </details>
      </div>
    </div>
  );
}
