import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getSessionUser } from "@/lib/auth";
import { EXPORT_DIR, getTransferJob } from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";
import { verifyTransferToken } from "@/lib/transfer/sign";

/**
 * A signed URL is a capability, not a login: the download still has to come from a
 * signed-in owner or admin of the workspace the job exported. The token adds the short
 * expiry and ties the URL to one job.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const claim = verifyTransferToken(token);
  if (!claim) {
    return Response.json(
      { error: "This download link has expired. Open Settings → Export again." },
      { status: 410, headers: { "Cache-Control": "no-store" } }
    );
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in to download this export" }, { status: 401 });
  const job = await getTransferJob(claim.jobId);
  if (!job || job.kind !== "export" || job.status !== "done" || !job.artifactPath) {
    return Response.json({ error: "Export not found" }, { status: 404 });
  }
  try {
    await requireTransferRole(job.workspaceId);
  } catch {
    return Response.json({ error: "Export not found" }, { status: 404 });
  }
  const resolved = path.resolve(job.artifactPath);
  if (!resolved.startsWith(path.resolve(EXPORT_DIR) + path.sep)) {
    return Response.json({ error: "Export not found" }, { status: 404 });
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    return Response.json({ error: "The archive is no longer available. Start a new export." }, { status: 404 });
  }
  const name = (job.artifactName ?? "workspace-export.zip").replace(/["\r\n]/g, "");
  return new Response(Readable.toWeb(fs.createReadStream(resolved)) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="workspace-export.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
