/**
 * U-12: backup and restore round-trip on a temp database.
 * Covers: verified backup + manifest + backup_runs, same-version candidates, typed
 * confirmation, safety backup before restore, data restored, corrupt backup rejected,
 * retention pruning, the one-at-a-time lock and the fail-fast maintenance guard.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-backup-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_BACKUP_DIR = path.join(root, "backups");
process.env.TACOS_APP_ROOT = path.join(root, "app");
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb, setDbMaintenance, closeDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const backups = await import("../src/lib/ops/backups");
  const { appVersion } = await import("../src/lib/ops/version");
  const { RESTORE_PHRASE } = await import("../src/lib/ops/shared");

  fs.mkdirSync(process.env.TACOS_APP_ROOT!, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.TACOS_APP_ROOT!, "package.json"),
    JSON.stringify({ version: appVersion() })
  );

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values({ id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "admin", createdAt: now })
    .run();
  db.insert(schema.workspaces)
    .values({ id: "ws", name: "Workspace", key: "WS", createdBy: "owner", createdAt: now })
    .run();
  db.insert(schema.workspaceMembers)
    .values({ workspaceId: "ws", userId: "owner", role: "admin", createdAt: now })
    .run();

  // --- 1. a verified backup ---------------------------------------------------------
  const first = await backups.createBackup("manual", "owner");
  assert.equal(first.status, "completed", "backup completes");
  assert.equal(first.integrity, "ok", "backup passes integrity_check");
  assert.ok(first.dbBytes > 0, "backup records a database size");
  const candidate = (await backups.backupCandidates()).find((row) => row.restorable);
  assert.ok(candidate, "the backup is restorable");
  assert.equal(candidate!.version, appVersion(), "manifest records this app version");
  assert.equal(candidate!.integrity, "ok", "manifest records the integrity result");
  const dir = path.join(process.env.TACOS_BACKUP_DIR!, candidate!.name);
  assert.ok(fs.existsSync(path.join(dir, "tacos.db")), "backup holds a database copy");
  assert.ok(fs.existsSync(path.join(dir, "manifest.json")), "backup holds a manifest");
  assert.equal(backups.listBackupRuns().length, 1, "backup_runs records the completed run");
  assert.equal((await backups.restoreGate()).allowed, true, "restore is allowed with no active runs");

  // --- 2. typed confirmation is enforced --------------------------------------------
  db.insert(schema.projects)
    .values({ id: "after", workspaceId: "ws", name: "After backup", key: "AFTER", createdBy: "owner", createdAt: now })
    .run();
  await assert.rejects(
    backups.restoreBackup(candidate!.name, "restore", "owner"),
    /Type RESTORE/,
    "wrong confirmation is rejected"
  );
  assert.equal(getDb().select().from(schema.projects).all().length, 1, "rejected restore changes nothing");

  // --- 3. restore brings the data back with a safety backup --------------------------
  const result = await backups.restoreBackup(candidate!.name, RESTORE_PHRASE, "owner");
  assert.equal(result.restored, true, "restore reports success");
  assert.equal(result.restartRequired, true, "restore asks for a restart");
  assert.ok(result.safetyName.startsWith("safety-"), "a safety backup was created");
  assert.ok(
    fs.existsSync(path.join(process.env.TACOS_BACKUP_DIR!, result.safetyName, "tacos.db")),
    "the safety backup is on disk"
  );
  const restored = getDb();
  assert.equal(restored.select().from(schema.projects).all().length, 0, "the project created after the backup is gone");
  assert.ok(restored.select().from(schema.users).all().some((user) => user.id === "owner"), "accounts from the backup are back");
  const runs = backups.listBackupRuns(50);
  assert.ok(runs.some((run) => run.kind === "safety"), "the restored database records the safety backup");
  assert.ok(runs.some((run) => run.kind === "restore"), "the restored database records the restore");

  // --- 4. maintenance guard fails fast ---------------------------------------------
  setDbMaintenance("TaCos is restoring a backup. Retry in a moment.");
  await assert.rejects(async () => getDb(), /restoring a backup/, "database access stops during the swap");
  setDbMaintenance(null);
  assert.ok(getDb(), "database access resumes after the swap");

  // --- 5. a corrupt backup is refused and the live database survives ----------------
  const second = await backups.createBackup("manual", "owner");
  const corruptName = (await backups.backupCandidates())[0].name;
  const corruptDb = path.join(process.env.TACOS_BACKUP_DIR!, corruptName, "tacos.db");
  fs.writeFileSync(corruptDb, "not a sqlite database");
  await assert.rejects(
    backups.restoreBackup(corruptName, RESTORE_PHRASE, "owner"),
    /integrity check failed/i,
    "a corrupt backup is refused"
  );
  assert.ok(getDb().select().from(schema.users).all().some((user) => user.id === "owner"), "the live database is untouched");
  assert.equal(second.status, "completed", "the second backup completed");

  // --- 6. retention deletes old folders but keeps the new one -----------------------
  await backups.saveBackupRetentionDays(7);
  const oldDir = path.join(process.env.TACOS_BACKUP_DIR!, "2020-01-01");
  fs.mkdirSync(oldDir, { recursive: true });
  fs.copyFileSync(path.join(dir, "tacos.db"), path.join(oldDir, "tacos.db"));
  fs.writeFileSync(
    path.join(oldDir, "manifest.json"),
    JSON.stringify({
      format: 1,
      kind: "scheduled",
      appVersion: appVersion(),
      createdAt: "2020-01-01T00:00:00.000Z",
      integrity: "ok",
    })
  );
  await backups.createBackup("manual", "owner");
  assert.equal(fs.existsSync(oldDir), false, "a backup older than retention is deleted");
  assert.ok(fs.existsSync(dir), "the current backup is kept");

  // --- 7. one backup at a time -----------------------------------------------------
  fs.mkdirSync(process.env.TACOS_BACKUP_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.TACOS_BACKUP_DIR!, ".ops.lock"), `${process.pid}\n`);
  await assert.rejects(
    backups.createBackup("manual", "owner"),
    /already running/,
    "a second backup is refused while the lock is held"
  );
  fs.rmSync(path.join(process.env.TACOS_BACKUP_DIR!, ".ops.lock"), { force: true });
  const final = await backups.createBackup("manual", "owner");
  assert.equal(final.status, "completed", "a backup runs again after the lock clears");

  // --- 8. a backup from another version is visible but not restorable --------------
  const legacy = path.join(process.env.TACOS_BACKUP_DIR!, "manual-2026-01-01T00_00_00-legacy");
  fs.mkdirSync(legacy, { recursive: true });
  fs.copyFileSync(path.join(dir, "tacos.db"), path.join(legacy, "tacos.db"));
  fs.writeFileSync(
    path.join(legacy, "manifest.json"),
    JSON.stringify({
      format: 1,
      kind: "manual",
      appVersion: "0.0.1-old",
      createdAt: "2026-01-01T00:00:00.000Z",
      integrity: "ok",
    })
  );
  const legacyCandidate = (await backups.backupCandidates()).find((row) => row.name.includes("legacy"));
  assert.ok(legacyCandidate, "an old-version backup is listed");
  assert.equal(legacyCandidate!.restorable, false, "an old-version backup is not restorable");
  assert.equal(legacyCandidate!.reasonCode, "version_mismatch", "the reason is the version");

  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
  console.log("check-backup-restore: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
