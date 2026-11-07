import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IMPORT_DIR } from "@/lib/transfer/jobs";
import { TacosError } from "@/lib/tacos-error";
import { ZipWriter, ZipReader } from "@/lib/transfer/zip";

export const IMPORT_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;

export type ImportSourceMeta = {
  id: string;
  workspaceId: string;
  createdBy: string;
  fileName: string;
  bytes: number;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
};

export function importMaxBytes(): number {
  const mb = Number(process.env.TACOS_IMPORT_MAX_MB);
  return (mb > 0 ? mb : 256) * 1024 * 1024;
}

function metadataPath(id: string): string {
  return path.join(IMPORT_DIR, `${id}.json`);
}

export function importSourcePath(id: string): string {
  return path.join(IMPORT_DIR, `${id}.zip`);
}

/**
 * Hash the logical archive, not its bytes: re-zipping the same folder changes the
 * timestamps but must still be recognised as the same import on a retry.
 */
export async function fingerprintZip(filePath: string): Promise<string> {
  const reader = await ZipReader.open(filePath);
  try {
    const hash = crypto.createHash("sha256");
    const entries = reader
      .list()
      .filter((entry) => !entry.directory && !/^__MACOSX\//.test(entry.name) && !/\.DS_Store$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      hash.update(entry.name.replace(/\\/g, "/"));
      hash.update("\u0000");
      hash.update(String(entry.uncompressedSize));
      hash.update("\u0000");
      hash.update(String(entry.crc));
      hash.update("\n");
    }
    return hash.digest("hex");
  } finally {
    await reader.close();
  }
}

/** Moves a finished upload into the staging directory and records who may use it. */
export async function registerImportSource(input: {
  workspaceId: string;
  createdBy: string;
  fileName: string;
  bytes: number;
  fingerprint: string;
}): Promise<ImportSourceMeta> {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  const id = crypto.randomBytes(24).toString("hex");
  const at = new Date();
  const meta: ImportSourceMeta = {
    id,
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
    fileName: input.fileName.slice(0, 200),
    bytes: input.bytes,
    fingerprint: input.fingerprint,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + IMPORT_SOURCE_TTL_MS).toISOString(),
  };
  await fs.promises.writeFile(metadataPath(id), JSON.stringify(meta), { mode: 0o600 });
  return meta;
}

export async function readImportSource(
  id: string,
  workspaceId: string,
  userId: string
): Promise<ImportSourceMeta> {
  if (!/^[a-f0-9]{48}$/.test(id)) throw new TacosError("Import preview not found", 404);
  let meta: ImportSourceMeta;
  try {
    meta = JSON.parse(await fs.promises.readFile(metadataPath(id), "utf8")) as ImportSourceMeta;
  } catch {
    throw new TacosError("Import preview expired. Choose the file again.", 404);
  }
  if (meta.workspaceId !== workspaceId || meta.createdBy !== userId) {
    throw new TacosError("Import preview not found", 404);
  }
  if (new Date(meta.expiresAt).getTime() < Date.now()) {
    await deleteImportSource(id);
    throw new TacosError("Import preview expired. Choose the file again.", 404);
  }
  if (!fs.existsSync(importSourcePath(id))) {
    throw new TacosError("Import file is no longer available. Choose it again.", 404);
  }
  return meta;
}

export async function deleteImportSource(id: string): Promise<void> {
  await Promise.all([
    fs.promises.rm(metadataPath(id), { force: true }),
    fs.promises.rm(importSourcePath(id), { force: true }),
  ]);
}

export async function sweepImportSources(): Promise<void> {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  for (const name of await fs.promises.readdir(IMPORT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    try {
      const meta = JSON.parse(
        await fs.promises.readFile(path.join(IMPORT_DIR, name), "utf8")
      ) as ImportSourceMeta;
      if (new Date(meta.expiresAt).getTime() < Date.now()) await deleteImportSource(id);
    } catch {
      await fs.promises.rm(path.join(IMPORT_DIR, name), { force: true });
    }
  }
}

/** The ZIP entry name is also the document's folder path, so clean it here. */
function entryName(raw: string): string {
  const name = raw
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .replace(/^\/+/, "")
    .slice(0, 400);
  return name || "Untitled";
}

function storeNotCompress(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|zip|pdf|mp4|mov)$/i.test(name);
}

/**
 * A folder picker, a CSV file and a single Markdown file all become one staged ZIP.
 * That gives preview and apply the same reader and one fingerprint per source.
 */
export async function buildImportZip(
  dest: string,
  files: Array<{ name: string; data: Buffer }>
): Promise<void> {
  if (files.length === 0) throw new TacosError("Choose a ZIP, CSV or folder to import", 400);
  const writer = new ZipWriter(dest);
  const used = new Set<string>();
  try {
    for (const file of files) {
      let name = entryName(file.name);
      const base = name;
      for (let n = 2; used.has(name); n++) {
        const dot = base.lastIndexOf(".");
        name = dot > 0 ? `${base.slice(0, dot)} (${n})${base.slice(dot)}` : `${base} (${n})`;
      }
      used.add(name);
      await writer.addBuffer(name, file.data, { store: storeNotCompress(name) });
    }
    await writer.finish();
  } catch (error) {
    writer.abort();
    await fs.promises.rm(dest, { force: true });
    throw error;
  }
}
