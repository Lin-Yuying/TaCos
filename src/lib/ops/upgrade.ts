// U-12: server upgrade preflight and rollback state. Read-only: this module never
// downloads a release or controls a runner. The installer does the upgrade; the System
// page shows whether the documented steps have what they need.
import { isServerMode } from "@/lib/server-mode";
import { appRoot, appVersion, rollbackState, UPDATE_CHANNEL, ROLLBACK_COMMAND } from "./version";
import type {
  BackupCandidate,
  SystemHealth,
  UpgradeCheck,
  UpgradeStatus,
} from "./shared";

const GIB = 1024 * 1024 * 1024;

export function upgradeChecks(input: {
  freeBytes: number;
  latestBackupAt: string | null;
  previousVersion: string | null;
  rollbackAvailable: boolean;
  mode: "server" | "desktop";
  now?: number;
}): UpgradeCheck[] {
  const now = input.now ?? Date.now();
  const freeGb = input.freeBytes / GIB;
  const backupAgeMs = input.latestBackupAt ? now - Date.parse(input.latestBackupAt) : null;
  return [
    { id: "disk", state: freeGb < 1 ? "fail" : freeGb < 2 ? "warn" : "ok" },
    {
      id: "backup",
      state:
        backupAgeMs == null || !Number.isFinite(backupAgeMs) || backupAgeMs > 7 * 86_400_000
          ? "warn"
          : "ok",
    },
    {
      id: "version",
      state:
        input.previousVersion != null && input.previousVersion === appVersion() ? "warn" : "ok",
    },
    {
      id: "rollback",
      // A desktop build has no app.old; it updates through the desktop channel.
      state: input.mode === "desktop" ? "ok" : input.rollbackAvailable ? "ok" : "warn",
    },
  ];
}

export function buildUpgradeStatus(input: {
  health: SystemHealth;
  candidates: BackupCandidate[];
  latestPreUpgradeAt: string | null;
  now?: number;
}): UpgradeStatus {
  const mode = isServerMode() ? "server" : "desktop";
  const rollback = rollbackState();
  const latestBackupAt =
    input.candidates.find((candidate) => candidate.restorable)?.createdAt ??
    input.health.backup.lastRunAt;
  const checks = upgradeChecks({
    freeBytes: input.health.disk.freeBytes,
    latestBackupAt,
    previousVersion: rollback.previousVersion,
    rollbackAvailable: rollback.available,
    mode,
    now: input.now,
  });
  return {
    currentVersion: appVersion(),
    channel: UPDATE_CHANNEL,
    mode,
    appRoot: appRoot(),
    previousVersion: rollback.previousVersion,
    rollbackAvailable: rollback.available,
    rollbackCommand: ROLLBACK_COMMAND,
    latestPreUpgradeAt: input.latestPreUpgradeAt,
    ready: !checks.some((check) => check.state === "fail"),
    checkedAt: new Date(input.now ?? Date.now()).toISOString(),
    checks,
  };
}
