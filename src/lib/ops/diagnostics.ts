// U-12: the diagnostics bundle.
// Contents: version/config, schema metadata, integrity result, the operations log and
// recent harness turn logs. Never a database dump, an account row or a secret. The whole
// bundle is capped, and every known secret value is replaced before it leaves the server.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getDb } from "@/db/client";
import { DATA_DIR } from "@/lib/data-dir";
import { harnessLogDir } from "@/lib/harness/turn-log";
import { isServerMode } from "@/lib/server-mode";
import { backupRoot, listBackupFiles } from "./backup-files";
import { fullIntegrityCheck, systemHealth } from "./health";
import { opsLogDir, readRecentServerLog } from "./server-log";
import { DIAGNOSTICS_MAX_BYTES } from "./shared";
import { UPDATE_CHANNEL, appVersion } from "./version";

const SERVER_LOG_BYTES = 512 * 1024;
const HARNESS_TOTAL_BYTES = 512 * 1024;
const HARNESS_FILES = 10;
const HARNESS_LINES = 200;

const SECRET_KEY = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|COOKIE|CREDENTIAL|PRIVATE|DSN)/i;
const CONFIG_KEYS = new Set([
  "NODE_ENV",
  "NODE_OPTIONS",
  "PORT",
  "HOSTNAME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
]);

export type DiagnosticsBundle = {
  filename: string;
  body: string;
  bytes: number;
  truncated: boolean;
  redactedKeys: string[];
};

function configEntries(env: NodeJS.ProcessEnv): Array<[string, string]> {
  return Object.entries(env)
    .filter(
      ([key]) => key.startsWith("TACOS_") || CONFIG_KEYS.has(key) || SECRET_KEY.test(key)
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value ?? ""]);
}

function secretValues(env: NodeJS.ProcessEnv): string[] {
  // Every secret-looking variable, not only the ones the bundle lists, because a log can
  // mention a key that is not part of the exported configuration.
  return Object.entries(env)
    .filter(([key, value]) => SECRET_KEY.test(key) && typeof value === "string" && value.length >= 8)
    .map(([, value]) => String(value))
    .sort((a, b) => b.length - a.length);
}

function redactValue(key: string, value: string): string {
  if (SECRET_KEY.test(key) && value) return "<redacted>";
  return value
    .replace(/(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/g, "$1$2:<redacted>@")
    .replace(/\b(?:sk|tac|ghp|gho|github_pat|pat|glpat|dsh)[-_A-Za-z0-9]{12,}\b/g, "<redacted-token>");
}

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("<redacted>");
  }
  return out
    .replace(/\b(?:sk|tac|ghp|gho|github_pat|pat|glpat|dsh)[-_A-Za-z0-9]{12,}\b/g, "<redacted-token>")
    .replace(/(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/g, "$1$2:<redacted>@")
    .replace(/("(?:api_?key|apiKey|token|secret|password)"\s*:\s*")[^"]+(")/gi, "$1<redacted>$2")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/g, "$1<redacted>");
}

async function tailFile(file: string, maxBytes: number): Promise<string> {
  const stat = await fs.promises.stat(file);
  const start = Math.max(0, stat.size - maxBytes);
  const handle = await fs.promises.open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, stat.size - start));
    await handle.read(buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function harnessLogTail(): Promise<string[]> {
  const root = harnessLogDir();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch {
    return ["(no harness turn logs)"];
  }
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.log(?:\.gz)?$/.test(entry.name))
      .map(async (entry) => {
        const file = path.join(root, entry.name);
        try {
          return { file, name: entry.name, mtime: (await fs.promises.stat(file)).mtimeMs };
        } catch {
          return { file, name: entry.name, mtime: 0 };
        }
      })
  );
  files.sort((a, b) => b.mtime - a.mtime);
  const sections: string[] = [];
  let budget = HARNESS_TOTAL_BYTES;
  for (const item of files.slice(0, HARNESS_FILES)) {
    if (budget <= 0) break;
    try {
      let text: string;
      if (item.name.endsWith(".gz")) {
        const compressed = await fs.promises.readFile(item.file);
        text = zlib.gunzipSync(compressed, { maxOutputLength: budget }).toString("utf8");
      } else {
        text = await tailFile(item.file, Math.min(budget, 128 * 1024));
      }
      const lines = text.split("\n");
      const tail = lines.slice(-HARNESS_LINES).join("\n");
      budget -= Buffer.byteLength(tail);
      sections.push(`--- ${item.name} ---\n${tail}`);
    } catch {
      sections.push(`--- ${item.name} ---\n(log could not be read)`);
    }
  }
  return sections.length > 0 ? sections : ["(no harness turn logs)"];
}

function schemaSection(): string {
  try {
    const db = getDb().$client;
    const meta = db
      .prepare(
        `SELECT
           (SELECT count(*) FROM sqlite_master WHERE type = 'table') AS tables,
           (SELECT count(*) FROM sqlite_master WHERE type = 'index') AS indexes,
           (SELECT count(*) FROM schema_migrations) AS migrations`
      )
      .get() as { tables: number; indexes: number; migrations: number };
    const sqlite = db.prepare("SELECT sqlite_version() AS version").get() as { version: string };
    return [
      `schema_version: ${db.pragma("schema_version", { simple: true })}`,
      `sqlite_version: ${sqlite.version}`,
      `journal_mode: ${db.pragma("journal_mode", { simple: true })}`,
      `tables: ${meta.tables}`,
      `indexes: ${meta.indexes}`,
      `schema_migrations: ${meta.migrations}`,
      `integrity_check: ${fullIntegrityCheck()}`,
    ].join("\n");
  } catch (error) {
    return `schema metadata unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function buildDiagnosticsBundle(
  options: { maxBytes?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<DiagnosticsBundle> {
  const env = options.env ?? process.env;
  const maxBytes = options.maxBytes ?? DIAGNOSTICS_MAX_BYTES;
  const secrets = secretValues(env);
  const health = await systemHealth();
  const backups = await listBackupFiles();
  const config = configEntries(env).map(([key, value]) => `${key}=${redactValue(key, value)}`);
  const [serverLog, harness] = await Promise.all([
    readRecentServerLog(SERVER_LOG_BYTES),
    harnessLogTail(),
  ]);
  const header = [
    "TaCos diagnostics bundle",
    `generated_at: ${new Date().toISOString()}`,
    `version: ${appVersion()}`,
    `channel: ${UPDATE_CHANNEL}`,
    `mode: ${isServerMode() ? "server" : "desktop"}`,
    `node: ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    `uptime_seconds: ${Math.floor(process.uptime())}`,
    `data_dir: ${DATA_DIR}`,
    `backup_dir: ${backupRoot()}`,
    `log_dir: ${opsLogDir()}`,
    "contents: redacted configuration, schema metadata, integrity result, operations log,",
    "recent harness turn logs. No database rows, accounts, tasks or documents are included.",
  ].join("\n");
  const sections = [
    header,
    `## Configuration\n${config.join("\n")}`,
    `## Schema\n${schemaSection()}`,
    `## Health\nstatus: ${health.status}\ndatabase_integrity: ${health.database.integrity}\n` +
      `database_bytes: ${health.database.sizeBytes}\nwal_bytes: ${health.database.walBytes}\n` +
      `uploads_bytes: ${health.uploads.bytes}\ndisk_free_bytes: ${health.disk.freeBytes}\n` +
      `last_backup: ${health.backup.lastRunAt ?? "never"}`,
    `## Backups on disk\n${
      backups
        .slice(0, 30)
        .map(
          (backup) =>
            `${backup.name}  ${backup.createdAt}  ${backup.dbBytes} bytes  ` +
            `version=${backup.manifest?.appVersion ?? "unknown"}`
        )
        .join("\n") || "(none)"
    }`,
    `## Server log\n${serverLog || "(no operations log entries)"}`,
    `## Harness turn logs\n${harness.join("\n\n")}`,
  ];
  let body = redact(sections.join("\n\n"), secrets);
  const redactedKeys = configEntries(env)
    .filter(([key, value]) => SECRET_KEY.test(key) && value)
    .map(([key]) => key);
  let truncated = false;
  const bytes = Buffer.byteLength(body);
  if (bytes > maxBytes) {
    truncated = true;
    const note = `\n\n[truncated: bundle reached the ${maxBytes} byte cap]`;
    const room = Math.max(0, maxBytes - Buffer.byteLength(note));
    body = Buffer.from(body).subarray(0, room).toString("utf8").replace(/\uFFFD+$/, "") + note;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    filename: `tacos-diagnostics-${appVersion()}-${stamp}.txt`,
    body,
    bytes: Buffer.byteLength(body),
    truncated,
    redactedKeys,
  };
}
