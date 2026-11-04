const { app, ipcMain, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// H-DESKTOP-UPDATE-01/04: desktop app binary updates via electron-updater.
// This is not the Settings › Harness CLI update path.

const STATUS_EVENT = "tacos:app-update:status-changed";
// First check after the window is up. Later checks about every 4 hours.
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

let status = {
  enabled: false,
  state: "idle",
  currentVersion: "",
  availableVersion: null,
  progress: null,
  error: null,
};

let autoUpdater = null;
let ipcReady = false;
let timersStarted = false;
let firstCheckTimer = null;
let intervalTimer = null;
let checkInFlight = false;
let downloadInFlight = false;
let log = (message) => console.log("[tacos-updater]", message);

function snapshot() {
  return {
    enabled: status.enabled,
    state: status.state,
    currentVersion: status.currentVersion,
    availableVersion: status.availableVersion,
    progress: status.progress,
    error: status.error,
  };
}

function broadcast() {
  const payload = snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(STATUS_EVENT, payload);
    }
  }
}

function setStatus(patch) {
  Object.assign(status, patch);
  broadcast();
}

function configureGithubFeed(updater) {
  try {
    const yml = path.join(process.resourcesPath || "", "app-update.yml");
    if (fs.existsSync(yml)) return;
  } catch {
    // resourcesPath may be unset in tests
  }
  try {
    const pkg = require("../package.json");
    const raw =
      pkg.repository && typeof pkg.repository === "object"
        ? pkg.repository.url
        : pkg.repository;
    const match = String(raw || "").match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
    if (!match) return;
    updater.setFeedURL({ provider: "github", owner: match[1], repo: match[2] });
    log(`app update feed github:${match[1]}/${match[2]}`);
  } catch (err) {
    log(`could not set app update feed: ${err && err.message ? err.message : err}`);
  }
}

async function runCheck(reason) {
  if (!status.enabled || !autoUpdater || checkInFlight) return null;
  checkInFlight = true;
  log(`app update check (${reason})`);
  try {
    return await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    setStatus({ state: "error", error: message });
    log(`app update check failed: ${message}`);
    return null;
  } finally {
    checkInFlight = false;
  }
}

async function maybeDownload() {
  if (!status.enabled || !autoUpdater) return;
  if (downloadInFlight) return;
  if (status.state !== "available" && status.state !== "downloading") return;
  if (status.state === "downloaded") return;
  downloadInFlight = true;
  try {
    log("app update download start");
    await autoUpdater.downloadUpdate();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    setStatus({ state: "error", error: message });
    log(`app update download failed: ${message}`);
  } finally {
    downloadInFlight = false;
  }
}

function startSchedule() {
  if (timersStarted || !status.enabled) return;
  timersStarted = true;
  firstCheckTimer = setTimeout(() => {
    void runCheck("startup").then(() => maybeDownload());
  }, FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(() => {
    void runCheck("interval").then(() => maybeDownload());
  }, CHECK_INTERVAL_MS);
  // Allow the process to exit in tests and short-lived launches.
  if (typeof firstCheckTimer.unref === "function") firstCheckTimer.unref();
  if (typeof intervalTimer.unref === "function") intervalTimer.unref();
  log(
    `app update schedule armed (first=${FIRST_CHECK_DELAY_MS}ms interval=${CHECK_INTERVAL_MS}ms)`,
  );
}

function stopSchedule() {
  if (firstCheckTimer) clearTimeout(firstCheckTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  firstCheckTimer = null;
  intervalTimer = null;
  timersStarted = false;
}

function registerIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.handle("tacos:app-update:status", () => snapshot());

  ipcMain.handle("tacos:app-update:check", async () => {
    if (!status.enabled || !autoUpdater) {
      return {
        ok: false,
        error: "App updates are only available in the packaged desktop app.",
        status: snapshot(),
      };
    }
    const result = await runCheck("manual");
    if (status.state === "available") await maybeDownload();
    if (status.state === "error") {
      return { ok: false, error: status.error, status: snapshot() };
    }
    return {
      ok: true,
      status: snapshot(),
      updateInfo: result && result.updateInfo ? result.updateInfo : null,
    };
  });

  ipcMain.handle("tacos:app-update:download", async () => {
    if (!status.enabled || !autoUpdater) {
      return {
        ok: false,
        error: "App updates are only available in the packaged desktop app.",
        status: snapshot(),
      };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true, status: snapshot() };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setStatus({ state: "error", error: message });
      return { ok: false, error: message, status: snapshot() };
    }
  });

  ipcMain.handle("tacos:app-update:install", () => {
    if (!status.enabled || !autoUpdater) {
      return {
        ok: false,
        error: "App updates are only available in the packaged desktop app.",
        status: snapshot(),
      };
    }
    if (status.state !== "downloaded") {
      return {
        ok: false,
        error: "No downloaded update is ready to install.",
        status: snapshot(),
      };
    }
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        log(`quitAndInstall failed: ${err && err.message ? err.message : err}`);
      }
    });
    return { ok: true, status: snapshot() };
  });
}

function bindUpdaterEvents(updater) {
  updater.on("checking-for-update", () => {
    setStatus({ state: "checking", error: null });
  });
  updater.on("update-available", (info) => {
    setStatus({
      state: "available",
      availableVersion: info && info.version ? info.version : null,
      error: null,
    });
    // Background download for scheduled and manual checks (H-DESKTOP-UPDATE-04).
    void maybeDownload();
  });
  updater.on("update-not-available", () => {
    setStatus({ state: "not-available", availableVersion: null, error: null });
  });
  updater.on("download-progress", (progress) => {
    const percent =
      progress && typeof progress.percent === "number" ? progress.percent : null;
    setStatus({ state: "downloading", progress: percent, error: null });
  });
  updater.on("update-downloaded", (info) => {
    setStatus({
      state: "downloaded",
      availableVersion: info && info.version ? info.version : status.availableVersion,
      progress: 100,
      error: null,
    });
  });
  updater.on("error", (err) => {
    setStatus({
      state: "error",
      error: err && err.message ? err.message : String(err),
    });
  });
}

/**
 * Wire electron-updater for packaged builds only. Dev / unpackaged runs stay idle.
 * Call once from app.whenReady.
 */
function initAppUpdater(options = {}) {
  if (typeof options.log === "function") log = options.log;
  status.currentVersion = app.getVersion();
  registerIpc();

  if (!app.isPackaged) {
    status.enabled = false;
    status.state = "idle";
    log("app updater idle (not packaged)");
    return { enabled: false };
  }

  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    setStatus({ enabled: false, state: "error", error: message });
    log(`app updater load failed: ${message}`);
    return { enabled: false };
  }

  status.enabled = true;
  // Scheduled and event-driven download owns the transfer (H-DESKTOP-UPDATE-04).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  configureGithubFeed(autoUpdater);
  bindUpdaterEvents(autoUpdater);
  startSchedule();
  log(`app updater ready v${status.currentVersion}`);
  return { enabled: true };
}

function getAppUpdateStatus() {
  return snapshot();
}

function getAppUpdateScheduleForTests() {
  return {
    firstCheckDelayMs: FIRST_CHECK_DELAY_MS,
    checkIntervalMs: CHECK_INTERVAL_MS,
    timersStarted,
  };
}

module.exports = {
  initAppUpdater,
  getAppUpdateStatus,
  getAppUpdateScheduleForTests,
  stopSchedule,
};
