// U-12: a small server-side operations log the diagnostics bundle can export.
// Next writes request logs to stdout; on a Linux server those live in journald. This file
// records the operations the System page cares about (boot, backup, restore, upgrade
// checks) and is capped so it can be attached to a support request. It contains no task,
// document, comment or account rows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

export function opsLogDir(): string {
  return process.env.TACOS_LOG_DIR?.trim() || path.join(os.homedir(), ".tacos", "logs");
}

export function opsLogFile(): string {
  return path.join(opsLogDir(), "server.log");
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size < MAX_BYTES) return;
    fs.renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or another process rotated it first.
  }
}

/** Fire-and-forget: logging must never fail the operation it describes. */
export function recordServerEvent(
  level: "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    fs.mkdirSync(opsLogDir(), { recursive: true, mode: 0o700 });
    const file = opsLogFile();
    rotateIfNeeded(file);
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      ...(data ?? {}),
    });
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch {
    // The System page reports health; a failed log write is not a user-visible failure.
  }
}

/** The newest `maxBytes` of the current log, plus a short tail of the previous file. */
export async function readRecentServerLog(maxBytes = 512 * 1024): Promise<string> {
  const file = opsLogFile();
  async function tail(candidate: string, cap: number): Promise<string> {
    try {
      const stat = await fs.promises.stat(candidate);
      const start = Math.max(0, stat.size - cap);
      const handle = await fs.promises.open(candidate, "r");
      try {
        const buffer = Buffer.alloc(Math.min(cap, stat.size - start));
        await handle.read(buffer, 0, buffer.length, start);
        return buffer.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return "";
    }
  }
  const current = await tail(file, maxBytes);
  if (current.length > 0) return current;
  return tail(`${file}.1`, maxBytes);
}
