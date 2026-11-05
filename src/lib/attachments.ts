import { and, eq, inArray, lt, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { attachments } from "../db/schema";
import { getDb } from "../db/client";
import { DATA_DIR } from "./data-dir";

export type Attachment = typeof attachments.$inferSelect;

export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

function megabytes(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return (value > 0 ? value : fallback) * 1024 * 1024;
}

export const maxUploadBytes = () => megabytes("TACOS_UPLOAD_MAX_MB", 25);
export const workspaceQuotaBytes = () => megabytes("TACOS_WORKSPACE_QUOTA_MB", 5120);

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

export async function getAttachment(id: string): Promise<Attachment | null> {
  const [row] = await getDb().select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return row ?? null;
}

export async function usedBytes(workspaceId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${attachments.size}), 0)` })
    .from(attachments)
    .where(eq(attachments.workspaceId, workspaceId));
  return row?.total ?? 0;
}

function removeFiles(ids: string[]) {
  for (const id of ids) {
    fs.rmSync(path.join(UPLOAD_DIR, id), { force: true });
    fs.rmSync(path.join(UPLOAD_DIR, `${id}.json`), { force: true });
  }
}

/** An upload nobody finished in a day is not coming back; its space is counted until then. */
export async function removeStaleUploads(now = Date.now()): Promise<void> {
  const db = getDb();
  const before = new Date(now - STALE_UPLOAD_MS).toISOString();
  const stale = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(eq(attachments.complete, 0), lt(attachments.createdAt, before)));
  if (!stale.length) return;
  const ids = stale.map((row) => row.id);
  removeFiles(ids);
  await db.delete(attachments).where(inArray(attachments.id, ids));
}

export async function removePageAttachments(pageIds: string[]): Promise<void> {
  if (!pageIds.length) return;
  const db = getDb();
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(inArray(attachments.pageId, pageIds));
  removeFiles(rows.map((row) => row.id));
  await db.delete(attachments).where(inArray(attachments.pageId, pageIds));
}

export async function removeWorkspaceAttachments(workspaceId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.workspaceId, workspaceId));
  removeFiles(rows.map((row) => row.id));
  await db.delete(attachments).where(eq(attachments.workspaceId, workspaceId));
}

/**
 * Only these are ever shown in the page. The type comes from the file's first bytes, not what the
 * uploader said, so an HTML or SVG file named .png downloads instead of running in our origin.
 */
export function sniffImage(head: Buffer): string | null {
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  const ascii = head.toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function attachmentImageType(id: string): string | null {
  const file = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(file)) return null;
  const handle = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(12);
    fs.readSync(handle, head, 0, 12, 0);
    return sniffImage(head);
  } finally {
    fs.closeSync(handle);
  }
}

