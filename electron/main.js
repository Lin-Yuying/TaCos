const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  nativeTheme,
  net,
  shell,
  utilityProcess,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const nodeNet = require("node:net");

const DEFAULT_SERVER = "http://localhost:3000";
const isMac = process.platform === "darwin";

let mainWindow = null;
let serverUrl = null;
let connecting = false;
let localServer = null;

const settingsDir = () => path.join(app.getPath("appData"), "Tacos");
const settingsFile = () => path.join(settingsDir(), "settings.json");
const logFilePath = () => path.join(app.getPath("logs"), "desktop.log");

// Startup problems on a remote machine are hard to report, so every step lands in a log
// the user can open from the error screen.
function logLine(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logFilePath()), { recursive: true });
    fs.appendFileSync(logFilePath(), line);
  } catch {
    // never let logging break startup
  }
  console.log("[tacos]", message);
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch (err) {
    logLine(`failed to save settings: ${err && err.message ? err.message : err}`);
  }
}

function normalizeServerUrl(input) {
  let value = String(input || "").trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

// Confirms the address is actually a Tacos server before saving it.
async function probeServer(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await net.fetch(`${base}/api/v1/me`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `The server answered with HTTP ${res.status}. Check the address and make sure Tacos is running there.`,
      };
    }
    const data = await res.json().catch(() => null);
    if (!data || data.product !== "tacos") {
      return { ok: false, error: "Reached a server, but it does not look like Tacos." };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not reach that address. Is Tacos running, and are both devices on the same network?",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Local server mode.
 *
 * The standalone installer ships the Next server inside Resources/server and runs it
 * on this machine, so the user owns a full Tacos with the database on her own disk and
 * never has to install Node or point the app at anyone else.
 * ------------------------------------------------------------------------- */

function localServerDir() {
  const override = process.env.TACOS_LOCAL_SERVER_DIR;
  if (override) {
    const dir = path.resolve(override);
    return fs.existsSync(path.join(dir, "server.js")) ? dir : null;
  }
  if (!app.isPackaged) return null;
  const dir = path.join(process.resourcesPath, "server", "payload");
  return fs.existsSync(path.join(dir, "server.js")) ? dir : null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = nodeNet.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForLocalServer(base, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let exitedEarly = null;
  const onExit = (code) => {
    exitedEarly = new Error(`The local Tacos server exited during startup (code ${code}).`);
  };
  child.once("exit", onExit);
  try {
    while (Date.now() < deadline) {
      if (exitedEarly) throw exitedEarly;
      try {
        const res = await net.fetch(`${base}/api/v1/me`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.product === "tacos") return;
      } catch {
        // still booting
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    child.removeListener("exit", onExit);
  }
  throw new Error(`The local Tacos server did not start within ${Math.round(timeoutMs / 1000)}s.`);
}

async function startLocalServer(dir) {
  const port = await freePort();
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(app.getPath("logs"), "tacos-server.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  logLine(`starting local server ${dir} on 127.0.0.1:${port} (data ${dataDir})`);

  // Spawning process.execPath with ELECTRON_RUN_AS_NODE makes macOS register the server as
  // a second foreground app, so the Dock bounces a generic "exec" tile for as long as it
  // runs. utilityProcess runs the same Node code as a child with no UI of its own.
  const child = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      // Loopback only: her issues stay on her machine unless she chooses otherwise.
      HOSTNAME: "127.0.0.1",
      TACOS_DATA_DIR: dataDir,
      TACOS_SEED_DEMO: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "Tacos Server",
  });

  const log = fs.createWriteStream(logFile, { flags: "a" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const relay = (chunk) => {
    const text = chunk.toString().trimEnd();
    if (text) logLine(`[server] ${text}`);
  };
  child.stdout.on("data", relay);
  child.stderr.on("data", relay);
  child.on("exit", (code) => {
    logLine(`local server exited code=${code}`);
    if (localServer === child) localServer = null;
    if (mainWindow && !mainWindow.isDestroyed() && serverUrl) {
      showErrorPage(mainWindow, serverUrl, `The local Tacos server stopped (code ${code}).`);
    }
  });

  localServer = child;
  await waitForLocalServer(`http://127.0.0.1:${port}`, 60000, child);
  return `http://127.0.0.1:${port}`;
}

function stopLocalServer() {
  if (!localServer) return;
  const child = localServer;
  localServer = null;
  logLine("stopping local server");
  child.kill();
}

function tagDesktopDocument(win) {
  if (win.isDestroyed()) return;
  const url = win.webContents.getURL();
  if (!/^https?:/i.test(url)) return;
  win.webContents
    .executeJavaScript('document.documentElement.dataset.desktop = "true"', true)
    .catch(() => {});
}

function tagWhenReady(win) {
  win.webContents.on("dom-ready", () => tagDesktopDocument(win));
  if (!win.webContents.isLoading()) tagDesktopDocument(win);
}

function showErrorPage(win, failedUrl, reason) {
  if (win.isDestroyed()) return;
  logLine(`showing error page (${reason || "connection failed"})`);
  win
    .loadFile(path.join(__dirname, "error.html"), {
      query: { url: failedUrl, reason: reason || "Connection failed", log: logFilePath() },
    })
    .catch(() => {});
  if (!win.isVisible()) win.show();
}

async function showStarting() {
  const win = ensureWindow();
  await win.loadFile(path.join(__dirname, "starting.html")).catch(() => {});
  if (process.env.TACOS_HIDE_WINDOW !== "1" && !win.isVisible()) win.show();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: "Tacos",
    // hiddenInset is macOS-only; Windows keeps its native title bar.
    ...(isMac
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });

  mainWindow = win;
  // The traffic-light inset styles only apply to the Mac window.
  if (isMac) tagWhenReady(win);

  win.once("ready-to-show", () => {
    if (process.env.TACOS_HIDE_WINDOW !== "1") win.show();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    // -3 is ERR_ABORTED (a navigation we replaced on purpose).
    if (!isMainFrame || code === -3) return;
    if (!/^https?:/i.test(failedUrl)) return;
    showErrorPage(win, failedUrl, description);
  });

  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!serverUrl) return;
    try {
      const target = new URL(targetUrl);
      if (/^https?:$/.test(target.protocol) && target.origin !== new URL(serverUrl).origin) {
        event.preventDefault();
        shell.openExternal(targetUrl);
      }
    } catch {
      // ignore malformed URLs
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

function ensureWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return createWindow();
}

async function openServer(url) {
  const win = ensureWindow();
  serverUrl = url;
  logLine(`opening ${url}`);
  try {
    await win.loadURL(url);
  } catch {
    // did-fail-load renders the error page.
  }
}

async function showSetup() {
  const win = ensureWindow();
  logLine("showing server setup");
  await win.loadFile(path.join(__dirname, "setup.html")).catch(() => {});
}

function dispatchShortcut(key) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents
    .executeJavaScript(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`,
      true
    )
    .catch(() => {});
}

function buildMenu() {
  const template = [
    {
      label: "Tacos",
      submenu: [
        ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
        {
          label: "Tacos Server…",
          accelerator: "CmdOrCtrl+,",
          click: () => void showSetup(),
        },
        {
          label: "Open in Browser",
          click: () => {
            if (serverUrl) shell.openExternal(serverUrl);
          },
        },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
            ]
          : []),
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Issue",
          accelerator: "CmdOrCtrl+N",
          click: () => dispatchShortcut("c"),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    ...(isMac ? [{ role: "windowMenu" }] : []),
  ];
  return Menu.buildFromTemplate(template);
}

ipcMain.handle("tacos:get-server-url", () => serverUrl || readSettings().serverUrl || DEFAULT_SERVER);

ipcMain.handle("tacos:connect", async (_event, raw) => {
  if (connecting) return { ok: false, error: "Already connecting — one moment." };
  const normalized = normalizeServerUrl(raw);
  if (!normalized) {
    return { ok: false, error: "Enter an address like http://localhost:3000 or http://192.168.1.20:3000" };
  }
  logLine(`connect requested: ${normalized}`);
  connecting = true;
  try {
    const probe = await probeServer(normalized);
    if (!probe.ok) return probe;
    writeSettings({ serverUrl: normalized });
    await openServer(normalized);
    return { ok: true };
  } finally {
    connecting = false;
  }
});

ipcMain.handle("tacos:retry", async () => {
  const bundled = localServerDir();
  if (bundled) {
    logLine("retry requested: restarting the local server");
    stopLocalServer();
    await showStarting();
    try {
      serverUrl = await startLocalServer(bundled);
      await openServer(serverUrl);
      return { ok: true };
    } catch (err) {
      logLine(`local server retry failed: ${err && err.stack ? err.stack : err}`);
      stopLocalServer();
      const reason = err instanceof Error ? err.message : String(err);
      showErrorPage(ensureWindow(), "local server", reason);
      return { ok: false, error: reason };
    }
  }
  if (serverUrl) await openServer(serverUrl);
  return { ok: true };
});

ipcMain.handle("tacos:change-server", async () => {
  await showSetup();
  return { ok: true };
});

ipcMain.handle("tacos:open-logs", async () => {
  const dir = app.getPath("logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // fall through to the error returned by openPath
  }
  const error = await shell.openPath(dir);
  return { ok: !error, error };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // Groups the taskbar button under the installer's entry name on Windows.
    if (process.platform === "win32") app.setAppUserModelId("app.tacos.desktop");
    nativeTheme.themeSource = "light";
    Menu.setApplicationMenu(buildMenu());
    logLine(`app ready ${app.getVersion()} on ${process.platform}-${process.arch}`);

    const bundled = localServerDir();
    if (bundled) {
      // Show a window before booting the server: on a slow Windows machine the first
      // launch can take a while, and a silent double-click looks like a crash.
      await showStarting();
      try {
        serverUrl = await startLocalServer(bundled);
        logLine(`local server ready at ${serverUrl}`);
      } catch (err) {
        logLine(`local server failed to start: ${err && err.stack ? err.stack : err}`);
        stopLocalServer();
        const saved = readSettings().serverUrl;
        const reason = err instanceof Error ? err.message : String(err);
        if (saved) {
          serverUrl = saved;
          logLine(`falling back to saved server ${saved}`);
          await openServer(saved);
        } else {
          showErrorPage(ensureWindow(), "local server", reason);
        }
        return;
      }
      await openServer(serverUrl);
      return;
    }

    const saved = readSettings().serverUrl;
    logLine(saved ? `opening saved server ${saved}` : "no saved server; showing setup");
    if (saved) {
      await openServer(saved);
    } else {
      await showSetup();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    const saved = serverUrl || readSettings().serverUrl;
    if (saved) void openServer(saved);
    else void showSetup();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // The server is a child process, so it has to go down with the app or the next launch
  // would find its port taken and its database locked.
  app.on("before-quit", () => stopLocalServer());

  // Force quit and a plain `kill` skip before-quit entirely.
  ["SIGTERM", "SIGINT", "SIGHUP"].forEach((signal) => {
    process.on(signal, () => {
      stopLocalServer();
      app.quit();
    });
  });
}
