import { eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/client";
import { attachments } from "../db/schema";
import {
  AGENT_ATTACHMENT_MAX_COUNT,
  AGENT_DRAFT_PAGE,
  type AgentAttachment,
} from "./agent-attachments.shared";
import { UPLOAD_DIR, attachmentImageType } from "./attachments";
import { fileName, type TurnFile } from "./harness/turn-files";
import { TacosError } from "./issues";

export const threadPage = (threadId: string) => `thread:${threadId}`;

export function threadOfPage(pageId: string): string | null {
  return pageId.startsWith("thread:") ? pageId.slice("thread:".length) : null;
}

export function parseAttachmentIds(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
    throw new TacosError("Attachments must be a list of file ids", 400);
  }
  if (raw.length > AGENT_ATTACHMENT_MAX_COUNT) {
    throw new TacosError("Too many attachments", 400, `Send at most ${AGENT_ATTACHMENT_MAX_COUNT} files per message.`);
  }
  return [...new Set(raw as string[])];
}

/** Moves this person's finished drafts onto the thread, so whoever sees the thread sees them. */
export async function bindTurnAttachments(
  workspaceId: string,
  userId: string,
  threadId: string,
  ids: string[]
): Promise<AgentAttachment[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = await db.select().from(attachments).where(inArray(attachments.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const found = ids.map((id) => byId.get(id));
  for (const row of found) {
    if (
      !row ||
      row.workspaceId !== workspaceId ||
      row.uploaderId !== userId ||
      row.pageId !== AGENT_DRAFT_PAGE ||
      !row.complete
    ) {
      throw new TacosError("An attached file is no longer available", 400, "Attach it again.");
    }
  }
  const out: AgentAttachment[] = [];
  for (const row of found) {
    await db.update(attachments).set({ pageId: threadPage(threadId) }).where(eq(attachments.id, row!.id));
    out.push({ id: row!.id, name: row!.name, image: Boolean(attachmentImageType(row!.id)) });
  }
  return out;
}

/** A turn on this machine reads named copies: the store's own files have no extension. */
export function copyTurnFiles(files: AgentAttachment[], dir: string): TurnFile[] {
  return files.map((file) => {
    const folder = path.join(dir, file.id);
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, fileName(file.name, file.id));
    fs.copyFileSync(path.join(UPLOAD_DIR, file.id), target);
    return { name: file.name, path: target };
  });
}
