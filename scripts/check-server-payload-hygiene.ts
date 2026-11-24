import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeServerPayload } from "./server-payload-hygiene.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "tacos-payload-hygiene-"));
const payload = path.join(root, "payload");

try {
  mkdirSync(path.join(payload, "data"), { recursive: true });
  mkdirSync(path.join(payload, "nested"), { recursive: true });
  writeFileSync(path.join(payload, "data", "tacos.db"), "accounts");
  writeFileSync(path.join(payload, ".env"), "SECRET=one");
  writeFileSync(path.join(payload, ".env.production"), "SECRET=two");
  writeFileSync(path.join(payload, "nested", ".env.local"), "SECRET=three");
  writeFileSync(path.join(payload, "nested", "server.js"), "server");
  sanitizeServerPayload(payload);
  assert.equal(existsSync(path.join(payload, "data")), false, "the data directory is removed");
  for (const file of [".env", ".env.production", "nested/.env.local"]) {
    assert.equal(existsSync(path.join(payload, file)), false, `${file} is removed`);
  }
  assert.equal(existsSync(path.join(payload, "nested", "server.js")), true, "server files stay");

  for (const name of ["rogue.db", "rogue.db-wal", "rogue.db-shm"]) {
    const file = path.join(payload, "nested", name);
    writeFileSync(file, "database");
    assert.throws(() => sanitizeServerPayload(payload), /refusing to ship a database or environment file/, name);
    rmSync(file);
  }

  console.log("check-server-payload-hygiene: environment and database checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
