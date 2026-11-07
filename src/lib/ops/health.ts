// U-12: one snapshot of everything the System page and /api/health report.
// Reads aggregate numbers only. No account row, task, document or secret is included.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb } from "@/db/client";
import { DATA_DIR } from "@/lib/data-dir";
import { isServerMode } from "@/lib/server-mode";
import { UPDATE_CHANNEL, appVersion, rollbackState } from "./version";
import { listBackupFiles, nextBackupAt } from "./backup-files";
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  type HealthState,
  type SystemCheck,
  type SystemHealth,
} from "./shared";

const OFFLINE_AFTER_MS = 70_000;
const QUICK_CHECK_TTL_MS = 60_000;
const GIB = 1024 * 1024 * 1024;

type CachedCheck = { at: number; value: string };

function healthCache(): { quick?: CachedCheck } {
  const holder = globalThis as { __tacosHealthCache?: { quick?: CachedCheck } };
  holder.__tacosHealthCache ??= {};
  return holder.__tacosHealthCache;
}

export function resetHealthCache(): void {
  delete (globalThis as { __tacosHealthCache?: { quick?: CachedCheck } }).__tacosHealthCache;
}

/** Health polling runs every few seconds, so the cheap check is cached for a minute. */
function quickIntegrityCheck(): string {
  const cache = healthCache();
  if (cache.quick && Date.now() - cache.quick.at < QUICK_CHECK_TTL_MS) return cache.quick.value;
  let value = "unavailable";
  try {
    const result = getDb().$client.pragma("quick_check", { simple: true });
    value = typeof result === "string" ? result : String(result);
  } catch (error) {
    value = error instanceof Error ? error.message : "check failed";
  }
  cache.quick = { at: Date.now(), value };
  return value;
}

export function fullIntegrityCheck(file?: string): string {
  // Opening the live handle is fine here: SQLite serializes the pragma with writes.
  if (!file) {
    try {
      const result = getDb().$client.pragma("integrity_check", { simple: true });
      return typeof result === "string" ? result : String(result);
    } catch (error) {
      return error instanceof Error ? error.message : "check failed";
    }
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const result = db.pragma("integrity_check", { simple: true });
    return typeof result === "string" ? result : String(result);
  } catch (error) {
    return error instanceof Error ? error.message : "check failed";
  } finally {
    db?.close();
  }
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return 0;
  }
}

async function diskSpace(dir: string): Promise<{ freeBytes: number; totalBytes: number }> {
  try {
    const stat = await fs.promises.statfs(dir);
    return {
      freeBytes: Number(stat.bavail) * Number(stat.bsize),
      totalBytes: Number(stat.blocks) * Number(stat.bsize),
    };
  } catch {
    return { freeBytes: 0, totalBytes: 0 };
  }
}

function schemaInfo(): { schemaVersion: number; tables: number; sqliteVersion: string } {
  try {
    const db = getDb().$client;
    const tables = db
      .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'")
      .get() as { count: number };
    const sqlite = db.prepare("SELECT sqlite_version() AS version").get() as { version: string };
    return {
      schemaVersion: Number(db.pragma("schema_version", { simple: true })) || 0,
      tables: Number(tables.count) || 0,
      sqliteVersion: sqlite.version,
    };
  } catch {
    return { schemaVersion: 0, tables: 0, sqliteVersion: "unknown" };
  }
}

function runnerCounts(now: number): {
  total: number;
  online: number;
  lastSeenAt: string | null;
  lastSeenAgeSeconds: number | null;
} {
  try {
    const rows = getDb().$client
      .prepare("SELECT last_seen_at AS lastSeenAt FROM runner_status")
      .all() as Array<{ lastSeenAt: string }>;
    const online = rows.filter((row) => now - new Date(row.lastSeenAt).getTime() < OFFLINE_AFTER_MS);
    const lastSeenAt = rows.reduce<string | null>(
      (latest, row) => (latest == null || row.lastSeenAt > latest ? row.lastSeenAt : latest),
      null
    );
    return {
      total: rows.length,
      online: online.length,
      lastSeenAt,
      lastSeenAgeSeconds: lastSeenAt
        ? Math.max(0, Math.floor((now - Date.parse(lastSeenAt)) / 1000))
        : null,
    };
  } catch {
    return { total: 0, online: 0, lastSeenAt: null, lastSeenAgeSeconds: null };
  }
}

function uploadsAggregate(): { bytes: number; files: number } {
  try {
    const row = getDb().$client
      .prepare("SELECT count(*) AS files, coalesce(sum(size), 0) AS bytes FROM attachments")
      .get() as { files: number; bytes: number };
    return { files: Number(row.files) || 0, bytes: Number(row.bytes) || 0 };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

function makeChecks(input: {
  integrity: string;
  walBytes: number;
  freeBytes: number;
  backupAgeSeconds: number | null;
}): SystemCheck[] {
  const freeGb = input.freeBytes / GIB;
  return [
    { id: "database", state: input.integrity === "ok" ? "ok" : "fail" },
    { id: "disk", state: freeGb < 1 ? "fail" : freeGb < 5 ? "warn" : "ok" },
    { id: "wal", state: input.walBytes > 512 * 1024 * 1024 ? "warn" : "ok" },
    {
      id: "backup",
      state:
        input.backupAgeSeconds == null || input.backupAgeSeconds > 2 * 86_400 ? "warn" : "ok",
    },
  ];
}

function statusOf(checks: SystemCheck[]): HealthState {
  if (checks.some((check) => check.state === "fail")) return "fail";
  if (checks.some((check) => check.state === "warn")) return "warn";
  return "ok";
}

export async function systemHealth(options: { retentionDays?: number } = {}): Promise<SystemHealth> {
  const now = Date.now();
  const retentionDays = options.retentionDays ?? DEFAULT_BACKUP_RETENTION_DAYS;
  const dbFile = path.join(DATA_DIR, "tacos.db");
  const [sizeBytes, walBytes, disk, backups] = await Promise.all([
    fileSize(dbFile),
    fileSize(`${dbFile}-wal`),
    diskSpace(DATA_DIR),
    listBackupFiles(),
  ]);
  const schema = schemaInfo();
  const integrity = quickIntegrityCheck();
  const runner = runnerCounts(now);
  const uploads = uploadsAggregate();
  const latest = backups[0] ?? null;
  const lastRunAt = latest?.createdAt ?? null;
  const ageSeconds = lastRunAt ? Math.max(0, Math.floor((now - Date.parse(lastRunAt)) / 1000)) : null;
  const rollback = rollbackState();
  const checks = makeChecks({ integrity, walBytes, freeBytes: disk.freeBytes, backupAgeSeconds: ageSeconds });
  const mode = isServerMode() ? "server" : "desktop";
  return {
    status: statusOf(checks),
    version: appVersion(),
    channel: UPDATE_CHANNEL,
    nodeVersion: process.version,
    sqliteVersion: schema.sqliteVersion,
    uptimeSeconds: Math.floor(process.uptime()),
    startedAt: new Date(now - process.uptime() * 1000).toISOString(),
    mode,
    database: {
      path: dbFile,
      sizeBytes,
      walBytes,
      integrity,
      schemaVersion: schema.schemaVersion,
      tables: schema.tables,
    },
    uploads,
    disk: { freeBytes: disk.freeBytes, totalBytes: disk.totalBytes, path: DATA_DIR },
    backup: {
      lastRunAt,
      ageSeconds,
      count: backups.length,
      retentionDays,
      nextScheduledAt: nextBackupAt(new Date(now)),
    },
    runner,
    update: {
      currentVersion: appVersion(),
      previousVersion: rollback.previousVersion,
      rollbackAvailable: rollback.available,
      channel: UPDATE_CHANNEL,
      unsigned: null,
    },
    service: { running: true, mode },
    checks,
  };
}

/** The public health payload: no absolute paths, identities or configuration values. */
export async function publicHealth(): Promise<Record<string, unknown>> {
  const health = await systemHealth();
  return {
    status: health.status,
    version: health.version,
    channel: health.channel,
    mode: health.mode,
    uptimeSeconds: health.uptimeSeconds,
    database: {
      ok: health.database.integrity === "ok",
      integrity: health.database.integrity,
      sizeBytes: health.database.sizeBytes,
      walBytes: health.database.walBytes,
      schemaVersion: health.database.schemaVersion,
    },
    disk: { freeBytes: health.disk.freeBytes },
    backup: { lastRunAt: health.backup.lastRunAt, ageSeconds: health.backup.ageSeconds },
    runner: { total: health.runner.total, online: health.runner.online },
    update: { channel: health.update.channel, currentVersion: health.update.currentVersion },
  };
}
