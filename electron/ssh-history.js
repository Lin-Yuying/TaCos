const MAX_SSH_HISTORY = 8;

function normalizeSshConnection(value) {
  if (!value || typeof value.target !== "string") return null;
  const target = value.target.trim();
  const rawPort = value.remotePort;
  const validPort =
    typeof rawPort === "number" ||
    (typeof rawPort === "string" && /^\d+$/.test(rawPort.trim()));
  const remotePort = Number(rawPort);
  if (
    !target ||
    !validPort ||
    !Number.isInteger(remotePort) ||
    remotePort <= 0 ||
    remotePort > 65535
  ) {
    return null;
  }
  return { target, remotePort };
}

function connectionKey(value) {
  return `${value.target}\0${value.remotePort}`;
}

function rememberedSshConnections(settings) {
  const saved = Array.isArray(settings.sshHistory)
    ? settings.sshHistory
    : settings.sshTunnel
      ? [settings.sshTunnel]
      : [];
  const seen = new Set();
  const history = [];
  for (const value of saved) {
    const connection = normalizeSshConnection(value);
    if (!connection) continue;
    const key = connectionKey(connection);
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(connection);
    if (history.length === MAX_SSH_HISTORY) break;
  }
  return history;
}

function rememberSshConnection(settings, config) {
  const current = normalizeSshConnection(config);
  if (!current) return rememberedSshConnections(settings);
  return [
    current,
    ...rememberedSshConnections(settings).filter(
      (value) => connectionKey(value) !== connectionKey(current)
    ),
  ].slice(0, MAX_SSH_HISTORY);
}

module.exports = { MAX_SSH_HISTORY, normalizeSshConnection, rememberedSshConnections, rememberSshConnection };
