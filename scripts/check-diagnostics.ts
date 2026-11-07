/**
 * U-12: diagnostics bundle contents and redaction.
 * The bundle must carry configuration, schema metadata, integrity and recent logs, and
 * must not carry database rows or secret values. The size cap must hold.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-diagnostics-"));
process.env.TACOS_DATA_DIR = path.join(root, "data");
process.env.TACOS_BACKUP_DIR = path.join(root, "backups");
process.env.TACOS_LOG_DIR = path.join(root, "logs");
process.env.TACOS_SEED_DEMO = "0";
process.env.TACOS_ADMIN_PASSWORD = "diag-admin-secret-42";
process.env.OPENAI_API_KEY = "sk-diagnosticsecret1234567890";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { recordServerEvent } = await import("../src/lib/ops/server-log");
  const { buildDiagnosticsBundle } = await import("../src/lib/ops/diagnostics");
  const { harnessLogDir } = await import("../src/lib/harness/turn-log");
  const { DIAGNOSTICS_MAX_BYTES } = await import("../src/lib/ops/shared");
  const { appVersion } = await import("../src/lib/ops/version");

  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.users)
    .values({
      id: "owner",
      username: "ROW-MARKER-ACCOUNT",
      displayName: "ROW-MARKER-ACCOUNT",
      passwordHash: "x",
      role: "admin",
      createdAt: now,
    })
    .run();
  recordServerEvent("warn", "diagnostics test entry", { note: "diag-admin-secret-42" });

  fs.mkdirSync(harnessLogDir(), { recursive: true });
  fs.writeFileSync(
    path.join(harnessLogDir(), "codex-test.log"),
    [
      "# turn",
      "HARNESS-LOG-MARKER",
      "api_key=sk-diagnosticsecret1234567890",
      "proxy=http://member:proxyPassword99@proxy.example:8080",
    ].join("\n")
  );

  const bundle = await buildDiagnosticsBundle();
  assert.ok(bundle.filename.startsWith("tacos-diagnostics-"), "the bundle has a named file");
  assert.ok(bundle.filename.endsWith(".txt"), "the bundle is a text file");
  assert.ok(bundle.bytes <= DIAGNOSTICS_MAX_BYTES, "the bundle stays under the cap");
  assert.equal(bundle.truncated, false, "a small bundle is not truncated");

  for (const expected of [
    "TaCos diagnostics bundle",
    `version: ${appVersion()}`,
    "channel: stable",
    "## Configuration",
    "TACOS_ADMIN_PASSWORD=<redacted>",
    "OPENAI_API_KEY=<redacted>",
    "## Schema",
    "schema_version:",
    "integrity_check: ok",
    "## Health",
    "## Server log",
    "diagnostics test entry",
    "## Harness turn logs",
    "HARNESS-LOG-MARKER",
    "No database rows",
  ]) {
    assert.ok(bundle.body.includes(expected), `bundle must include ${JSON.stringify(expected)}`);
  }

  for (const secret of [
    "diag-admin-secret-42",
    "sk-diagnosticsecret1234567890",
    "proxyPassword99",
    "ROW-MARKER-ACCOUNT",
  ]) {
    assert.ok(!bundle.body.includes(secret), `bundle must not include ${JSON.stringify(secret)}`);
  }
  assert.ok(bundle.redactedKeys.includes("TACOS_ADMIN_PASSWORD"), "the bundle names the redacted key");

  const small = await buildDiagnosticsBundle({ maxBytes: 1024 });
  assert.equal(small.truncated, true, "a tiny cap truncates the bundle");
  assert.ok(small.bytes <= 1024, "the truncated bundle respects the cap");
  assert.ok(small.body.startsWith("TaCos diagnostics bundle"), "the summary survives truncation");
  assert.ok(small.body.includes("truncated"), "the truncation is explained");

  fs.rmSync(root, { recursive: true, force: true });
  console.log("check-diagnostics: pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
