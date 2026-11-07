// U-12: types and formatting shared by the System page and its server actions.
// No database imports here: client components import these values.

export type HealthState = "ok" | "warn" | "fail";

export type SystemCheck = {
  id: "database" | "disk" | "wal" | "backup";
  state: HealthState;
};

export type SystemHealth = {
  status: HealthState;
  version: string;
  channel: "stable";
  nodeVersion: string;
  sqliteVersion: string;
  uptimeSeconds: number;
  startedAt: string;
  mode: "server" | "desktop";
  database: {
    path: string;
    sizeBytes: number;
    walBytes: number;
    integrity: string;
    schemaVersion: number;
    tables: number;
  };
  uploads: { bytes: number; files: number };
  disk: { freeBytes: number; totalBytes: number; path: string };
  backup: {
    lastRunAt: string | null;
    ageSeconds: number | null;
    count: number;
    retentionDays: number;
    nextScheduledAt: string;
  };
  runner: { total: number; online: number; lastSeenAt: string | null; lastSeenAgeSeconds: number | null };
  update: {
    currentVersion: string;
    previousVersion: string | null;
    rollbackAvailable: boolean;
    channel: "stable";
    unsigned: boolean | null;
  };
  service: { running: boolean; mode: "server" | "desktop" };
  checks: SystemCheck[];
};

export type BackupRunView = {
  id: string;
  kind: string;
  status: string;
  version: string;
  integrity: string;
  dbBytes: number;
  uploadsBytes: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type BackupCandidateReason = "no_manifest" | "version_mismatch" | "not_verified";

export type BackupCandidate = {
  name: string;
  createdAt: string;
  dbBytes: number;
  uploadsBytes: number | null;
  version: string | null;
  integrity: string | null;
  restorable: boolean;
  reasonCode: BackupCandidateReason | null;
  reason: string | null;
};

export type RestoreGate = {
  allowed: boolean;
  reasonCode: "active_runs" | "no_backup" | "maintenance" | null;
  reason: string | null;
  requiredPhrase: string;
  activeRuns: number;
};

export type UpgradeCheckId = "disk" | "backup" | "version" | "rollback";

export type UpgradeCheck = { id: UpgradeCheckId; state: HealthState };

export type UpgradeStatus = {
  currentVersion: string;
  channel: "stable";
  mode: "server" | "desktop";
  appRoot: string;
  previousVersion: string | null;
  rollbackAvailable: boolean;
  rollbackCommand: string;
  latestPreUpgradeAt: string | null;
  ready: boolean;
  checkedAt: string;
  checks: UpgradeCheck[];
};

export type RunnerHarness = {
  id: string;
  label: string;
  ready: boolean;
  version: string | null;
  error: string | null;
};

export type RunnerRunError = {
  id: string;
  status: string;
  error: string;
  finishedAt: string | null;
};

export type RunnerAdminRow = {
  userId: string;
  displayName: string;
  username: string;
  online: boolean;
  lastSeenAt: string | null;
  lastSeenAgeSeconds: number | null;
  harnesses: RunnerHarness[];
  recentErrors: RunnerRunError[];
};

export type SystemSnapshot = {
  health: SystemHealth;
  backups: BackupRunView[];
  candidates: BackupCandidate[];
  retentionDays: number;
  restoreGate: RestoreGate;
  upgrade: UpgradeStatus;
  runners: RunnerAdminRow[];
};

export const RESTORE_PHRASE = "RESTORE";

export const DIAGNOSTICS_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_BACKUP_RETENTION_DAYS = 14;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(0, minutes)}m`;
}

/** "3h ago" style age that never needs a locale suffix; the page passes its own labels. */
export function formatAge(seconds: number | null): string {
  if (seconds == null) return "never";
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
