/**
 * U-12: upgrade preflight and rollback state.
 * Pure checks cover disk, backup age, version and rollback availability; the status
 * builder reads app.old and the newest restorable backup without touching the network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-preflight-"));
process.env.TACOS_APP_ROOT = path.join(root, "app");
process.env.TACOS_APP_VERSION = "9.9.9";
process.env.TACOS_SERVER_MODE = "1";

const GiB = 1024 * 1024 * 1024;

function states(checks: Array<{ id: string; state: string }>): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.id, check.state]));
}

async function main() {
  const upgrade = await import("../src/lib/ops/upgrade");
  const { appVersion } = await import("../src/lib/ops/version");

  fs.mkdirSync(process.env.TACOS_APP_ROOT!, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.TACOS_APP_ROOT!, "package.json"),
    JSON.stringify({ version: "9.9.9" })
  );
  fs.mkdirSync(`${process.env.TACOS_APP_ROOT!}.old`, { recursive: true });
  fs.writeFileSync(
    `${process.env.TACOS_APP_ROOT!}.old/package.json`,
    JSON.stringify({ version: "9.9.8" })
  );

  const now = Date.now();
  const ready = upgrade.upgradeChecks({
    freeBytes: 3 * GiB,
    latestBackupAt: new Date(now - 3_600_000).toISOString(),
    previousVersion: "9.9.8",
    rollbackAvailable: true,
    mode: "server",
    now,
  });
  assert.deepEqual(states(ready), {
    disk: "ok",
    backup: "ok",
    version: "ok",
    rollback: "ok",
  });

  const lowDisk = upgrade.upgradeChecks({
    freeBytes: 1.5 * GiB,
    latestBackupAt: new Date(now).toISOString(),
    previousVersion: null,
    rollbackAvailable: false,
    mode: "server",
    now,
  });
  assert.equal(states(lowDisk).disk, "warn", "less than 2 GB is a warning");
  assert.equal(states(lowDisk).rollback, "warn", "a missing app.old warns on a server");

  const blocked = upgrade.upgradeChecks({
    freeBytes: 0.5 * GiB,
    latestBackupAt: new Date(now).toISOString(),
    previousVersion: null,
    rollbackAvailable: true,
    mode: "server",
    now,
  });
  assert.equal(states(blocked).disk, "fail", "less than 1 GB blocks the upgrade");

  const stale = upgrade.upgradeChecks({
    freeBytes: 3 * GiB,
    latestBackupAt: new Date(now - 8 * 86_400_000).toISOString(),
    previousVersion: "9.9.9",
    rollbackAvailable: true,
    mode: "server",
    now,
  });
  assert.equal(states(stale).backup, "warn", "a backup older than a week warns");
  assert.equal(states(stale).version, "warn", "app.old with the running version warns");

  const desktop = upgrade.upgradeChecks({
    freeBytes: 3 * GiB,
    latestBackupAt: new Date(now).toISOString(),
    previousVersion: null,
    rollbackAvailable: false,
    mode: "desktop",
    now,
  });
  assert.equal(states(desktop).rollback, "ok", "desktop builds do not need app.old");

  const health = {
    disk: { freeBytes: 3 * GiB },
    backup: { lastRunAt: new Date(now).toISOString() },
  } as unknown as Parameters<typeof upgrade.buildUpgradeStatus>[0]["health"];
  const status = upgrade.buildUpgradeStatus({
    health,
    candidates: [
      {
        name: "manual-test",
        createdAt: new Date(now - 3_600_000).toISOString(),
        dbBytes: 1024,
        uploadsBytes: 0,
        version: "9.9.9",
        integrity: "ok",
        restorable: true,
        reasonCode: null,
        reason: null,
      },
    ],
    latestPreUpgradeAt: new Date(now - 7_200_000).toISOString(),
    now,
  });
  assert.equal(status.currentVersion, appVersion(), "the status names the running version");
  assert.equal(status.currentVersion, "9.9.9", "TACOS_APP_VERSION wins for a packaged test");
  assert.equal(status.channel, "stable", "only the stable channel ships");
  assert.equal(status.previousVersion, "9.9.8", "previousVersion comes from app.old");
  assert.equal(status.rollbackAvailable, true);
  assert.equal(status.ready, true, "a recent backup and free disk are ready");
  assert.equal(status.mode, "server");
  assert.equal(status.rollbackCommand, "sudo /opt/tacos/deploy/rollback.sh");
  assert.equal(
    status.checks.find((check) => check.id === "backup")?.state,
    "ok",
    "the restorable candidate supplies the backup age"
  );

  fs.rmSync(`${process.env.TACOS_APP_ROOT!}.old`, { recursive: true, force: true });
  const noRollback = upgrade.buildUpgradeStatus({ health, candidates: [], latestPreUpgradeAt: null, now });
  assert.equal(noRollback.rollbackAvailable, false, "a missing app.old is reported");
  assert.equal(noRollback.previousVersion, null);
  assert.equal(noRollback.checks.find((check) => check.id === "rollback")?.state, "warn");
  assert.equal(noRollback.latestPreUpgradeAt, null);

  process.env.TACOS_SERVER_MODE = "0";
  const desktopStatus = upgrade.buildUpgradeStatus({ health, candidates: [], latestPreUpgradeAt: null, now });
  assert.equal(desktopStatus.mode, "desktop", "desktop mode is reported");
  assert.equal(desktopStatus.checks.find((check) => check.id === "rollback")?.state, "ok");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("check-upgrade-preflight: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
