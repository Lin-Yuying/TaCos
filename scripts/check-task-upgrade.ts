/** A pre-2.3 task database must migrate before its new parent index is created. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-task-upgrade-"));
const env = { ...process.env, TACOS_DATA_DIR: dir };
const boot = () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./src/db/client.ts').then(m=>m.getDb())"], { env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
};
try {
  boot();
  const db = new Database(path.join(dir, "tacos.db"));
  db.exec("DROP INDEX issues_parent_idx; ALTER TABLE issues DROP COLUMN parent_id");
  const before = db.prepare("SELECT count(*) n FROM issues").get() as { n: number };
  db.close();
  boot();
  const migrated = new Database(path.join(dir, "tacos.db"));
  const after = migrated.prepare("SELECT count(*) n FROM issues WHERE parent_id IS NULL").get() as { n: number };
  if (before.n !== after.n) throw new Error("Task rows changed during upgrade");
  if (!migrated.prepare("SELECT name FROM sqlite_master WHERE name='issues_parent_idx'").get()) throw new Error("Parent index missing");
  migrated.close();
  console.log("check-task-upgrade: pass");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
