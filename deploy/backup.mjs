// Copies the database with SQLite's online backup, verifies the copy and writes a manifest
// next to it. The in-app System page reads the same manifest, so a backup made by the timer
// can be restored from the UI. Upload files are copied with hard links so an unchanged file
// uses no new space.
//
// Usage: node backup.mjs [--kind=scheduled|pre_upgrade]
// The daily timer runs it without arguments; deploy/install.sh runs --kind=pre_upgrade
// before it replaces /opt/tacos/app.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const appRoot = process.env.TACOS_APP_ROOT || "/opt/tacos/app";
const require = createRequire(path.join(appRoot, "package.json"));
const Database = require("better-sqlite3");

const dataDir = process.env.TACOS_DATA_DIR || "/var/lib/tacos/data";
const backupRoot = process.env.TACOS_BACKUP_DIR || "/var/lib/tacos/backups";
const KEEP = Math.max(1, Math.min(90, Number(process.env.TACOS_BACKUP_KEEP_DAYS) || 14));
const kind = (process.argv.find((arg) => arg.startsWith("--kind=")) || "").slice("--kind=".length) || "scheduled";
const now = new Date();
const createdAt = now.toISOString();
const stamp = createdAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const day = createdAt.slice(0, 10);
const target =
  kind === "pre_upgrade"
    ? path.join(backupRoot, `pre_upgrade-${stamp}-${crypto.randomBytes(2).toString("hex")}`)
    : path.join(backupRoot, day);

let version = "unknown";
try {
  version = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")).version || "unknown";
} catch {
  version = "unknown";
}

function fail(message) {
  console.error(`[backup] ${message}`);
  process.exit(1);
}

function integrity(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const result = db.pragma("integrity_check", { simple: true });
    return typeof result === "string" ? result : String(result);
  } catch (error) {
    return error && error.message ? error.message : "could not open database";
  } finally {
    db?.close();
  }
}

function schemaVersion(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    return Number(db.pragma("schema_version", { simple: true })) || 0;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

function sizeOf(dir) {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      try {
        total += statSync(path.join(entry.parentPath || dir, entry.name)).size;
      } catch {
        // A file that vanished mid-scan does not change the backup's validity.
      }
    }
  } catch {
    return 0;
  }
  return total;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function record(row) {
  let db;
  try {
    db = new Database(path.join(dataDir, "tacos.db"));
    db.exec(`CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '', integrity TEXT NOT NULL DEFAULT '',
      db_bytes INTEGER NOT NULL DEFAULT 0, uploads_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT, error TEXT, started_at TEXT NOT NULL, finished_at TEXT
    )`);
    db.prepare("DELETE FROM backup_runs WHERE path = ?").run(row.path);
    db.prepare(
      `INSERT INTO backup_runs
         (id, kind, status, path, version, integrity, db_bytes, uploads_bytes, sha256, error,
          started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.kind,
      row.status,
      row.path,
      row.version,
      row.integrity,
      row.dbBytes,
      row.uploadsBytes,
      row.sha256,
      row.error,
      row.startedAt,
      row.finishedAt
    );
  } catch (error) {
    // The backup itself is what matters; metadata only drives the System page.
    console.error(`[backup] could not record the run: ${error.message}`);
  } finally {
    db?.close();
  }
}

if (!existsSync(path.join(dataDir, "tacos.db"))) fail(`no database at ${path.join(dataDir, "tacos.db")}`);
mkdirSync(target, { recursive: true });
rmSync(path.join(target, "tacos.db"), { force: true });

let db;
try {
  db = new Database(path.join(dataDir, "tacos.db"), { readonly: true });
  await db.backup(path.join(target, "tacos.db"));
} catch (error) {
  fail(`database backup failed: ${error.message}`);
} finally {
  db?.close();
}

const check = integrity(path.join(target, "tacos.db"));
if (check !== "ok") {
  rmSync(target, { recursive: true, force: true });
  fail(`backup integrity check failed: ${check}`);
}

const uploads = path.join(dataDir, "uploads");
if (existsSync(uploads)) {
  const days = readdirSync(backupRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < day)
    .sort();
  const previous = days.at(-1);
  const linkDest = previous ? [`--link-dest=${path.join(backupRoot, previous, "uploads")}`] : [];
  try {
    execFileSync("rsync", ["-a", "--delete", ...linkDest, `${uploads}/`, `${path.join(target, "uploads")}/`]);
  } catch (error) {
    fail(`uploads copy failed: ${error.message}`);
  }
}

const dbBytes = statSync(path.join(target, "tacos.db")).size;
const uploadsBytes = sizeOf(path.join(target, "uploads"));
const sha256 = await hashFile(path.join(target, "tacos.db"));
const manifest = {
  format: 1,
  kind,
  appVersion: version,
  createdAt,
  integrity: check,
  sha256,
  dbBytes,
  uploadsBytes,
  schemaVersion: schemaVersion(path.join(target, "tacos.db")),
};
writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
record({
  id: crypto.randomUUID(),
  kind,
  status: "completed",
  path: path.basename(target),
  version,
  integrity: check,
  dbBytes,
  uploadsBytes,
  sha256,
  error: null,
  startedAt: createdAt,
  finishedAt: new Date().toISOString(),
});

// Retention: date folders and pre-upgrade snapshots older than KEEP days. Manual/safety
// folders are pruned by the app with the same setting.
const cutoff = Date.now() - KEEP * 86_400_000;
let kept = 0;
for (const name of readdirSync(backupRoot)) {
  const full = path.join(backupRoot, name);
  let isDir = false;
  try {
    isDir = statSync(full).isDirectory();
  } catch {
    continue;
  }
  if (!isDir || !(/^\d{4}-\d{2}-\d{2}$/.test(name) || name.startsWith("pre_upgrade-"))) continue;
  if (!existsSync(path.join(full, "tacos.db"))) continue;
  let at = statSync(full).mtimeMs;
  try {
    at = Date.parse(JSON.parse(readFileSync(path.join(full, "manifest.json"), "utf8")).createdAt) || at;
  } catch {
    // Date-named folders from older releases have no manifest.
  }
  if (at < cutoff) rmSync(full, { recursive: true, force: true });
  else kept += 1;
}
console.log(`backup ${target} done, integrity ${check}, ${kept} kept (kind ${kind}, version ${version})`);
