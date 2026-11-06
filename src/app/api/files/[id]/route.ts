import { imagePreview } from "@/lib/image-preview";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { threadOfPage } from "@/lib/agent-attachments";
import { AGENT_DRAFT_PAGE } from "@/lib/agent-attachments.shared";
import { canSeeThread } from "@/lib/agent-threads";
import { requireWorkspace, getSessionUser } from "@/lib/auth";
import { UPLOAD_DIR, attachmentImageType, getAttachment } from "@/lib/attachments";
import { getPage } from "@/lib/pages";
import { canReadRetainedAttachment } from "@/lib/attachment-references";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const row = await getAttachment(id);
  if (!row || !row.complete) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    await requireWorkspace(row.workspaceId);
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const threadId = threadOfPage(row.pageId);
  const allowed = row.pageId.startsWith("retained:")
    ? await canReadRetainedAttachment(row.workspaceId,user.id,row.id)
    : threadId
    ? await canSeeThread(row.workspaceId, user.id, threadId)
    : row.pageId === AGENT_DRAFT_PAGE
      ? row.uploaderId === user.id
      : Boolean(await getPage(row.workspaceId, row.pageId, user.id));
  if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
  const file = path.join(UPLOAD_DIR, row.id);
  if (!fs.existsSync(file)) return Response.json({ error: "Not found" }, { status: 404 });
  const image = attachmentImageType(row.id);
  const name = encodeURIComponent(row.name);
  if(new URL(_req.url).searchParams.get("preview")==="1"){
    if(!image)return Response.json({error:"Not an image"},{status:415});
    try{const preview=await imagePreview(row.id);return new Response(new Uint8Array(preview),{headers:{"Content-Type":"image/webp","Content-Length":String(preview.length),"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"}});}catch{return Response.json({error:"Download the original to view this image."},{status:422});}
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": image ?? "application/octet-stream",
      "Content-Length": String(fs.statSync(file).size),
      "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
