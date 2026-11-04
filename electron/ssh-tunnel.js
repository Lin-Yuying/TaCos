const { spawn } = require("node:child_process");
const net = require("node:net");

// A team server listens only on its own localhost. This keeps one system-OpenSSH forward
// open to it and starts a new one when it dies, so the window's address never changes.

const MAX_BACKOFF_MS = 30_000;

function parseTarget(raw) {
  const value = String(raw || "").trim();
  const match = /^([a-z_][a-z0-9_-]*)@([a-z0-9][a-z0-9.-]*)$/i.exec(value);
  // Goes into an ssh argument. The pattern above rules out a leading dash and any option.
  if (!match) return null;
  return { user: match[1], host: match[2] };
}

function sshArgs({ user, host, localPort, remotePort, identityFile }) {
  return [
    "-N",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ConnectTimeout=10",
    // First connection has nobody to answer a prompt; a changed key still refuses.
    "-o",
    "StrictHostKeyChecking=accept-new",
    ...(identityFile ? ["-i", identityFile] : []),
    `${user}@${host}`,
  ];
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function createTunnel(options) {
  const { sshPath = "ssh", log = () => {} } = options;
  let child = null;
  let stopped = true;
  let backoff = 1000;
  let timer = null;
  let lastError = "";

  const launch = () => {
    timer = null;
    if (stopped) return;
    const proc = spawn(sshPath, sshArgs(options), { stdio: ["ignore", "ignore", "pipe"] });
    child = proc;
    const startedAt = Date.now();
    log(`ssh tunnel started (pid ${proc.pid}) to ${options.host}`);
    proc.stderr.on("data", (chunk) => {
      lastError = String(chunk).trim().slice(-400);
    });
    const onGone = (reason) => {
      if (child !== proc) return;
      child = null;
      if (stopped) return;
      // A forward that held for a while earns a fresh start; a refused key should not spin.
      if (Date.now() - startedAt > 60_000) backoff = 1000;
      log(`ssh tunnel ended (${reason}); restarting in ${backoff} ms`);
      timer = setTimeout(launch, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    proc.once("exit", (code, signal) => onGone(signal || `code ${code}`));
    proc.once("error", (err) => onGone(err.message));
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      backoff = 1000;
      launch();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (child) child.kill();
      child = null;
    },
    pid: () => (child ? child.pid : null),
    lastError: () => lastError,
    async waitReady(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (child && (await portAnswers(options.localPort))) return true;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return false;
    },
  };
}

module.exports = { createTunnel, parseTarget, sshArgs };
