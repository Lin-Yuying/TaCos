const { app, ipcMain, BrowserWindow, dialog, net, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const macUpdate = require("./mac-update");

// H-DESKTOP-UPDATE-01/04: desktop app binary updates via electron-updater.
// This is not the Settings › Harness CLI update path.

const STATUS_EVENT = "tacos:app-update:status-changed";
// First check after the window is up. Later checks about every hour.
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const AGENT_POLL_MS = 15_000;

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
let preparationAbort=null;
let installPromptInFlight = false;
let promptedInstallVersion = null;
// The person clicked update before the download finished; ask them when it does.
let installRequested = false;
let availableInfo = null;
let selfInstall = null;
let agentWaitTimer = null;
let getServerUrl = () => null;
let log = (message) => console.log("[tacos-updater]", message);

const MENU_CHECK_LABEL = "Check for App Updates…";
const INSTALL_DIALOG_TITLE = "Install App Update";
const INSTALL_DIALOG_MESSAGE =
  "A new version of TaCos is ready. TaCos has to close and reopen for it to take effect. Restart now?";
const INSTALL_DIALOG_DETAIL_PREFIX = "Version ";
const INSTALL_CONFIRM = "Restart and Install";
const INSTALL_CANCEL = "Later";
const DOWNLOAD_PAGE_URL = "https://github.com/Lin-Yuying/TaCos/releases/latest";
const UNSIGNED_DIALOG_TITLE = "Download App Update";
const UNSIGNED_DIALOG_MESSAGE =
  "This build is not Developer ID signed, so TaCos opens the GitHub download page instead of installing silently.";
const UNSIGNED_DIALOG_CONFIRM = "Open Download Page";
const UNSIGNED_DIALOG_CANCEL = "Cancel";
const AGENT_BUSY_MESSAGE =
  "The Agent is still working, and restarting now would interrupt it. TaCos will ask again once it finishes.";
const AGENT_BUSY_WAIT = "Remind Me When It Finishes";
const AGENT_UNKNOWN_NOTE = "TaCos could not confirm whether the Agent is working.";

const ZH_COPY = {
  [INSTALL_DIALOG_TITLE]: "安装更新",
  [INSTALL_DIALOG_MESSAGE]: "新版本已准备好，需要关闭并重启 TaCos 才生效。现在重启吗？",
  [INSTALL_DIALOG_DETAIL_PREFIX]: "版本 ",
  [INSTALL_CONFIRM]: "重启并安装",
  [INSTALL_CANCEL]: "稍后",
  [UNSIGNED_DIALOG_TITLE]: "下载更新",
  [UNSIGNED_DIALOG_MESSAGE]: "这台电脑上的 TaCos 无法自己替换，需要到 GitHub 下载页手动安装。",
  [UNSIGNED_DIALOG_CONFIRM]: "打开下载页",
  [UNSIGNED_DIALOG_CANCEL]: "取消",
  [AGENT_BUSY_MESSAGE]: "Agent 正在工作，现在重启会打断它。等它结束后，TaCos 会再问你一次。",
  [AGENT_BUSY_WAIT]: "结束后提醒我",
  [AGENT_UNKNOWN_NOTE]: "TaCos 无法确认 Agent 是否正在工作。",
};

function copy(text) {
  const zh = typeof app.getLocale === "function" && String(app.getLocale()).startsWith("zh");
  return zh ? ZH_COPY[text] || text : text;
}

/** Override for tests: null = probe, true/false = forced. */
let trustedSignatureOverride = null;

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
  // A check would take the update button away while the update waits or is on its way.
  if (status.state === "downloaded" || status.state === "downloading") return null;
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
  const route = installRoute();
  if (route === "page") return;
  downloadInFlight = true;
  try {
    log("app update download start");
    if (route === "self") await downloadForSelfInstall();
    else await autoUpdater.downloadUpdate();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    installRequested = false;
    setStatus(err?.name==="AbortError"?{state:"available",progress:null,stage:null,error:null}:{state:"error",stage:null,error:message});
    log(`app update download failed: ${message}`);
  } finally {
    downloadInFlight = false;
  }
}

async function downloadForSelfInstall() {
  if (!availableInfo) throw new Error("No update information to download from.");
  setStatus({ state: "downloading", progress: 0, error: null });
  preparationAbort=new AbortController();
  selfInstall = await macUpdate.prepare({
    signal:preparationAbort.signal,
    bundle:currentBundle(),
    onStage:stage=>setStatus({stage}),
    net,
    userData: app.getPath("userData"),
    info: availableInfo,
    arch: process.arch,
    log,
    onProgress: (percent) => setStatus({ state: "downloading", progress: percent }),
  });
  preparationAbort=null;
  downloadFinished(availableInfo.version);
}

function downloadFinished(version) {
  setStatus({
    state: "downloaded",
    stage:null,
    availableVersion: version || status.availableVersion,
    progress: 100,
    error: null,
  });
  if (!installRequested) return;
  installRequested = false;
  void confirmAndInstall({ force: true });
}

function currentBundle() {
  return macUpdate.bundleOf(app.getPath("exe"));
}

/**
 * How this copy gets a new version: "updater" is electron-updater, "self" is the bundle
 * swap in mac-update.js, and "page" is the person installing from the download page.
 */
function installRoute() {
  if (process.platform !== "darwin" || hasTrustedAppSignature()) return "updater";
  return net && macUpdate.canReplace(currentBundle()) ? "self" : "page";
}

// true, false, or null when the server could not say.
async function agentBusy() {
  const origin = getServerUrl();
  if (!origin) return false;
  try {
    const response = await session.defaultSession.fetch(`${origin}/api/agent/busy`, {
      credentials: "include",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return Boolean(body.busy);
  } catch (err) {
    log(`agent state unavailable: ${err && err.message ? err.message : err}`);
    return null;
  }
}

function stopAgentWait() {
  if (agentWaitTimer) clearInterval(agentWaitTimer);
  agentWaitTimer = null;
}

function waitForAgent() {
  stopAgentWait();
  agentWaitTimer = setInterval(() => {
    void agentBusy().then((busy) => {
      if (busy === true || !agentWaitTimer) return;
      stopAgentWait();
      void confirmAndInstall({ force: true });
    });
  }, AGENT_POLL_MS);
  if (typeof agentWaitTimer.unref === "function") agentWaitTimer.unref();
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
  stopAgentWait();
  firstCheckTimer = null;
  intervalTimer = null;
  timersStarted = false;
}



function setTrustedSignatureForTests(value) {
  trustedSignatureOverride = value;
}

/**
 * True only for Apple Developer ID Application signatures (macOS) or
 * a trusted Authenticode signature (Windows). Ad-hoc and unsigned builds return false.
 */
function hasTrustedAppSignature() {
  if (trustedSignatureOverride != null) return Boolean(trustedSignatureOverride);
  try {
    if (process.platform === "darwin") {
      const appPath = app.getPath("exe");
      // exe is …/TaCos.app/Contents/MacOS/TaCos → climb to the .app bundle.
      let bundle = appPath;
      const idx = bundle.indexOf(".app/");
      if (idx >= 0) bundle = bundle.slice(0, idx + 4);
      else bundle = app.getAppPath();
      const out = execFileSync("/usr/bin/codesign", ["-dv", "--verbose=4", bundle], {
        encoding: "utf8",
        stderr: "pipe",
      });
      // codesign prints details on stderr; execFileSync may put them in exception or stdout.
      const text = `${out}`;
      return /Authority=Developer ID Application/i.test(text);
    }
    if (process.platform === "win32") {
      const exe = process.execPath.replace(/'/g, "''");
      const ps = `Get-AuthenticodeSignature -FilePath '${exe}' | Select-Object -ExpandProperty Status`;
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        { encoding: "utf8", timeout: 15000 },
      );
      return /\bValid\b/i.test(String(out).trim());
    }
  } catch (err) {
    // codesign writes to stderr and often exits non-zero while still printing Authority lines.
    const msg = `${err && err.stderr ? err.stderr : ""}${err && err.stdout ? err.stdout : ""}${err && err.message ? err.message : err}`;
    if (process.platform === "darwin" && /Authority=Developer ID Application/i.test(msg)) {
      return true;
    }
    if (process.platform === "darwin" && /Signature=adhoc|flags=0x2\(adhoc\)/i.test(msg)) {
      return false;
    }
    log(`signature probe failed: ${err && err.message ? err.message : err}`);
  }
  // Fail closed: unknown signature → open the download page.
  return false;
}

async function openGithubDownloadPage() {
  await shell.openExternal(DOWNLOAD_PAGE_URL);
  log(`opened app update download page ${DOWNLOAD_PAGE_URL}`);
}

function focusedWindow() {
  try {
    if (typeof BrowserWindow.getFocusedWindow === "function") {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed()) return focused;
    }
    if (typeof BrowserWindow.getAllWindows === "function") {
      const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      return all[0] || null;
    }
  } catch {
    // Test mocks may omit BrowserWindow helpers.
  }
  return null;
}

function runQuitAndInstall() {
  if (!autoUpdater) return;
  if (installRoute() === "self" && selfInstall) {
    macUpdate.startSwap({ ...selfInstall, target: currentBundle(), args: process.argv.slice(1) });
    setImmediate(() => app.quit());
    return;
  }
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      log(`quitAndInstall failed: ${err && err.message ? err.message : err}`);
    }
  });
}

/**
 * Ask the user, then quit and install. Used by IPC, menu, and download-ready.
 * Returns { ok, confirmed, status }.
 */
async function confirmAndInstall(options = {}) {
  const silent = Boolean(options.silent);
  if (!status.enabled || !autoUpdater) {
    return {
      ok: false,
      confirmed: false,
      error: "App updates are only available in the packaged desktop app.",
      status: snapshot(),
    };
  }
  if (status.state !== "downloaded") {
    return {
      ok: false,
      confirmed: false,
      error: "No downloaded update is ready to install.",
      status: snapshot(),
    };
  }
  const version = status.availableVersion || "";
  const degraded = installRoute() !== "updater" && !(installRoute() === "self" && selfInstall);
  if (degraded) return offerDownloadPage(version, silent);
  if (!silent) {
    if (installPromptInFlight) {
      return { ok: false, confirmed: false, error: "Install prompt already open.", status: snapshot() };
    }
    if (promptedInstallVersion && promptedInstallVersion === version && !options.force) {
      return { ok: false, confirmed: false, error: "Install prompt already shown for this version.", status: snapshot() };
    }
    if (!dialog || typeof dialog.showMessageBox !== "function") {
      log("app update install prompt skipped (no dialog API)");
      promptedInstallVersion = version || "unknown";
      return { ok: false, confirmed: false, error: "No dialog API.", status: snapshot() };
    }
    installPromptInFlight = true;
    stopAgentWait();
    let busyNow = false;
    try {
      const busy = await agentBusy();
      if (busy === true) {
        const answer = await askUser({
          type: "info",
          buttons: [copy(AGENT_BUSY_WAIT), copy(INSTALL_CANCEL)],
          title: copy(INSTALL_DIALOG_TITLE),
          message: copy(AGENT_BUSY_MESSAGE),
          detail: version ? `${copy(INSTALL_DIALOG_DETAIL_PREFIX)}${version}` : undefined,
        });
        if (answer === 0) waitForAgent();
        log(`app update install held for the Agent (wait=${answer === 0})`);
        return { ok: true, confirmed: false, waiting: answer === 0, status: snapshot() };
      }
      const lines = [];
      if (version) lines.push(`${copy(INSTALL_DIALOG_DETAIL_PREFIX)}${version}`);
      if (busy === null) lines.push(copy(AGENT_UNKNOWN_NOTE));
      const answer = await askUser({
        type: "info",
        buttons: [copy(INSTALL_CONFIRM), copy(INSTALL_CANCEL)],
        title: copy(INSTALL_DIALOG_TITLE),
        message: copy(INSTALL_DIALOG_MESSAGE),
        detail: lines.join("\n") || undefined,
      });
      promptedInstallVersion = version || "unknown";
      if (answer !== 0) {
        log("app update install deferred by user");
        return { ok: true, confirmed: false, status: snapshot() };
      }
      // The dialog may have stayed open while the person started something.
      busyNow = (await agentBusy()) === true;
    } finally {
      installPromptInFlight = false;
    }
    if (busyNow) return confirmAndInstall({ force: true });
  }
  log("app update install confirmed");
  runQuitAndInstall();
  return { ok: true, confirmed: true, status: snapshot() };
}

async function askUser(box) {
  const parent = focusedWindow();
  const boxOpts = { ...box, defaultId: 0, cancelId: 1, noLink: true };
  const result = parent
    ? await dialog.showMessageBox(parent, boxOpts)
    : await dialog.showMessageBox(boxOpts);
  return result.response;
}

// H-DESKTOP-UPDATE-07: when this copy cannot replace itself, the person installs by hand.
async function offerDownloadPage(version, silent) {
  if (!silent) {
    const answer = await askUser({
      type: "info",
      buttons: [copy(UNSIGNED_DIALOG_CONFIRM), copy(UNSIGNED_DIALOG_CANCEL)],
      title: copy(UNSIGNED_DIALOG_TITLE),
      message: copy(UNSIGNED_DIALOG_MESSAGE),
      detail: version ? `${copy(INSTALL_DIALOG_DETAIL_PREFIX)}${version}` : undefined,
    });
    promptedInstallVersion = version || "unknown";
    if (answer !== 0) {
      log("app update download page deferred by user");
      return { ok: true, confirmed: false, degraded: true, status: snapshot() };
    }
  }
  await openGithubDownloadPage();
  return { ok: true, confirmed: true, degraded: true, status: snapshot() };
}

async function checkForAppUpdatesFromMenu() {
  const parent = focusedWindow();
  if (!status.enabled || !autoUpdater) {
    await dialog.showMessageBox(parent || undefined, {
      type: "info",
      buttons: ["OK"],
      title: "App Updates",
      message: "App updates are only available in the packaged desktop app.",
      noLink: true,
    });
    return { ok: false, status: snapshot() };
  }
  if (status.state === "downloaded") {
    return confirmAndInstall({ force: true });
  }
  await runCheck("menu");
  if (status.state === "available" && installRoute() === "page") {
    return offerDownloadPage(status.availableVersion || "", false);
  }
  if (status.state === "available") await maybeDownload();
  if (status.state === "downloaded") {
    return confirmAndInstall({ force: true });
  }
  if (status.state === "not-available") {
    await dialog.showMessageBox(parent || undefined, {
      type: "info",
      buttons: ["OK"],
      title: "App Updates",
      message: "TaCos is up to date.",
      detail: status.currentVersion
        ? `Current version ${status.currentVersion}`
        : undefined,
      noLink: true,
    });
    return { ok: true, status: snapshot() };
  }
  if (status.state === "error") {
    await dialog.showMessageBox(parent || undefined, {
      type: "error",
      buttons: ["OK"],
      title: "App Updates",
      message: "Could not check for app updates.",
      detail: status.error || undefined,
      noLink: true,
    });
    return { ok: false, status: snapshot() };
  }
  if (status.state === "downloading" || status.state === "available") {
    await dialog.showMessageBox(parent || undefined, {
      type: "info",
      buttons: ["OK"],
      title: "App Updates",
      message: "A newer version is downloading in the background.",
      detail: status.availableVersion
        ? `${INSTALL_DIALOG_DETAIL_PREFIX}${status.availableVersion}`
        : undefined,
      noLink: true,
    });
    return { ok: true, status: snapshot() };
  }
  await dialog.showMessageBox(parent || undefined, {
    type: "info",
    buttons: ["OK"],
    title: "App Updates",
    message: "Checking for app updates…",
    noLink: true,
  });
  return { ok: true, status: snapshot() };
}

function getAppUpdateMenuItem() {
  return {
    label: MENU_CHECK_LABEL,
    click: () => {
      void checkForAppUpdatesFromMenu();
    },
  };
}

function registerIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.handle("tacos:app-update:status", () => snapshot());
  ipcMain.handle("tacos:app-update:cancel",()=>{installRequested=false;preparationAbort?.abort();return {ok:true};});
  app.on?.("before-quit",()=>preparationAbort?.abort());

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
    await maybeDownload();
    if (status.state === "error") {
      return { ok: false, error: status.error, status: snapshot() };
    }
    return { ok: true, status: snapshot() };
  });

  ipcMain.handle("tacos:app-update:install", async () => {
    if (status.state === "available" || status.state === "downloading") {
      if (installRoute() === "page") return offerDownloadPage(status.availableVersion || "", false);
      installRequested = true;
      void maybeDownload();
      return { ok: true, queued: true, status: snapshot() };
    }
    return confirmAndInstall({ force: true });
  });

  // The top-bar pill asks the in-app questions (including a running Agent) and calls
  // this, so restarting does not show the native install dialog a second time. A build
  // that cannot replace itself still goes through the download-page prompt.
  ipcMain.handle("tacos:app-update:restart", async () => {
    if (status.state !== "downloaded") {
      return { ok: false, error: "No downloaded update is ready to install.", status: snapshot() };
    }
    const route = installRoute();
    const degraded = route !== "updater" && !(route === "self" && selfInstall);
    if (degraded) return offerDownloadPage(status.availableVersion || "", false);
    log("app update restart confirmed in the top bar");
    runQuitAndInstall();
    return { ok: true, confirmed: true, status: snapshot() };
  });
}

function bindUpdaterEvents(updater) {
  updater.on("checking-for-update", () => {
    setStatus({ state: "checking", error: null });
  });
  updater.on("update-available", (info) => {
    availableInfo = info || null;
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
    // H-DESKTOP-UPDATE-05: nothing restarts until the person clicks update and confirms.
    downloadFinished(info && info.version);
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
  if (typeof options.getServerUrl === "function") getServerUrl = options.getServerUrl;
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
  getAppUpdateMenuItem,
  checkForAppUpdatesFromMenu,
  confirmAndInstall,
  hasTrustedAppSignature,
  setTrustedSignatureForTests,
  stopSchedule,
  MENU_CHECK_LABEL,
  INSTALL_DIALOG_TITLE,
  INSTALL_CONFIRM,
  DOWNLOAD_PAGE_URL,
  UNSIGNED_DIALOG_TITLE,
};
