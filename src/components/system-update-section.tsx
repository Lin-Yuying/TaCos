"use client";

import { useState } from "react";
import { useLocale, useT } from "@/components/i18n-context";
import { createPreUpgradeBackupAction, systemSnapshotAction } from "@/app/ops-actions";
import { safeAction } from "@/lib/ui/safe-action";
import { DesktopUpdateDetails } from "@/components/desktop-update-details";
import { formatAge, formatBytes, type HealthState, type SystemSnapshot } from "@/lib/ops/shared";

const STATE_BADGE: Record<HealthState, string> = {
  ok: "border-border text-muted",
  warn: "border-update-border bg-update-bg text-update-text",
  fail: "border-danger text-danger",
};

function stateLabel(state: HealthState, t: (text: string) => string): string {
  return state === "fail" ? t("Blocked") : state === "warn" ? t("Review") : t("Ready");
}

export function SystemUpdateSection({
  workspaceId,
  snapshot,
  onSnapshot,
  onError,
}: {
  workspaceId: string;
  snapshot: SystemSnapshot;
  onSnapshot: (snapshot: SystemSnapshot) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState<"preflight" | "backup" | null>(null);
  const upgrade = snapshot.upgrade;
  const health = snapshot.health;
  const checkState = (id: string): HealthState =>
    upgrade.checks.find((item) => item.id === id)?.state ?? "ok";

  async function runPreflight() {
    if (busy) return;
    setBusy("preflight");
    onError(null);
    try {
      const outcome = await safeAction(async () => systemSnapshotAction(workspaceId));
      if (!outcome.ok) throw new Error(outcome.error);
      onSnapshot(outcome.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("Could not run the preflight. Retry."));
    } finally {
      setBusy(null);
    }
  }

  async function preUpgradeBackup() {
    if (busy) return;
    setBusy("backup");
    onError(null);
    try {
      const outcome = await safeAction(async () => createPreUpgradeBackupAction(workspaceId));
      if (!outcome.ok) throw new Error(outcome.error);
      onSnapshot(outcome.data);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("Could not create the pre-upgrade backup. Retry."));
    } finally {
      setBusy(null);
    }
  }

  const checks = [
    {
      id: "disk",
      label: t("Free disk"),
      detail: t("{free} free. An upgrade needs at least 1 GB.", {
        free: formatBytes(health.disk.freeBytes),
      }),
      state: checkState("disk"),
    },
    {
      id: "backup",
      label: t("Pre-upgrade backup"),
      detail:
        health.backup.ageSeconds == null
          ? t("No verified backup yet. The installer takes one before replacing the app.")
          : t("Last backup {age} ago.", { age: formatAge(health.backup.ageSeconds) }),
      state: checkState("backup"),
    },
    {
      id: "version",
      label: t("Version"),
      detail: upgrade.previousVersion
        ? upgrade.previousVersion === upgrade.currentVersion
          ? t("app.old has the same version as the running app. Upgrade again to replace it.")
          : t("Previous app: version {version}.", { version: upgrade.previousVersion })
        : t("No previous app yet. The first upgrade creates app.old."),
      state: checkState("version"),
    },
    {
      id: "rollback",
      label: t("Rollback path"),
      detail:
        upgrade.mode === "desktop"
          ? t("Desktop builds update from GitHub; app.old applies to the server.")
          : upgrade.rollbackAvailable
            ? t("app.old is present and can be restored with one command.")
            : t("No app.old yet. It is created by the next server upgrade."),
      state: checkState("rollback"),
    },
  ];

  return (
    <section className="space-y-3" data-testid="system-updates">
      <div>
        <h2 className="text-title">{t("Updates")}</h2>
        <p className="max-w-3xl text-body text-muted">
          {t(
            "Server upgrades use a release tarball and deploy/install.sh. The installer checks disk, takes a pre-upgrade backup, keeps the previous app in app.old and restarts the service."
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Current version")}</p>
          <p className="font-mono text-title tabular-nums">{upgrade.currentVersion}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Channel")}</p>
          <p className="text-title">{t("Stable")}</p>
          <p className="text-small text-muted">{t("Insider builds are not part of this release.")}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-small text-muted">{t("Rollback")}</p>
          <p className="text-title">
            {upgrade.rollbackAvailable ? t("Available") : t("Not available")}
          </p>
          <p className="text-small text-muted">
            {upgrade.previousVersion
              ? t("Previous version {version}", { version: upgrade.previousVersion })
              : t("No previous app")}
          </p>
        </div>
      </div>

      <div className="space-y-2" data-testid="upgrade-preflight">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold">{t("Upgrade preflight")}</h3>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-caption ${
              upgrade.ready ? STATE_BADGE.ok : STATE_BADGE.fail
            }`}
            data-testid="upgrade-ready"
          >
            {upgrade.ready ? t("Ready to upgrade") : t("Fix the blocked checks first")}
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void runPreflight()}
              className="rounded-md border border-border px-2.5 py-1 text-small transition-colors hover:text-text disabled:opacity-50"
              data-testid="upgrade-refresh"
            >
              {busy === "preflight" ? t("Checking…") : t("Run preflight")}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void preUpgradeBackup()}
              className="rounded-md border border-border px-2.5 py-1 text-small transition-colors hover:text-text disabled:opacity-50"
              data-testid="pre-upgrade-backup"
            >
              {busy === "backup" ? t("Backing up…") : t("Create pre-upgrade backup")}
            </button>
          </div>
        </div>
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
        {upgrade.latestPreUpgradeAt && (
          <p className="text-small text-muted">
            {t("Last pre-upgrade backup: {time}", {
              time: new Date(upgrade.latestPreUpgradeAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
            })}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-body font-medium">{t("Rollback one command")}</p>
        {upgrade.mode === "server" ? (
          <>
            <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-small" data-testid="rollback-command">
              {upgrade.rollbackCommand}
            </pre>
            <p className="mt-1 text-small text-muted">
              {t(
                "Rollback restores the previous app and its newest pre-upgrade backup. It stops the service, verifies the backup, and starts the service again. Uploaded files are not replaced."
              )}
            </p>
          </>
        ) : (
          <p className="mt-1 text-small text-muted">
            {t("Server rollback applies to the Linux server. The desktop app updates from GitHub on the stable channel.")}
          </p>
        )}
        <p className="mt-1 text-small text-muted">
          {t("Code signing stays with the owner. Unsigned desktop builds open the GitHub download page instead of updating in place.")}
        </p>
      </div>

      <DesktopUpdateDetails />
    </section>
  );
}
