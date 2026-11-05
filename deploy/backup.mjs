// Copies the database with SQLite's online backup, so the server can keep writing, and keeps
// 14 days. Files people upload are copied with it, and a file unchanged since the last backup
// takes no new space. Copies stay on this server, so they protect against a bad write or a
// mistaken delete, and not against losing the machine.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire("/opt/tacos/app/");
const Database = require("better-sqlite3");

const dataDir = process.env.TACOS_DATA_DIR || "/var/lib/tacos/data";
const backupRoot = process.env.TACOS_BACKUP_DIR || "/var/lib/tacos/backups";
const KEEP = 14;

const day = new Date().toISOString().slice(0, 10);
const target = path.join(backupRoot, day);
mkdirSync(target, { recursive: true });

const db = new Database(path.join(dataDir, "tacos.db"), { readonly: true });
await db.backup(path.join(target, "tacos.db"));
db.close();

const uploads = path.join(dataDir, "uploads");
const days = readdirSync(backupRoot).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
if (existsSync(uploads)) {
  const previous = days.filter((name) => name < day).at(-1);
  const linkDest = previous ? [`--link-dest=${path.join(backupRoot, previous, "uploads")}`] : [];
  execFileSync("rsync", ["-a", "--delete", ...linkDest, `${uploads}/`, `${path.join(target, "uploads")}/`]);
}

for (const old of days.slice(0, Math.max(0, days.length - KEEP))) {
  rmSync(path.join(backupRoot, old), { recursive: true, force: true });
}
console.log(`backup ${target} done, ${Math.min(days.length, KEEP)} kept`);
