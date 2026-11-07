// U-12: verified backups, retention and restore.
// - A backup is a directory with a SQLite online-backup copy, the uploads folder, and a
//   manifest naming the app version, size, hash and integrity result.
// - Restore only accepts a manifest from the same app version (decision 4), requires the
//   typed phrase RESTORE, writes a safety backup first, and re-checks integrity after the
//   swap. If the swap fails, the safety backup is put back.
// - While the database file is being replaced the whole process refuses database access,
//   so no request reads a half-written file.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { closeDb, dbMaintenanceMessage, getDb, setDbMaintenance } from "@/db/client";
import { DATA_DIR } from "@/lib/data-dir";
import { TacosError } from "@/lib/tacos-error";
import { directoryUsage } from "@/lib/storage-usage";
import {
  backupRoot,
  listBackupFiles,
  readBackupManifest,
  type BackupManifest,
} from "./backup-files";
import { recordServerEvent } from "./server-log";
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  RESTORE_PHRASE,
  type BackupCandidate,
  type BackupCandidateReason,
  type BackupRunView,
  type RestoreGate,
} from "./shared";
import { appVersion } from "./version";

export type BackupKind = "manual" | "scheduled" | "pre_upgrade" | "safety" | "restore";

const KEEP_MIN_DAYS = 1;
const KEEP_MAX_DAYS = 90;
const LOCK_STALE_MS = 30 * 60 * 1000;
const RECOGNIZED_DIR = /^(?:\d{4}-\d{2}-\d{2}|(?:manual|scheduled|pre_upgrade|safety|restore)-[A-Za-z0-9T_.-]+)$/;

function lockFile(): string {
  return path.join(backupRoot(), ".ops.lock");
}

function databaseFile(): string {
  return path.join(DATA_DIR, "tacos.db");
}

function clampRetention(days: number): number {
  return Math.max(KEEP_MIN_DAYS, Math.min(KEEP_MAX_DAYS, Math.round(days)));
}

/** The newest completed pre-upgrade snapshot, which deploy/rollback.sh relies on. */
export function latestPreUpgradeBackupAt(): string | null {
  try {
    const row = getDb().$client
      .prepare(
        "SELECT max(started_at) AS at FROM backup_runs WHERE kind = 'pre_upgrade' AND status = 'completed'"
      )
      .get() as { at: string | null } | undefined;
    return row?.at ?? null;
  } catch {
    return null;
  }
}

export async function backupRetentionDays(): Promise<number> {
  try {
    const row = getDb().$client
      .prepare("SELECT value FROM ops_settings WHERE key = 'backup_retention_days'")
      .get() as { value: string } | undefined;
    const parsed = Number(row?.value);
    if (Number.isFinite(parsed)) return clampRetention(parsed);
  } catch {
    // Fall back to the documented default when the table is unavailable.
  }
  return DEFAULT_BACKUP_RETENTION_DAYS;
}

export async function saveBackupRetentionDays(days: number): Promise<number> {
  if (!Number.isFinite(days)) throw new TacosError("Retention must be a number of days");
  const kept = clampRetention(days);
  getDb().$client
    .prepare(
      `INSERT INTO ops_settings (key, value, updated_at) VALUES ('backup_retention_days', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(String(kept), new Date().toISOString());
  recordServerEvent("info", "backup retention changed", { days: kept });
  return kept;
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

type DatabaseFacts = { integrity: string; schemaVersion: number };

export function inspectDatabase(file: string): DatabaseFacts {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    return {
      integrity: typeof integrity === "string" ? integrity : String(integrity),
      schemaVersion: Number(db.pragma("schema_version", { simple: true })) || 0,
    };
  } catch (error) {
    return {
      integrity: error instanceof Error ? error.message : "could not open database",
      schemaVersion: 0,
    };
  } finally {
    db?.close();
  }
}

/** One backup/restore at a time, across requests and processes. */
async function withOpsLock<T>(work: () => Promise<T>): Promise<T> {
  const root = backupRoot();
  await fs.promises.mkdir(root, { recursive: true });
  const file = lockFile();
  let handle: fs.promises.FileHandle | null = null;
  for (let attempt = 0; attempt < 2 && !handle; attempt += 1) {
    try {
      handle = await fs.promises.open(file, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let stale = false;
      try {
        stale = Date.now() - (await fs.promises.stat(file)).mtimeMs > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (stale) {
        await fs.promises.rm(file, { force: true });
        continue;
      }
      throw new TacosError(
        "A backup or restore is already running",
        409,
        "Wait for it to finish, then retry."
      );
    }
  }
  if (!handle) throw new TacosError("A backup or restore is already running", 409);
  try {
    await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
    return await work();
  } finally {
    await handle.close().catch(() => {});
    await fs.promises.rm(file, { force: true }).catch(() => {});
  }
}

async function copyUploads(targetDir: string): Promise<number> {
  const source = path.join(DATA_DIR, "uploads");
  let files = 0;
  try {
    const usage = await directoryUsage(source);
    files = usage.files;
    if (files > 0) {
      await fs.promises.cp(source, path.join(targetDir, "uploads"), {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files;
}

function backupName(kind: BackupKind): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `${kind}-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

function runView(row: {
  id: string;
  kind: string;
  status: string;
  version: string;
  integrity: string;
  db_bytes: number;
  uploads_bytes: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}): BackupRunView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    integrity: row.integrity,
    dbBytes: Number(row.db_bytes) || 0,
    uploadsBytes: Number(row.uploads_bytes) || 0,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function listBackupRuns(limit = 20): BackupRunView[] {
  try {
    const rows = getDb().$client
      .prepare(
        `SELECT id, kind, status, version, integrity, db_bytes, uploads_bytes, error,
                started_at, finished_at
         FROM backup_runs ORDER BY started_at DESC LIMIT ?`
      )
      .all(Math.max(1, Math.min(200, Math.floor(limit)))) as Parameters<typeof runView>[0][];
    return rows.map(runView);
  } catch {
    return [];
  }
}

function insertRun(input: {
  id: string;
  kind: BackupKind;
  status: "running" | "completed" | "failed";
  name?: string;
  version: string;
  integrity?: string;
  dbBytes?: number;
  uploadsBytes?: number;
  sha256?: string | null;
  error?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
}): void {
  getDb().$client
    .prepare(
      `INSERT INTO backup_runs
         (id, kind, status, path, version, integrity, db_bytes, uploads_bytes, sha256, error,
          started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.kind,
      input.status,
      input.name ?? "",
      input.version,
      input.integrity ?? "",
      input.dbBytes ?? 0,
      input.uploadsBytes ?? 0,
      input.sha256 ?? null,
      input.error ?? null,
      input.startedAt ?? new Date().toISOString(),
      input.finishedAt ?? null
    );
}

async function writeManifest(dir: string, manifest: BackupManifest): Promise<void> {
  const target = path.join(dir, "manifest.json");
  await fs.promises.writeFile(`${target}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.promises.rename(`${target}.tmp`, target);
}

async function createBackupLocked(
  kind: BackupKind,
  actor?: string,
  options: { prune?: boolean } = {}
): Promise<{ run: BackupRunView; name: string }> {
  const root = backupRoot();
  await fs.promises.mkdir(root, { recursive: true });
  const name = backupName(kind);
  const dir = path.join(root, name);
  await fs.promises.mkdir(dir, { recursive: true });
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const version = appVersion();
  recordServerEvent("info", "backup started", { kind, name, actor });
  try {
    // SQLite's online backup keeps the server writable while it copies.
    await getDb().$client.backup(path.join(dir, "tacos.db"));
    const uploadFiles = await copyUploads(dir);
    const facts = inspectDatabase(path.join(dir, "tacos.db"));
    if (facts.integrity !== "ok") {
      throw new TacosError(`Backup integrity check failed: ${facts.integrity}`, 500);
    }
    const dbBytes = (await fs.promises.stat(path.join(dir, "tacos.db"))).size;
    const sha256 = await hashFile(path.join(dir, "tacos.db"));
    let uploadsBytes = 0;
    try {
      uploadsBytes = (await directoryUsage(path.join(dir, "uploads"))).logical;
    } catch {
      uploadsBytes = 0;
    }
    await writeManifest(dir, {
      format: 1,
      kind,
      appVersion: version,
      createdAt: startedAt,
      integrity: facts.integrity,
      sha256,
      dbBytes,
      uploadsBytes,
      schemaVersion: facts.schemaVersion,
    });
    insertRun({
      id,
      kind,
      status: "completed",
      name,
      version,
      integrity: facts.integrity,
      dbBytes,
      uploadsBytes,
      sha256,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    if (options.prune !== false) await pruneBackups(await backupRetentionDays());
    recordServerEvent("info", "backup completed", {
      kind,
      name,
      dbBytes,
      uploadsBytes,
      uploadFiles,
      actor,
    });
    return {
      name,
      run: {
        id,
        kind,
        status: "completed",
        version,
        integrity: facts.integrity,
        dbBytes,
        uploadsBytes,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      insertRun({
        id,
        kind,
        status: "failed",
        name,
        version,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
      });
    } catch {
      // The database may already be the restored copy; the directory still explains the failure.
    }
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    recordServerEvent("error", "backup failed", { kind, name, error: message });
    throw error instanceof TacosError
      ? error
      : new TacosError(`Could not write a verified backup: ${message}`, 500);
  }
}

export async function createBackup(kind: BackupKind, actor?: string): Promise<BackupRunView> {
  return (await withOpsLock(() => createBackupLocked(kind, actor))).run;
}

export async function backupCandidates(): Promise<BackupCandidate[]> {
  const version = appVersion();
  const files = await listBackupFiles();
  return files.map((file) => {
    const manifest = file.manifest;
    let reasonCode: BackupCandidateReason | null = null;
    if (!manifest) reasonCode = "no_manifest";
    else if (manifest.appVersion !== version) reasonCode = "version_mismatch";
    else if (manifest.integrity !== "ok") reasonCode = "not_verified";
    return {
      name: file.name,
      createdAt: file.createdAt,
      dbBytes: file.dbBytes,
      uploadsBytes: file.uploadsBytes,
      version: manifest?.appVersion ?? null,
      integrity: manifest?.integrity ?? null,
      restorable: reasonCode == null,
      reasonCode,
      reason:
        reasonCode === "no_manifest"
          ? "This backup has no manifest, so its version and integrity cannot be confirmed."
          : reasonCode === "version_mismatch"
            ? `This backup was made by version ${manifest?.appVersion || "unknown"}. Restore supports this version only.`
            : reasonCode === "not_verified"
              ? "This backup did not pass its integrity check."
              : null,
    };
  });
}

function activeAgentRuns(): number {
  try {
    const row = getDb().$client
      .prepare("SELECT count(*) AS count FROM agent_runs WHERE status IN ('queued', 'running')")
      .get() as { count: number };
    return Number(row.count) || 0;
  } catch {
    return 0;
  }
}

export async function restoreGate(candidates?: BackupCandidate[]): Promise<RestoreGate> {
  const activeRuns = activeAgentRuns();
  const list = candidates ?? (await backupCandidates());
  let reasonCode: RestoreGate["reasonCode"] = null;
  if (list.every((candidate) => !candidate.restorable)) reasonCode = "no_backup";
  else if (activeRuns > 0) reasonCode = "active_runs";
  else if (dbMaintenanceMessage()) reasonCode = "maintenance";
  return {
    allowed: reasonCode == null,
    reasonCode,
    reason:
      reasonCode === "no_backup"
        ? "No verified backup from this version is available. Create a backup first."
        : reasonCode === "active_runs"
          ? `Wait for ${activeRuns} Agent run${activeRuns === 1 ? "" : "s"} to finish before restoring.`
          : reasonCode === "maintenance"
            ? "A restore is already running."
            : null,
    requiredPhrase: RESTORE_PHRASE,
    activeRuns,
  };
}

async function pruneBackups(retentionDays: number): Promise<void> {
  const root = backupRoot();
  const cutoff = Date.now() - retentionDays * 86_400_000;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !RECOGNIZED_DIR.test(entry.name)) continue;
    const dir = path.join(root, entry.name);
    try {
      if (!fs.existsSync(path.join(dir, "tacos.db"))) continue;
      const manifest = await readBackupManifest(dir);
      const createdAt = manifest ? Date.parse(manifest.createdAt) : (await fs.promises.stat(dir)).mtimeMs;
      if (!Number.isFinite(createdAt) || createdAt >= cutoff) continue;
      await fs.promises.rm(dir, { recursive: true, force: true });
      try {
        getDb().$client.prepare("DELETE FROM backup_runs WHERE path = ?").run(entry.name);
      } catch {
        // Metadata cleanup is best effort.
      }
      recordServerEvent("info", "backup pruned by retention", { name: entry.name, retentionDays });
    } catch {
      // A folder being written or already gone is not a reason to fail the backup.
    }
  }
}

async function putBackSafety(safetyDir: string): Promise<string> {
  // Replaces the live database with the safety copy and verifies it; used when the
  // selected backup turns out to be unusable after the swap began.
  await fs.promises.rm(`${databaseFile()}-wal`, { force: true });
  await fs.promises.rm(`${databaseFile()}-shm`, { force: true });
  await fs.promises.copyFile(path.join(safetyDir, "tacos.db"), databaseFile());
  return inspectDatabase(databaseFile()).integrity;
}

export type RestoreResult = {
  restored: boolean;
  safetyBackup: BackupRunView;
  safetyName: string;
  restartRequired: boolean;
  version: string;
};

export async function restoreBackup(
  name: string,
  confirmation: string,
  actor?: string
): Promise<RestoreResult> {
  if (confirmation !== RESTORE_PHRASE) {
    throw new TacosError(`Type ${RESTORE_PHRASE} to confirm the restore`, 400);
  }
  const candidates = await backupCandidates();
  const gate = await restoreGate(candidates);
  if (!gate.allowed) throw new TacosError(gate.reason ?? "Restore is not available", 409);
  const candidate = candidates.find((item) => item.name === name && item.restorable);
  if (!candidate) throw new TacosError("That backup cannot be restored", 404);
  const dir = path.join(backupRoot(), candidate.name);
  const backupDb = path.join(dir, "tacos.db");
  const precheck = inspectDatabase(backupDb);
  if (precheck.integrity !== "ok") {
    throw new TacosError(`Backup integrity check failed: ${precheck.integrity}`, 400);
  }
  return withOpsLock(async () => {
    // Re-check inside the lock: a backup could have replaced the folder since the gate ran.
    const lockedCheck = inspectDatabase(backupDb);
    if (lockedCheck.integrity !== "ok") {
      throw new TacosError(`Backup integrity check failed: ${lockedCheck.integrity}`, 400);
    }
    const manifest = await readBackupManifest(path.dirname(backupDb));
    if (manifest?.sha256) {
      const actual = await hashFile(backupDb);
      if (actual !== manifest.sha256) {
        throw new TacosError("Backup checksum does not match its manifest", 400);
      }
    }
    // Do not prune while restoring: the selected backup can be older than retention.
    const safety = await createBackupLocked("safety", actor, { prune: false });
    const safetyName = safety.name;
    const safetyDir = path.join(backupRoot(), safetyName);
    let swapped = false;
    setDbMaintenance("TaCos is restoring a backup. Retry in a moment.");
    const closeError = closeDb();
    if (closeError) {
      setDbMaintenance(null);
      throw new TacosError(`Could not close the database before restore: ${closeError}`, 500);
    }
    try {
      await fs.promises.rm(`${databaseFile()}-wal`, { force: true });
      await fs.promises.rm(`${databaseFile()}-shm`, { force: true });
      swapped = true;
      await fs.promises.copyFile(backupDb, databaseFile());
      const after = inspectDatabase(databaseFile());
      if (after.integrity !== "ok") {
        throw new TacosError(`The restored database failed its integrity check: ${after.integrity}`, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let recovered = false;
      if (swapped) {
        try {
          const integrity = await putBackSafety(safetyDir);
          recovered = integrity === "ok";
        } catch {
          recovered = false;
        }
      }
      setDbMaintenance(null);
      recordServerEvent("error", "restore failed", { backup: name, recovered, error: message });
      throw new TacosError(
        recovered
          ? `Restore failed and the safety backup was put back: ${message}`
          : `Restore failed: ${message}`,
        500
      );
    }
    setDbMaintenance(null);
    // The database is now the backup's copy, so re-record the safety backup and this
    // restore in the restored database and in its operations log.
    try {
      insertRun({
        id: safety.run.id,
        kind: "safety",
        status: "completed",
        name: safetyName,
        version: safety.run.version,
        integrity: safety.run.integrity,
        dbBytes: safety.run.dbBytes,
        uploadsBytes: safety.run.uploadsBytes,
        startedAt: safety.run.startedAt,
        finishedAt: safety.run.finishedAt,
      });
      insertRun({
        id: crypto.randomUUID(),
        kind: "restore",
        status: "completed",
        name: candidate.name,
        version: candidate.version ?? appVersion(),
        integrity: "ok",
        dbBytes: candidate.dbBytes,
        uploadsBytes: candidate.uploadsBytes ?? 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    } catch {
      // The files are restored; metadata is best effort after a swap.
    }
    recordServerEvent("info", "backup restored", { backup: name, safety: safetyName, actor });
    return {
      restored: true,
      safetyBackup: safety.run,
      safetyName,
      restartRequired: true,
      version: candidate.version ?? appVersion(),
    };
  });
}
