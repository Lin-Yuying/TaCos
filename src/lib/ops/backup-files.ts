// U-12: read backup folders from disk. The systemd timer writes date-named folders; the
// in-app backup writes a manifest beside the database copy. Both are readable here, so the
// System page can show the newest backup even before the first in-app run.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/data-dir";

export type BackupManifest = {
  format: 1;
  kind: string;
  appVersion: string;
  createdAt: string;
  integrity: string;
  sha256?: string;
  dbBytes?: number;
  uploadsBytes?: number;
  schemaVersion?: number;
};

export type BackupFileInfo = {
  name: string;
  dir: string;
  createdAt: string;
  dbBytes: number;
  uploadsBytes: number | null;
  manifest: BackupManifest | null;
};

export function backupRoot(): string {
  return process.env.TACOS_BACKUP_DIR?.trim() || path.join(path.dirname(DATA_DIR), "backups");
}

export async function readBackupManifest(dir: string): Promise<BackupManifest | null> {
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(path.join(dir, "manifest.json"), "utf8")
    ) as Partial<BackupManifest> & Record<string, unknown>;
    if (parsed.format !== 1 || typeof parsed.createdAt !== "string") return null;
    return {
      format: 1,
      kind: typeof parsed.kind === "string" ? parsed.kind : "backup",
      appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "",
      createdAt: parsed.createdAt,
      integrity: typeof parsed.integrity === "string" ? parsed.integrity : "",
      sha256: typeof parsed.sha256 === "string" ? parsed.sha256 : undefined,
      dbBytes: typeof parsed.dbBytes === "number" ? parsed.dbBytes : undefined,
      uploadsBytes: typeof parsed.uploadsBytes === "number" ? parsed.uploadsBytes : undefined,
      schemaVersion:
        typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined,
    };
  } catch {
    return null;
  }
}

async function size(file: string): Promise<number> {
  try {
    return (await fs.promises.stat(file)).size;
  } catch {
    return 0;
  }
}

/** Backups under the configured root, newest first. Folders without a database are ignored. */
export async function listBackupFiles(): Promise<BackupFileInfo[]> {
  const root = backupRoot();
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: BackupFileInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const dbBytes = await size(path.join(dir, "tacos.db"));
    if (dbBytes <= 0) continue;
    const manifest = await readBackupManifest(dir);
    let mtime = new Date(0);
    try {
      mtime = (await fs.promises.stat(path.join(dir, "tacos.db"))).mtime;
    } catch {
      // Keep the epoch so a folder that vanished mid-scan sorts last.
    }
    rows.push({
      name: entry.name,
      dir,
      createdAt: manifest?.createdAt ?? mtime.toISOString(),
      dbBytes,
      uploadsBytes: manifest?.uploadsBytes ?? null,
      manifest,
    });
  }
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return rows;
}

/** The next daily timer run: the next local midnight. */
export function nextBackupAt(now = new Date()): string {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.toISOString();
}
