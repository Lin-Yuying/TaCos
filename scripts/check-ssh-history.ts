import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_SSH_HISTORY,
  normalizeSshConnection,
  rememberedSshConnections,
  rememberSshConnection,
} = require("../electron/ssh-history.js");

const a = { target: "tacos@a.example", remotePort: 3200 };
const aOtherPort = { target: "tacos@a.example", remotePort: 3201 };
const b = { target: "team@b.example", remotePort: 3200 };

assert.deepEqual(normalizeSshConnection({ target: " tacos@a.example ", remotePort: "3200" }), a);
for (const value of [
  null,
  {},
  { target: "", remotePort: 3200 },
  { target: a.target, remotePort: 0 },
  { target: a.target, remotePort: 65536 },
  { target: a.target, remotePort: 3.5 },
  { target: a.target, remotePort: true },
  { target: a.target, remotePort: "0x10" },
]) {
  assert.equal(normalizeSshConnection(value), null, `invalid SSH connection: ${JSON.stringify(value)}`);
}

assert.deepEqual(
  rememberedSshConnections({ sshTunnel: { target: " tacos@a.example ", remotePort: "3200" } }),
  [a],
  "an older settings file migrates its current tunnel into history"
);
assert.deepEqual(
  rememberedSshConnections({ sshTunnel: a, sshHistory: [] }),
  [],
  "an explicitly cleared history stays cleared"
);
assert.deepEqual(
  rememberedSshConnections({
    sshHistory: [a, { ...a, target: ` ${a.target} ` }, null, aOtherPort, { target: b.target }, b],
  }),
  [a, aOtherPort, b],
  "history filters malformed rows and duplicate target-port pairs"
);
assert.deepEqual(
  rememberSshConnection({ sshHistory: [a, b] }, aOtherPort),
  [aOtherPort, a, b],
  "newest first, with the same target on a different port kept"
);
assert.deepEqual(
  rememberSshConnection({ sshHistory: [a, b, { ...a }] }, a),
  [a, b],
  "reusing a connection moves it to the front and removes duplicates"
);
assert.deepEqual(
  rememberSshConnection({ sshHistory: [a, b] }, { target: "new@example", remotePort: 3200 }),
  [{ target: "new@example", remotePort: 3200 }, a, b],
  "a new successful connection is prepended"
);

const many = Array.from({ length: MAX_SSH_HISTORY + 3 }, (_, index) => ({
  target: `team${index}@example`,
  remotePort: 3200,
}));
assert.equal(rememberedSshConnections({ sshHistory: many }).length, MAX_SSH_HISTORY);
assert.deepEqual(rememberSshConnection({ sshHistory: many }, a), [a, ...many.slice(0, MAX_SSH_HISTORY - 1)]);
assert.deepEqual(
  rememberSshConnection({ sshHistory: [a, b] }, { target: "bad", remotePort: 0 }),
  [a, b],
  "an invalid connection cannot erase valid history"
);

console.log(`check-ssh-history: ${MAX_SSH_HISTORY}-entry history checks passed`);
