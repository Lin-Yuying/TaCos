const { app, ipcMain, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// H-DESKTOP-UPDATE-01: desktop app binary updates via electron-updater.
// This is not the Settings › Harness CLI update path.

const STATUS_EVENT = "tacos:app-update:status-changed";

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
  // Prefer app-update.yml from a packaged build (H-DESKTOP-UPDATE-02).
  // When that file is missing, use the GitHub repo from package.json.
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
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true,
        status: snapshot(),
        updateInfo: result && result.updateInfo ? result.updateInfo : null,
      };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setStatus({ state: "error", error: message });
      return { ok: false, error: message, status: snapshot() };
    }
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
 * Call once from app.whenReady. No UI and no timers here (later backlog ids).
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
    // CommonJS export shape from electron-updater.
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    setStatus({ enabled: false, state: "error", error: message });
    log(`app updater load failed: ${message}`);
    return { enabled: false };
  }

  status.enabled = true;
  // H-DESKTOP-UPDATE-04 owns scheduled download. Keep manual download through IPC for now.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  configureGithubFeed(autoUpdater);
  bindUpdaterEvents(autoUpdater);
  log(`app updater ready v${status.currentVersion}`);
  return { enabled: true };
}

function getAppUpdateStatus() {
  return snapshot();
}

module.exports = {
  initAppUpdater,
  getAppUpdateStatus,
};
