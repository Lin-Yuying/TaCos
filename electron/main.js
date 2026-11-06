const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  nativeTheme,
  net,
  screen,
  shell,
  utilityProcess,
} = require("electron");
const path = require("node:path");
const { createLogStream } = require("./log-stream.mjs");
const fs = require("node:fs");
const nodeNet = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { initAppUpdater, getAppUpdateMenuItem } = require("./updater");
const { createTunnel, parseTarget } = require("./ssh-tunnel");
const { adoptShellPath } = require("./shell-path");

const DEFAULT_SERVER = "http://localhost:3000";
const isMac = process.platform === "darwin";

let mainWindow = null;
let serverUrl = null;
let connecting = false;
let localServer = null;
// SIGTERM on the way out makes the child exit 143; that is not a crash worth a page.
let quitting = false;

const settingsDir = () => path.join(app.getPath("appData"), "Tacos");
const settingsFile = () => path.join(settingsDir(), "settings.json");
const logFilePath = () => path.join(app.getPath("logs"), "desktop.log");

// Startup problems on a remote machine are hard to report, so every step lands in a log
// the user can open from the error screen.
let desktopLog=null;
function logLine(message) {
  if(!desktopLog){desktopLog=createLogStream(logFilePath());desktopLog.on("error",error=>console.error("Desktop log:",error.message));}
  if(!desktopLog.destroyed)desktopLog.write(`[${new Date().toISOString()}] ${message}\n`);
  console.log("[tacos]",message);
}
let logQuitReady=false;
app.on("before-quit",event=>{if(logQuitReady||!desktopLog||desktopLog.writableFinished||desktopLog.destroyed)return;event.preventDefault();const finish=()=>{if(logQuitReady)return;logQuitReady=true;app.quit();};desktopLog.once("finish",finish);desktopLog.once("error",finish);desktopLog.end();setTimeout(finish,2000).unref();});

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

// Recently used servers, newest first. Kept in settings.json so the connect page can
// offer them again — and dedupe, since people retype the same address while debugging.
const MAX_SERVER_HISTORY = 8;

function rememberedServers() {
  const list = readSettings().serverHistory;
  return Array.isArray(list) ? list.filter((value) => typeof value === "string" && value) : [];
}

function rememberServer(url) {
  const next = [url, ...rememberedServers().filter((value) => value !== url)].slice(
    0,
    MAX_SERVER_HISTORY
  );
  writeSettings({ serverHistory: next });
  return next;
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

// Confirms the address is actually a TaCos server before saving it.
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
        error: `The server answered with HTTP ${res.status}. Check the address and make sure TaCos is running there.`,
      };
    }
    const data = await res.json().catch(() => null);
    if (!data || data.product !== "tacos") {
      return { ok: false, error: "Reached a server, but it does not look like TaCos." };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      offline: true,
      error: "Could not reach that address. Is TaCos running, and are both devices on the same network?",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Local server mode.
 *
 * The standalone installer ships the Next server inside Resources/server and runs it
 * on this machine, so the user owns a full TaCos with the database on her own disk and
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
    exitedEarly = new Error(`The local TaCos server exited during startup (code ${code}).`);
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
  throw new Error(`The local TaCos server did not start within ${Math.round(timeoutMs / 1000)}s.`);
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
    serviceName: "TaCos Server",
  });

  const log = createLogStream(logFile);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  // Server output has one sink; desktop.log records lifecycle messages only.
  log.on("error",error=>console.error("Server log:",error));
  child.once("exit",()=>log.end());
  child.on("exit", (code) => {
    logLine(`local server exited code=${code}`);
    if (localServer === child) localServer = null;
    if (!quitting && mainWindow && !mainWindow.isDestroyed() && serverUrl) {
      showErrorPage(mainWindow, serverUrl, `The local TaCos server stopped (code ${code}).`);
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

/* ---------------------------------------------------------------------------
 * Local checkout mode.
 *
 * On the machine that owns a TaCos checkout, the address people type is their own
 * `next dev` on localhost. When the app opens and nothing answers there, it starts
 * that server itself: opening TaCos is enough, no Terminal and no Connect click.
 * Only loopback addresses qualify, and only when a checkout and Node are present —
 * a shipped copy on someone else's machine keeps showing the connect page.
 * ------------------------------------------------------------------------- */

let devServer = null;
let devServerStart = null;
// A dev server can wedge so that every HMR connect triggers a rebuild, the page reloads,
// and the window flashes ~4 times a second. Reloads of one URL are counted here so the
// server we own can be restarted instead of leaving the window blinking.
const pageLoads = [];
let lastLoadRecovery = 0;

function isLoopbackAddress(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function nodeBinary() {
  const winNode = (base) => (base ? path.join(base, "node.exe") : "");
  const candidates = [
    process.env.TACOS_NODE,
    readSettings().nodePath,
    ...(process.platform === "win32"
      ? [
          winNode(process.env.NVM_SYMLINK),
          winNode(process.env.ProgramFiles && path.join(process.env.ProgramFiles, "nodejs")),
          winNode(process.env.ProgramW6432 && path.join(process.env.ProgramW6432, "nodejs")),
          winNode(
            process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "nodejs")
          ),
          winNode(
            process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "nodejs")
          ),
          "C:\\Program Files\\nodejs\\node.exe",
        ]
      : [
          "/opt/homebrew/bin/node",
          "/usr/local/bin/node",
          "/opt/anaconda3/bin/node",
        ]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next known location
    }
  }
  // A Finder/Explorer launch does not read login shell rc files, so ask the OS where node is.
  try {
    const found =
      process.platform === "win32"
        ? spawnSync("where.exe", ["node"], { encoding: "utf8", timeout: 5000, windowsHide: true })
        : spawnSync("/bin/zsh", ["-lic", "command -v node"], {
            encoding: "utf8",
            timeout: 5000,
          });
    const lines = (found.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    const file = process.platform === "win32" ? lines[0] : lines[lines.length - 1];
    if (file && fs.existsSync(file)) return file;
  } catch {
    // no shell lookup available
  }
  return null;
}

function devServerRoot() {
  const candidates = [readSettings().localServerRoot];
  if (!app.isPackaged) candidates.push(path.join(__dirname, ".."));
  for (const dir of candidates) {
    if (!dir) continue;
    const root = path.resolve(dir);
    if (fs.existsSync(path.join(root, "node_modules", "next", "dist", "bin", "next"))) {
      return root;
    }
  }
  return null;
}

async function startDevServer(root, port) {
  const node = nodeBinary();
  if (!node) throw new Error("Node.js was not found on this computer, so the local server cannot start.");
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const logFile = path.join(app.getPath("logs"), "tacos-server.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  logLine(`starting local dev server ${root} on port ${port} (node ${node})`);
  // Turbopack spawns `node` for loaders; without its folder on PATH that lookup fails.
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  env[pathKey] = `${path.dirname(node)}${path.delimiter}${env[pathKey] || ""}`;
  const child = spawn(node, [nextBin, "dev", "-p", String(port)], {
    cwd: root,
    env,
    windowsHide: true,
  });
  const log = createLogStream(logFile);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    logLine(`local dev server exited code=${code}`);
    if (devServer === child) devServer = null;
    if (!quitting && code !== 0 && mainWindow && !mainWindow.isDestroyed() && serverUrl) {
      showErrorPage(mainWindow, serverUrl, `The local TaCos server stopped (code ${code}).`);
    }
  });
  devServer = child;
  const base = `http://127.0.0.1:${port}`;
  await waitForLocalServer(base, 120000, child);
  return base;
}

function stopDevServer() {
  if (!devServer) return;
  const child = devServer;
  devServer = null;
  logLine("stopping local dev server");
  // Windows has no process-group kill: next dev leaves loader processes behind unless the
  // whole tree goes down, and the next launch would find the port taken.
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  child.kill();
}

// Returns the address the app should open when it had to boot the checkout itself.
async function startLocalDevIfNeeded(target) {
  if (!isLoopbackAddress(target)) return null;
  // The address is the tunnel's local end. Nothing on this computer should answer for it.
  if (tunnel) return null;
  if (devServerStart) return devServerStart;
  const base = new URL(target).origin;
  const probe = await probeServer(base);
  if (probe.ok) return null;
  // A different program already owns the port; starting another server cannot help.
  if (!probe.offline) return null;
  const root = devServerRoot();
  if (!root) return null;
  const port = Number(new URL(base).port || 80);
  await showStarting();
  devServerStart = (async () => {
    try {
      return await startDevServer(root, port);
    } catch (err) {
      logLine(`local dev server failed to start: ${err && err.stack ? err.stack : err}`);
      stopDevServer();
      return null;
    }
  })();
  try {
    const started = await devServerStart;
    // Hand back the address the user saved: cookies are origin-scoped, so switching
    // localhost to 127.0.0.1 on boot would drop them at the login page.
    return started ? base : null;
  } finally {
    devServerStart = null;
  }
}

// Only a server this app started can be restarted safely; a `next dev` someone else
// launched on the same port is left alone.
function notePageLoad(win) {
  if (quitting || !devServer) return;
  const url = win.webContents.getURL();
  if (!/^https?:/i.test(url)) return;
  const now = Date.now();
  pageLoads.push({ at: now, url });
  while (pageLoads.length && now - pageLoads[0].at > 12000) pageLoads.shift();
  const same = pageLoads.filter((load) => load.url === url).length;
  if (same < 8 || now - lastLoadRecovery < 120000) return;
  pageLoads.length = 0;
  lastLoadRecovery = now;
  logLine(`page loaded ${same} times in 12s; restarting the local dev server`);
  void (async () => {
    // The page keeps asking for the dead port during the stop→start gap; without the
    // splash in place those failures render the error page and the window looks like it
    // is flickering through three screens while it recovers.
    await showStarting();
    stopDevServer();
    // Give the port back before probing, or the restart looks unnecessary.
    const base = new URL(url).origin;
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await probeServer(base)).offline) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const started = await startLocalDevIfNeeded(url);
    await openServer(started || url);
  })();
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
  // Windows laptops are often 1366×768 at 100% or 125% scaling, where a fixed 1280×840
  // window opens wider or taller than the screen. Fit the work area, then keep the old
  // size as the cap on larger displays.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1280, Math.max(720, Math.round(workArea.width * 0.92)));
  const height = Math.min(840, Math.max(520, Math.round(workArea.height * 0.92)));
  const win = new BrowserWindow({
    width,
    height,
    center: true,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: "TaCos",
    // hiddenInset is macOS-only; Windows keeps its native title bar.
    ...(isMac
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 16 } }
      : {}),
    // The default File/Edit/View menu bar is pure chrome on Windows; Alt still opens it.
    autoHideMenuBar: !isMac,
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

  win.webContents.on("did-finish-load", () => notePageLoad(win));

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

// The Markdown cheat sheet ships next to the app (extraResources) and is also visible
// in the DMG window, so it can be read without running anything.
function markdownGuidePath() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, "docs", "markdown-guide.html")
    : path.join(__dirname, "..", "docs", "markdown-guide.html");
  return fs.existsSync(file) ? file : null;
}

async function openMarkdownGuide() {
  const file = markdownGuidePath();
  if (!file) {
    logLine("markdown guide missing from the bundle");
    return;
  }
  const error = await shell.openPath(file);
  if (error) logLine(`failed to open markdown guide: ${error}`);
}

function buildMenu() {
  const template = [
    {
      label: "TaCos",
      submenu: [
        ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
        {
          label: "TaCos Server…",
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
    {
      label: "Help",
      role: "help",
      submenu: [
        getAppUpdateMenuItem(),
        { type: "separator" },
        {
          label: "Markdown Syntax",
          click: () => void openMarkdownGuide(),
        },
        {
          label: "Open Logs Folder",
          click: () => void shell.openPath(app.getPath("logs")),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

ipcMain.handle("tacos:get-server-url", () => serverUrl || readSettings().serverUrl || DEFAULT_SERVER);

ipcMain.handle("tacos:get-server-history", () => {
  const current = serverUrl || readSettings().serverUrl || DEFAULT_SERVER;
  return [...new Set([current, ...rememberedServers()])].slice(0, MAX_SERVER_HISTORY);
});

/* ---------------------------------------------------------------------------
 * A team server reached over SSH. TaCos on that server listens only on its own localhost,
 * so the window opens the local end of a forward.
 * ------------------------------------------------------------------------- */

let tunnel = null;
const TUNNEL_LOCAL_PORT = 37380;
const TUNNEL_REMOTE_PORT = 3200;
const sshKeyPath = () => path.join(app.getPath("home"), ".ssh", "tacos_ed25519");

function stopTunnel() {
  stopRunner();
  if (tunnel) tunnel.stop();
  tunnel = null;
}

async function localPortFree(port) {
  return new Promise((resolve) => {
    const server = nodeNet.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

// The tunnel holds this port and the next one.
async function freeTunnelPort() {
  let port = TUNNEL_LOCAL_PORT;
  for (let tries = 0; tries < 20; tries += 1) {
    if ((await localPortFree(port)) && (await localPortFree(port + 1))) return port;
    port = await freePort();
  }
  throw new Error("Could not find two free local ports for the SSH connection.");
}

async function startTunnel(config) {
  stopTunnel();
  const target = parseTarget(config.target);
  if (!target) throw new Error("Enter the SSH address like tacos@203.0.113.7");
  const localPort = await freeTunnelPort();
  tunnel = createTunnel({
    ...target,
    localPort,
    remotePort: config.remotePort || TUNNEL_REMOTE_PORT,
    identityFile: fs.existsSync(sshKeyPath()) ? sshKeyPath() : null,
    log: logLine,
  });
  tunnel.start();
  if (!(await tunnel.waitReady())) {
    const detail = tunnel.lastError();
    stopTunnel();
    throw new Error(
      detail.includes("Permission denied")
        ? "The server refused this computer's SSH key. Send your public key to the server's admin first."
        : detail || "Could not open the SSH connection to the server."
    );
  }
  return `http://127.0.0.1:${localPort}`;
}

ipcMain.handle("tacos:connect-ssh", async (_event, raw) => {
  if (connecting) return { ok: false, error: "Already connecting — one moment." };
  connecting = true;
  try {
    const config = { target: String(raw?.target || "").trim(), remotePort: Number(raw?.remotePort) || TUNNEL_REMOTE_PORT };
    logLine(`ssh connect requested: ${config.target} port ${config.remotePort}`);
    const url = await startTunnel(config);
    const probe = await probeServer(url);
    if (!probe.ok) {
      stopTunnel();
      return probe;
    }
    writeSettings({ sshTunnel: config, serverUrl: url });
    await openServer(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    connecting = false;
  }
});

ipcMain.handle("tacos:get-ssh-config", () => readSettings().sshTunnel || null);

// The admin adds this line on the server. Made only when someone asks for it, and kept
// apart from their own keys so that removing TaCos's access touches nothing else.
ipcMain.handle("tacos:ssh-public-key", () => {
  const key = sshKeyPath();
  if (!fs.existsSync(key)) {
    fs.mkdirSync(path.dirname(key), { recursive: true, mode: 0o700 });
    const made = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "tacos", "-f", key]);
    if (made.status !== 0) {
      return { ok: false, error: "Could not create an SSH key. Check that OpenSSH is installed." };
    }
  }
  return { ok: true, publicKey: fs.readFileSync(`${key}.pub`, "utf8").trim() };
});

/* ---------------------------------------------------------------------------
 * Agent on this computer.
 *
 * Connected to a TaCos server, this app is what runs the signed-in person's Agent: the server
 * holds no keys and runs no harness. The token lives only in this process's memory.
 * ------------------------------------------------------------------------- */

let runner = null;
const KEY_OPERATIONS = new Set(["listKeys", "saveKey", "removeKey", "setEditModel"]);

function runnerDir() {
  if (process.env.TACOS_RUNNER_BUNDLE_DIR) return path.resolve(process.env.TACOS_RUNNER_BUNDLE_DIR);
  if (app.isPackaged) return path.join(process.resourcesPath, "server", "runner");
  return path.join(__dirname, "..", "dist", "server", "runner");
}

function stopRunner() {
  if (!runner) return;
  const { child } = runner;
  runner = null;
  logLine("stopping runner");
  child.kill();
}

function startRunner({ token, userId }) {
  stopRunner();
  const dir = runnerDir();
  const dataDir = path.join(app.getPath("home"), ".tacos", "runner");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  logLine(`starting runner for ${serverUrl}`);
  const child = utilityProcess.fork(path.join(dir, "runner.cjs"), [], {
    cwd: dataDir,
    env: {
      ...process.env,
      TACOS_RUNNER_URL: serverUrl,
      TACOS_RUNNER_TOKEN: token,
      TACOS_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    serviceName: "TaCos Agent",
  });
  const relay = (chunk) => {
    const text = chunk.toString().trimEnd();
    if (text) logLine(text);
  };
  child.stdout.on("data", relay);
  child.stderr.on("data", relay);
  child.on("exit", (code) => {
    logLine(`runner exited code=${code}`);
    if (runner?.child === child) runner = null;
  });
  runner = { child, userId };
}

ipcMain.handle("tacos:runner:status", () => ({ running: Boolean(runner), userId: runner?.userId ?? null }));

ipcMain.handle("tacos:runner:ensure", (_event, input) => {
  if (!serverUrl || typeof input?.token !== "string" || typeof input?.userId !== "string") return;
  if (runner?.userId === input.userId) return;
  startRunner(input);
});

ipcMain.handle("tacos:runner:stop", () => stopRunner());

ipcMain.handle("tacos:runner:keys", async (_event, operation, ...args) => {
  if (!KEY_OPERATIONS.has(operation)) return { ok: false, error: "Unknown operation" };
  try {
    const keys = require(path.join(runnerDir(), "runner-keys.cjs"));
    const data = await keys[operation](...args);
    if (operation !== "listKeys") runner?.child.postMessage("refresh");
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not change this API" };
  }
});

ipcMain.handle("tacos:connect", async (_event, raw) => {
  if (connecting) return { ok: false, error: "Already connecting — one moment." };
  const normalized = normalizeServerUrl(raw);
  if (!normalized) {
    return { ok: false, error: "Enter an address like http://localhost:3000 or http://192.168.1.20:3000" };
  }
  logLine(`connect requested: ${normalized}`);
  connecting = true;
  try {
    stopTunnel();
    writeSettings({ sshTunnel: null });
    let probe = await probeServer(normalized);
    // The address may be this checkout: boot its server instead of asking people to.
    if (!probe.ok && probe.offline) {
      const base = await startLocalDevIfNeeded(normalized);
      if (base) probe = { ok: true };
    }
    if (!probe.ok) return probe;
    writeSettings({ serverUrl: normalized });
    rememberServer(normalized);
    await openServer(normalized);
    return { ok: true };
  } finally {
    connecting = false;
  }
});

ipcMain.handle("tacos:retry", async () => {
  const savedTunnel = readSettings().sshTunnel;
  if (savedTunnel) {
    try {
      const url = await startTunnel(savedTunnel);
      await openServer(url);
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      showErrorPage(ensureWindow(), savedTunnel.target, reason);
      return { ok: false, error: reason };
    }
  }
  // Retry the address the window was showing before reaching for the bundled copy. Booting
  // the bundled server swaps in another database and opens on the setup page, so a
  // recovered dev server used to look like the app flipping between two different products.
  const target = serverUrl || readSettings().serverUrl;
  if (target) {
    const base = isLoopbackAddress(target) ? (await startLocalDevIfNeeded(target)) || target : target;
    const probe = await probeServer(new URL(base).origin);
    if (probe.ok) {
      await openServer(base);
      return { ok: true };
    }
    const reason = probe.error || "Connection failed";
    showErrorPage(ensureWindow(), base, reason);
    return { ok: false, error: reason };
  }

  const bundled = localServerDir();
  if (!bundled) return { ok: true };
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

/* ---------------------------------------------------------------------------
 * Opening a Markdown file from Finder / Explorer.
 *
 * The installer registers TaCos for .md (fileAssociations in builder.base.json), so the
 * OS hands the file over here — at launch through argv, or mid-session through
 * "open-file". The file cannot be imported yet at that point: the import runs as the
 * signed-in user inside a workspace. So paths only queue, and the renderer pulls them
 * once a workspace page is up (tacos:take-open-files).
 * ------------------------------------------------------------------------- */

const OPEN_FILE_EXT = /\.(md|markdown|mdx|txt)$/i;
// Server actions carry the whole page body; keep well inside the 8 MB action limit.
const MAX_OPEN_FILE_BYTES = 4 * 1024 * 1024;
const pendingOpenFiles = [];

function isOpenableFile(candidate) {
  if (!candidate || candidate.startsWith("-") || !OPEN_FILE_EXT.test(candidate)) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function queueOpenFile(filePath) {
  if (!isOpenableFile(filePath) || pendingOpenFiles.includes(filePath)) return;
  pendingOpenFiles.push(filePath);
  logLine(`queued file to open: ${filePath}`);
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // Setup, starting and error pages have no workspace to import into; the queue waits
  // for the first workspace page instead of being handed to a page that cannot use it.
  if (/^https?:/i.test(win.webContents.getURL())) {
    win.webContents.send("tacos:open-files-queued");
  }
}

// Registered before `whenReady`: a launch caused by double-clicking a .md file fires
// this before the app is ready, and an unhandled open-file loses the file.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  queueOpenFile(filePath);
});

ipcMain.handle("tacos:take-open-files", async () => {
  const paths = pendingOpenFiles.splice(0);
  const files = [];
  for (const filePath of paths) {
    const name = path.basename(filePath);
    try {
      const { size } = await fs.promises.stat(filePath);
      if (size > MAX_OPEN_FILE_BYTES) {
        files.push({ name, error: "File is larger than 4 MB" });
        continue;
      }
      files.push({ name, content: await fs.promises.readFile(filePath, "utf8") });
    } catch {
      files.push({ name, error: "Could not read this file" });
    }
  }
  if (files.length) logLine(`handing ${files.length} file(s) to the app`);
  return files;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // A second launch from a file — the running window takes it over.
    for (const arg of argv) queueOpenFile(arg);
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
    // Before anything starts that looks for an Agent CLI or runs one.
    await adoptShellPath({ log: logLine });
    // Packaged builds only. Dev stays idle. No UI / timers in H-DESKTOP-UPDATE-01.
    initAppUpdater({ log: logLine, getServerUrl: () => serverUrl });
    // Windows and Linux pass the opened file on the command line instead of sending
    // open-file; both end up in the same queue.
    for (const arg of process.argv.slice(1)) queueOpenFile(arg);

    const savedTunnel = readSettings().sshTunnel;
    if (savedTunnel) {
      try {
        const url = await startTunnel(savedTunnel);
        writeSettings({ serverUrl: url });
        await openServer(url);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logLine(`ssh tunnel failed: ${reason}`);
        showErrorPage(ensureWindow(), savedTunnel.target, reason);
      }
      return;
    }

    // Open the server the user last chose before falling back to the copy inside the
    // installer. Booting the bundled server first made every launch flash through
    // Starting → bundled app → connect page → the server they actually use.
    const saved = readSettings().serverUrl;
    if (saved) {
      if (!isLoopbackAddress(saved)) {
        logLine(`opening saved server ${saved}`);
        await openServer(saved);
        return;
      }
      const started = await startLocalDevIfNeeded(saved);
      if (started) {
        await openServer(started);
        return;
      }
      const probe = await probeServer(new URL(saved).origin);
      if (probe.ok) {
        logLine(`opening saved server ${saved}`);
        await openServer(saved);
        return;
      }
      logLine(`saved server ${saved} is not answering; falling back to the bundled server`);
    }

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
        const fallback = readSettings().serverUrl;
        const reason = err instanceof Error ? err.message : String(err);
        if (fallback) {
          serverUrl = fallback;
          logLine(`falling back to saved server ${fallback}`);
          await openServer(fallback);
        } else {
          showErrorPage(ensureWindow(), "local server", reason);
        }
        return;
      }
      await openServer(serverUrl);
      return;
    }

    logLine(saved ? `opening saved server ${saved}` : "no saved server; showing setup");
    const started = await startLocalDevIfNeeded(saved || DEFAULT_SERVER);
    if (started) {
      if (!saved) {
        writeSettings({ serverUrl: DEFAULT_SERVER });
        rememberServer(DEFAULT_SERVER);
      }
      await openServer(started);
    } else if (saved) {
      await openServer(saved);
    } else {
      await showSetup();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    const saved = serverUrl || readSettings().serverUrl;
    if (!saved) {
      void showSetup();
      return;
    }
    void (async () => {
      const started = await startLocalDevIfNeeded(saved);
      await openServer(started || saved);
    })();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // The server is a child process, so it has to go down with the app or the next launch
  // would find its port taken and its database locked.
  app.on("before-quit", () => {
    quitting = true;
    stopRunner();
    stopTunnel();
    stopLocalServer();
    stopDevServer();
  });

  // Force quit and a plain `kill` skip before-quit entirely.
  ["SIGTERM", "SIGINT", "SIGHUP"].forEach((signal) => {
    process.on(signal, () => {
      quitting = true;
      stopLocalServer();
      stopDevServer();
      app.quit();
    });
  });
}
