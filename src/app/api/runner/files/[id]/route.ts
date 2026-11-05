import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { threadOfPage } from "@/lib/agent-attachments";
import { UPLOAD_DIR, getAttachment } from "@/lib/attachments";
import { runnerUserFor } from "@/lib/runner/hub";

/** A member's runner fetches only the files that member sent with a turn. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await runnerUserFor(request);
  if (!userId) return Response.json({ error: "Runner token is not valid" }, { status: 401 });
  const { id } = await ctx.params;
  const row = await getAttachment(id);
  if (!row || !row.complete || row.uploaderId !== userId || !threadOfPage(row.pageId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const file = path.join(UPLOAD_DIR, row.id);
  if (!fs.existsSync(file)) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(fs.statSync(file).size) },
  });
}
