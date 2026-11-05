/**
 * H-DESKTOP-UPDATE-04: scheduled app update check and background download.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Module } from "node:module";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function main() {
  const src = read("electron/updater.js");
  assert(src.includes("FIRST_CHECK_DELAY_MS"), "updater must define a first-check delay");
  assert(src.includes("CHECK_INTERVAL_MS"), "updater must define a check interval");
  assert(src.includes("15_000") || src.includes("15000"), "first check must wait about 15 s");
  assert(
    src.includes("60 * 60 * 1000") || src.includes("3600000"),
    "interval must be about 1 hour",
  );
  assert(src.includes("startSchedule"), "updater must start a schedule when packaged");
  assert(src.includes("maybeDownload"), "updater must download when a version is available");
  assert(src.includes("downloadInFlight"), "download must be single-flight");

  // Runtime: packaged mock arms timers and downloads on update-available.
  const handlers: Record<string, Function> = {};
  let downloaded = 0;
  const fakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    setFeedURL() {},
    on(ev: string, fn: Function) {
      (this as { _ev?: Record<string, Function> })._ev ||= {};
      (this as unknown as { _ev: Record<string, Function> })._ev[ev] = fn;
    },
    async checkForUpdates() {
      const info = { version: "2.0.1" };
      (this as { _ev?: Record<string, Function> })._ev?.["checking-for-update"]?.();
      (this as { _ev?: Record<string, Function> })._ev?.["update-available"]?.(info);
      return { updateInfo: info };
    },
    async downloadUpdate() {
      downloaded += 1;
      (this as { _ev?: Record<string, Function> })._ev?.["update-downloaded"]?.({
        version: "2.0.1",
      });
    },
    quitAndInstall() {},
  };

  const orig = (Module.prototype as { require: Function }).require;
  (Module.prototype as { require: Function }).require = function (this: unknown, id: string) {
    if (id === "electron") {
      return {
        app: { isPackaged: true, getVersion: () => "2.0.0" },
        ipcMain: { handle(channel: string, fn: Function) { handlers[channel] = fn; } },
        BrowserWindow: { getAllWindows: () => [] },
      };
    }
    if (id === "electron-updater") return { autoUpdater: fakeUpdater };
    return orig.apply(this, arguments as never);
  };

  const require = createRequire(import.meta.url);
  const updaterPath = path.join(process.cwd(), "electron/updater.js");
  delete require.cache[updaterPath];
  // Clear from Module cache by path variants
  for (const key of Object.keys(require.cache)) {
    if (key.endsWith(`${path.sep}electron${path.sep}updater.js`)) delete require.cache[key];
  }
  // Use Function require through createRequire from a CJS bridge file
  const bridge = path.join(process.cwd(), "scripts", "_tmp-load-updater.cjs");
  fs.writeFileSync(
    bridge,
    `module.exports = require(${JSON.stringify(updaterPath)});`,
  );
  try {
    delete require.cache[require.resolve(bridge)];
    const mod = require(bridge) as {
      initAppUpdater: (o?: { log?: (m: string) => void }) => { enabled: boolean };
      getAppUpdateScheduleForTests: () => {
        firstCheckDelayMs: number;
        checkIntervalMs: number;
        timersStarted: boolean;
      };
      getAppUpdateStatus: () => { state: string };
      setTrustedSignatureForTests: (value: boolean | null) => void;
      stopSchedule: () => void;
    };
    // Signed, so the download below is electron-updater's; the Mac's own is tested elsewhere.
    mod.setTrustedSignatureForTests(true);
    const result = mod.initAppUpdater({ log: () => {} });
    assert(result.enabled, "packaged init must enable updater");
    const schedule = mod.getAppUpdateScheduleForTests();
    assert(schedule.firstCheckDelayMs === 15_000, "first delay must be 15000");
    assert(schedule.checkIntervalMs === 3_600_000, "interval must be 1 hour");
    assert(schedule.timersStarted, "schedule must start for packaged builds");

    // Manual check path also downloads.
    const check = await handlers["tacos:app-update:check"]();
    assert(check.ok, "manual check must succeed");
    assert(downloaded >= 1, "available update must trigger a download");
    assert(mod.getAppUpdateStatus().state === "downloaded", "state must reach downloaded");
    mod.setTrustedSignatureForTests(null);
    mod.stopSchedule();
    console.log(
      `check-desktop-updater-schedule: pass (first=${schedule.firstCheckDelayMs} interval=${schedule.checkIntervalMs} downloads=${downloaded})`,
    );
  } finally {
    (Module.prototype as { require: Function }).require = orig;
    try {
      fs.unlinkSync(bridge);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error("check-desktop-updater-schedule: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
