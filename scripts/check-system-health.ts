/**
 * U-12: system health payload and the public /api/health data.
 * Checks the version/channel, database path and integrity, disk, runner counts, rollback
 * state, and that the public payload carries no paths, names or environment secrets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-health-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_BACKUP_DIR = path.join(root, "backups");
process.env.TACOS_LOG_DIR = path.join(root, "logs");
process.env.TACOS_APP_ROOT = path.join(root, "app");
process.env.TACOS_SEED_DEMO = "0";
process.env.TACOS_SERVER_MODE = "1";
process.env.TACOS_ADMIN_PASSWORD = "health-secret-value-42";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const health = await import("../src/lib/ops/health");
  const { appVersion, UPDATE_CHANNEL } = await import("../src/lib/ops/version");
  const { createBackup } = await import("../src/lib/ops/backups");

  fs.mkdirSync(process.env.TACOS_APP_ROOT!, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.TACOS_APP_ROOT!, "package.json"),
    JSON.stringify({ version: appVersion() })
  );
  fs.mkdirSync(`${process.env.TACOS_APP_ROOT!}.old`, { recursive: true });
  fs.writeFileSync(
    `${process.env.TACOS_APP_ROOT!}.old/package.json`,
    JSON.stringify({ version: "0.0.1-old" })
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
  db.insert(schema.runnerStatus)
    .values({ userId: "owner", capabilities: JSON.stringify({ harnesses: [] }), lastSeenAt: now })
    .run();
  await createBackup("manual", "owner");

  const snapshot = await health.systemHealth();
  assert.equal(snapshot.version, appVersion(), "health names the running version");
  assert.equal(snapshot.channel, UPDATE_CHANNEL, "health names the update channel");
  // The test volume can have under 5 GB free, which is a warning by design.
  assert.ok(snapshot.status === "ok" || snapshot.status === "warn", "a fresh database is not failing");
  assert.equal(snapshot.checks.find((check) => check.id === "database")?.state, "ok");
  assert.equal(snapshot.mode, "server", "server mode is reported");
  assert.equal(snapshot.database.integrity, "ok", "quick_check passes");
  assert.ok(snapshot.database.path.startsWith(process.env.TACOS_DATA_DIR!), "the database path is under the data dir");
  assert.ok(snapshot.database.sizeBytes > 0, "the database has a size");
  assert.ok(snapshot.database.schemaVersion > 0, "the schema version is reported");
  assert.ok(snapshot.database.tables > 20, "the table count is reported");
  assert.equal(snapshot.runner.total, 1, "the runner row is counted");
  assert.equal(snapshot.runner.online, 1, "a fresh heartbeat is online");
  assert.equal(snapshot.update.previousVersion, "0.0.1-old", "app.old's version is read");
  assert.equal(snapshot.update.rollbackAvailable, true, "app.old is detected");
  assert.equal(snapshot.update.unsigned, null, "signature state belongs to the desktop app");
  assert.equal(snapshot.checks.length, 4, "four health checks are reported");
  assert.equal(snapshot.checks.find((check) => check.id === "database")?.state, "ok");
  assert.ok(snapshot.disk.freeBytes > 0, "free disk is reported");
  assert.equal(health.fullIntegrityCheck(), "ok", "full integrity_check passes");
  assert.equal(health.fullIntegrityCheck(snapshot.database.path), "ok", "a standalone file passes too");

  const publicPayload = await health.publicHealth();
  const serialized = JSON.stringify(publicPayload);
  assert.ok(publicPayload.status === "ok" || publicPayload.status === "warn", "the public payload carries the status");
  assert.equal(publicPayload.version, appVersion(), "the public payload carries the version");
  assert.ok(!serialized.includes(root), "the public payload carries no absolute path");
  assert.ok(!serialized.includes("health-secret-value-42"), "the public payload carries no environment secret");
  assert.ok(!serialized.includes("owner"), "the public payload carries no account name");
  assert.ok(!serialized.includes("dataDir") && !serialized.includes("data_dir"), "the public payload has no data directory field");
  assert.ok(serialized.includes("\"database\""), "the public payload carries aggregate database state");

  // A missing backup makes the health check warn, not fail.
  fs.rmSync(process.env.TACOS_BACKUP_DIR!, { recursive: true, force: true });
  health.resetHealthCache();
  const noBackup = await health.systemHealth();
  assert.equal(noBackup.backup.ageSeconds, null, "no backup is reported as never");
  assert.equal(noBackup.checks.find((check) => check.id === "backup")?.state, "warn");
  assert.equal(noBackup.status, "warn", "a missing backup is a warning");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("check-system-health: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
