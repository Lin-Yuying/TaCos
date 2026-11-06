import { and, eq, sql } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { getDb } from "../db/client";
import { attachments, workspaceMembers } from "../db/schema";
import { AGENT_DRAFT_PAGE } from "./agent-attachments.shared";
import {
  UPLOAD_DIR,
  getAttachment,
  maxUploadBytes,
  removeStaleUploads,
  workspaceQuotaBytes,
} from "./attachments";
import { getPage, requirePageLevel } from "./pages";
import { TacosError } from "./tacos-error";

const sweepAt=new Map<string,number>();
function scheduleUploadSweep(workspaceId:string){if(Date.now()-(sweepAt.get(workspaceId)??0)<60000)return;sweepAt.set(workspaceId,Date.now());if(sweepAt.size>256)sweepAt.delete(sweepAt.keys().next().value!);void removeStaleUploads(Date.now(),workspaceId).catch(error=>console.error("Upload cleanup:",error));}

const uploader = new AsyncLocalStorage<string>();

function refuse(status: number, message: string): { status_code: number; body: string } {
  return { status_code: status, body: `${message}\n` };
}

async function checkCreate(metadata: Record<string, string | null | undefined>, size: number | undefined) {
  const userId = uploader.getStore();
  const workspaceId = metadata.workspaceId;
  const pageId = metadata.pageId;
  if (!userId) throw refuse(401, "Not signed in");
  if (!workspaceId || !pageId) throw refuse(400, "An upload needs a workspace and a page");
  if (size === undefined) throw refuse(400, "An upload needs its length up front");
  const [member] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!member) throw refuse(403, "Forbidden");
  if (pageId !== AGENT_DRAFT_PAGE) {
    const page = await getPage(workspaceId, pageId, userId);
    if (!page) throw refuse(404, "Page not found");
    try {
      await requirePageLevel(page, userId, "edit");
    } catch (err) {
      if (err instanceof TacosError) throw refuse(err.status, err.message);
      throw err;
    }
  }
  if (size > maxUploadBytes()) throw refuse(413, "File is over the upload limit");
  scheduleUploadSweep(workspaceId);
  return { userId, workspaceId, pageId };
}

function createServer() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return new Server({
    path: "/api/uploads",
    datastore: new FileStore({ directory: UPLOAD_DIR }),
    relativeLocation: true,
    maxSize: () => maxUploadBytes(),
    namingFunction: () => crypto.randomUUID(),
    onIncomingRequest: async (req, uploadId) => {
      if (req.method === "POST") return;
      // Only who started an upload may continue it.
      const row = await getAttachment(uploadId);
      if (!row || row.uploaderId !== uploader.getStore()) throw refuse(404, "Upload not found");
    },
    onUploadCreate: async (_req, upload) => {
      const metadata = upload.metadata ?? {};
      const { userId, workspaceId, pageId } = await checkCreate(metadata, upload.size);
      getDb().transaction(tx=>{
      const usage=tx.select({total:sql<number>`coalesce(sum(${attachments.size}),0)`}).from(attachments).where(eq(attachments.workspaceId,workspaceId)).get();
      if(Number(usage?.total??0)+(upload.size??0)>workspaceQuotaBytes())throw refuse(413,"This workspace is out of upload space");
      tx.insert(attachments).values({
        id: upload.id,
        workspaceId,
        pageId,
        uploaderId: userId,
        name: (metadata.name || "file").slice(0, 200),
        size: upload.size ?? 0,
        complete: 0,
        createdAt: new Date().toISOString(),
      }).run();
      },{behavior:"immediate"});
      return {};
    },
    onUploadFinish: async (_req, upload) => {
      await getDb().update(attachments).set({ complete: 1 }).where(eq(attachments.id, upload.id));
      return {};
    },
  });
}

const globalUploads = globalThis as unknown as { __tacosUploads?: ReturnType<typeof createServer> };

/** Runs one tus request for this person. Browsers cannot send it from another site. */
export async function handleUpload(req: Request, userId: string): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return new Response("Forbidden", { status: 403 });
  }
  // A cancelled upload is left to removeStaleUploads, so its row and file go together.
  if (req.method === "DELETE") return new Response(null, { status: 405 });
  globalUploads.__tacosUploads ??= createServer();
  const server = globalUploads.__tacosUploads;
  return uploader.run(userId, () => server.handleWeb(req));
}
