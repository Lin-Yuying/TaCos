import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/db/client";
import { DATA_DIR } from "./data-dir";
const dir = path.join(DATA_DIR, "key-usage");
const journal = path.join(dir, `${process.pid}-${crypto.randomUUID()}.jsonl`);
let chain = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | null = null;
type Use = { id: string; at: string; ip?: string };
export type ApiKeyUse = { at: string; ip: string | null };
function decode(text: string): Use[] {
  return text.split("\n").flatMap((line) => {
    try {
      const row = JSON.parse(line) as Use;
      return typeof row.id === "string" && typeof row.at === "string" ? [row] : [];
    } catch {
      return [];
    }
  });
}
function apply(rows: Use[]) {
  const latest = new Map<string, ApiKeyUse>();
  for (const row of rows) {
    const previous = latest.get(row.id);
    if (!previous || row.at > previous.at) latest.set(row.id, { at: row.at, ip: row.ip ?? null });
    else if (row.at === previous.at && !previous.ip && row.ip) previous.ip = row.ip;
  }
  const db = getDb().$client;
  db.transaction(() => {
    const update = db.prepare(
      "UPDATE api_keys SET last_used_at=?, last_used_ip=CASE WHEN ? IS NULL THEN last_used_ip ELSE ? END WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?)"
    );
    for (const [id, use] of latest) update.run(use.at, use.ip, use.ip, id, use.at);
  }).immediate();
}
export function flushApiKeyUsage(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const operation = chain.then(async () => {
    await fs.mkdir(dir, { recursive: true });
    const ready = `${journal}.${crypto.randomUUID()}.ready`;
    try {
      await fs.rename(journal, ready);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const name of await fs.readdir(dir)) {
      const pid = Number(name.split("-")[0]);
      let orphan = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        orphan = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
      if (!name.endsWith(".ready") && !orphan) continue;
      const file = path.join(dir, name);
      try {
        apply(decode(await fs.readFile(file, "utf8")));
        await fs.rm(file, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  });
  chain = operation.catch(() => {});
  return operation;
}
/** Persist each true event before returning; only the folded SQLite write is delayed. */
export async function recordApiKeyUsage(id: string, at: string, ip: string | null = null): Promise<void> {
  const operation = chain.then(async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(journal, JSON.stringify({ id, at, ...(ip ? { ip } : {}) }) + "\n", { mode: 0o600 });
  });
  chain = operation.catch(() => {});
  try {
    await operation;
  } catch {
    apply([{ id, at, ip: ip ?? undefined }]);
  }
  if (!timer) {
    timer = setTimeout(() => {
      void flushApiKeyUsage().catch((error) => console.error("Key usage:", error));
    }, 1000);
    timer.unref?.();
  }
}
/** Infrequent settings reads include unflushed journals from every process. */
export async function pendingApiKeyUsage(): Promise<Map<string, ApiKeyUse>> {
  await chain;
  const latest = new Map<string, ApiKeyUse>();
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return latest;
  }
  // Rename is not a commit: retry enumeration if a flush moved an active file.
  for (let attempt = 0; attempt < 5; attempt++) {
    let moved = false;
    for (const name of names) {
      try {
        for (const row of decode(await fs.readFile(path.join(dir, name), "utf8"))) {
          const previous = latest.get(row.id);
          if (!previous || row.at > previous.at) latest.set(row.id, { at: row.at, ip: row.ip ?? null });
          else if (row.at === previous.at && !previous.ip && row.ip) previous.ip = row.ip;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") moved = true;
        else throw error;
      }
    }
    if (!moved) break;
    names = await fs.readdir(dir);
  }
  return latest;
}
