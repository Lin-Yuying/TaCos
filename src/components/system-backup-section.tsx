"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useLocale, useT } from "@/components/i18n-context";
import {
  runBackupAction,
  restoreBackupAction,
  saveBackupRetentionAction,
} from "@/app/ops-actions";
import { safeAction } from "@/lib/ui/safe-action";
import { formatAge, formatBytes, type BackupCandidate, type SystemSnapshot } from "@/lib/ops/shared";

const KIND_LABEL: Record<string, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  pre_upgrade: "Pre-upgrade",
  safety: "Safety",
  restore: "Restore",
};

const STATE_LABEL: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

function when(iso: string, locale: "en" | "zh"): string {
  return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SystemBackupSection({
  workspaceId,
  snapshot,
  isOwner,
  onSnapshot,
  onError,
}: {
  workspaceId: string;
  snapshot: SystemSnapshot;
  isOwner: boolean;
  onSnapshot: (snapshot: SystemSnapshot) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState<"backup" | "retention" | "restore" | null>(null);
  const [retention, setRetention] = useState(String(snapshot.retentionDays));
  const [target, setTarget] = useState<BackupCandidate | null>(null);
  const [phrase, setPhrase] = useState("");
  const [result, setResult] = useState<{ safetyName: string } | null>(null);
  const gate = snapshot.restoreGate;

  async function backupNow() {
    if (busy) return;
    setBusy("backup");
    onError(null);
    try {
      const outcome = await safeAction(async () => runBackupAction(workspaceId));
      if (!outcome.ok) throw new Error(outcome.error);
      onSnapshot(outcome.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("Could not create the backup. Retry."));
    } finally {
      setBusy(null);
    }
  }

  async function saveRetention() {
    if (busy) return;
    setBusy("retention");
    onError(null);
    try {
      const outcome = await safeAction(async () =>
        saveBackupRetentionAction(workspaceId, Number(retention))
      );
      if (!outcome.ok) throw new Error(outcome.error);
      onSnapshot(outcome.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("Could not save retention. Retry."));
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!target || busy) return;
    setBusy("restore");
    onError(null);
    try {
      const outcome = await safeAction(async () =>
        restoreBackupAction(workspaceId, target.name, phrase)
      );
      if (!outcome.ok) throw new Error(outcome.error);
      onSnapshot(outcome.data.snapshot);
      setResult({ safetyName: outcome.data.result.safetyName });
      setTarget(null);
      setPhrase("");
    } catch (error) {
      onError(error instanceof Error ? error.message : t("Could not restore the backup. Retry."));
    } finally {
      setBusy(null);
    }
  }

  const gateReason =
    gate.reasonCode === "no_backup"
      ? t("No verified backup from this version is available. Create a backup first.")
      : gate.reasonCode === "active_runs"
        ? t("Wait for {count} Agent runs to finish before restoring.", {
            count: String(gate.activeRuns),
          })
        : gate.reasonCode === "maintenance"
          ? t("A restore is already running.")
          : null;

  return (
    <section className="space-y-3" data-testid="system-backup">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-title">{t("Backups")}</h2>
          <p className="max-w-3xl text-body text-muted">
            {t(
              "A verified copy of the database and uploads. The daily timer keeps the newest {days} days.",
              { days: String(snapshot.retentionDays) }
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void backupNow()}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors disabled:opacity-50 bg-bg text-text hover:bg-active"
          data-testid="backup-now"
        >
          {busy === "backup" ? t("Backing up…") : t("Back up now")}
        </button>
      </div>

      {result && (
        <div
          role="status"
          className="rounded-lg border border-update-border bg-update-bg px-3 py-2 text-small text-update-text"
          data-testid="restore-result"
        >
          <p className="font-medium">{t("Backup restored.")}</p>
          <p className="mt-1">
            {t("Restart TaCos to finish:")}{" "}
            <code className="rounded bg-bg px-1 py-0.5 font-mono">sudo systemctl restart tacos</code>{" "}
            {t("on a server, or quit and reopen the desktop app.")}
          </p>
          <p className="mt-1">{t("Safety backup kept: {name}", { name: result.safetyName })}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Last backup")}</p>
          <p className="font-mono text-title tabular-nums">
            {snapshot.health.backup.ageSeconds == null
              ? t("Never")
              : t("{age} ago", { age: formatAge(snapshot.health.backup.ageSeconds) })}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Next scheduled backup")}</p>
          <p className="font-mono text-title tabular-nums">{when(snapshot.health.backup.nextScheduledAt, locale)}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Backup folders")}</p>
          <p className="font-mono text-title tabular-nums">{snapshot.health.backup.count}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3" data-testid="backup-retention">
        <p className="text-small font-medium">{t("Retention")}</p>
        {isOwner ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-small">
            <label htmlFor="backup-retention-days">{t("Keep backups for")}</label>
            <input
              id="backup-retention-days"
              type="number"
              min={1}
              max={90}
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
              className="h-[34px] rounded-lg px-2.5 w-20 border border-border-strong bg-bg text-body tabular-nums"
            />
            <span>{t("days")}</span>
            <button
              type="button"
              disabled={busy != null || retention === String(snapshot.retentionDays)}
              onClick={() => void saveRetention()}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border transition-colors disabled:opacity-50 bg-bg text-text hover:bg-active"
            >
              {t("Save")}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-small text-muted">
            {t("The workspace owner sets retention.")}
          </p>
        )}
        <p className="mt-2 text-small text-muted">
          {t("Older backup folders are deleted after this many days. A new backup is always kept.")}
        </p>
      </div>

      <div className="space-y-2" data-testid="backup-list">
        <h3 className="text-body font-semibold">{t("Available backups")}</h3>
        {gateReason && (
          <p className="rounded-md border border-border px-3 py-2 text-small text-muted">
            {t("Restore is not available: {reason}", { reason: gateReason })}
          </p>
        )}
        {snapshot.candidates.length === 0 ? (
          <p className="text-small text-muted">{t("No backups yet. Run one before an upgrade.")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {snapshot.candidates.slice(0, 12).map((candidate) => (
              <li
                key={candidate.name}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-body tabular-nums">{when(candidate.createdAt, locale)}</span>
                  <span className="block text-muted">
                    {formatBytes(candidate.dbBytes)} · {t("version {version}", {
                      version: candidate.version ?? t("unknown"),
                    })}{" "}
                    · {candidate.integrity === "ok" ? t("verified") : t("not verified")}
                  </span>
                  {candidate.reasonCode === "version_mismatch" && (
                    <span className="block text-muted">
                      {t("Made by version {version}. Restore supports this version only.", {
                        version: candidate.version ?? t("unknown"),
                      })}
                    </span>
                  )}
                  {candidate.reasonCode === "no_manifest" && (
                    <span className="block text-muted">
                      {t("No manifest: version and integrity cannot be confirmed.")}
                    </span>
                  )}
                  {candidate.reasonCode === "not_verified" && (
                    <span className="block text-muted">{t("Integrity check did not pass.")}</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={!isOwner || !candidate.restorable || !gate.allowed || busy != null}
                  title={
                    !isOwner
                      ? t("Only the workspace owner can restore a backup.")
                      : !gate.allowed
                        ? gateReason ?? undefined
                        : !candidate.restorable
                          ? candidate.reason ?? undefined
                          : undefined
                  }
                  onClick={() => {
                    setPhrase("");
                    setTarget(candidate);
                  }}
                  className="rounded-md border border-danger px-2 py-1 text-danger transition-colors hover:bg-danger hover:text-bg disabled:border-border disabled:text-muted disabled:hover:bg-transparent"
                  data-testid={`restore-${candidate.name}`}
                >
                  {t("Restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!isOwner && (
          <p className="text-small text-muted">{t("Only the workspace owner can restore a backup.")}</p>
        )}
      </div>

      <details className="rounded-lg border border-border px-3 py-2">
        <summary className="cursor-pointer text-small font-medium text-muted">
          {t("Recent backup runs")}
        </summary>
        {snapshot.backups.length === 0 ? (
          <p className="mt-2 text-small text-muted">{t("No backup runs yet.")}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-small">
            {snapshot.backups.slice(0, 12).map((run) => (
              <li key={run.id} className="flex flex-wrap gap-x-2">
                <span className="w-44 shrink-0 font-mono tabular-nums">{when(run.startedAt, locale)}</span>
                <span className="w-24 shrink-0">{t(KIND_LABEL[run.kind] ?? run.kind)}</span>
                <span className={run.status === "failed" ? "text-danger" : "text-muted"}>
                  {t(STATE_LABEL[run.status] ?? run.status)}
                </span>
                {run.error && <span className="min-w-0 flex-1 break-words text-danger">{run.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>

      <Modal
        open={target != null}
        onClose={() => {
          if (busy === "restore") return;
          setTarget(null);
          setPhrase("");
        }}
        title={t("Restore backup")}
      >
        {target && (
          <div className="space-y-3" data-testid="restore-dialog">
            <h2 className="text-title font-semibold">{t("Restore this backup?")}</h2>
            <div className="text-body text-muted">
              <p>{t("A safety backup is created automatically before anything is replaced.")}</p>
              <p>{t("The server must be restarted after the restore.")}</p>
            </div>
            <p className="text-body">
              {t(
                "This replaces the current database with the backup from {when}. Everyone else must stop editing first. Changes made after the safety backup are lost.",
                { when: when(target.createdAt, locale) }
              )}
            </p>
            <div className="rounded-md border border-border bg-surface px-3 py-2 text-small tabular-nums">
              {when(target.createdAt, locale)} · {t("version {version}", { version: target.version ?? t("unknown") })} · {target.integrity === "ok" ? t("verified") : t("not verified")}
            </div>
            <label className="block text-small" htmlFor="restore-confirm">
              {t("Type {phrase} to confirm", { phrase: gate.requiredPhrase })}
            </label>
            <input
              id="restore-confirm"
              autoComplete="off"
              autoFocus
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body"
              data-testid="restore-confirm"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy === "restore"}
                onClick={() => {
                  setTarget(null);
                  setPhrase("");
                }}
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border bg-bg text-text hover:bg-active"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                disabled={busy === "restore" || phrase !== gate.requiredPhrase}
                onClick={() => void restore()}
                className="rounded-md bg-danger px-3 py-1.5 text-small font-medium text-bg disabled:opacity-50"
                data-testid="restore-submit"
              >
                {busy === "restore" ? t("Restoring…") : t("Restore backup")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
