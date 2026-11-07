import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { errorResponse } from "@/lib/api-auth";
import { previewWorkspaceImport } from "@/lib/import/job";
import {
  buildImportZip,
  fingerprintZip,
  importMaxBytes,
  importSourcePath,
  registerImportSource,
} from "@/lib/import/source";
import { TacosError } from "@/lib/tacos-error";
import { IMPORT_DIR } from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";

function megabytes(bytes: number): string {
  return String(Math.round(bytes / 1024 / 1024));
}

async function readUploadedFile(file: File): Promise<Buffer> {
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > importMaxBytes()) {
    throw new TacosError(`Import files are limited to ${megabytes(importMaxBytes())} MB`, 413);
  }
  return buffer;
}

/**
 * U-05 import preview. This is an internal, session-scoped endpoint for the Settings
 * page — v1 exposes no import API for automation. It stages the upload under
 * <data>/imports and parses it, returning counts and conflicts without writing any
 * workspace rows.
 */
export async function POST(req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  let sourceId: string | null = null;
  const temp = path.join(IMPORT_DIR, `.upload-${crypto.randomUUID()}`);
  try {
    const { user } = await requireTransferRole(workspaceId);
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > importMaxBytes()) {
      throw new TacosError(`Import files are limited to ${megabytes(importMaxBytes())} MB`, 413);
    }
    const form = await req.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (files.length === 0) throw new TacosError("Choose a ZIP, CSV or folder to import", 400);
    const paths = form.getAll("paths").map((value) => String(value));
    const workspaceName = String(form.get("workspaceName") ?? "").trim();
    const includeAttachments = String(form.get("includeAttachments") ?? "true") !== "false";
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > importMaxBytes()) {
      throw new TacosError(`Import files are limited to ${megabytes(importMaxBytes())} MB`, 413);
    }
    fs.mkdirSync(IMPORT_DIR, { recursive: true });

    let fileName: string;
    if (files.length === 1 && /\.zip$/i.test(files[0].name) && !paths[0]) {
      fileName = files[0].name;
      await fs.promises.writeFile(temp, await readUploadedFile(files[0]));
    } else {
      // Keep the picked file's own name for the preview; only folder/multi-file
      // imports get the synthetic "<folder>.zip" label.
      fileName =
        files.length === 1 && !paths[0]
          ? files[0].name
          : (paths[0]?.split("/")[0] || files[0].name.replace(/\.(csv|md|markdown|txt)$/i, "")) + ".zip";
      const entries: Array<{ name: string; data: Buffer }> = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        entries.push({
          name: paths[index] || (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          data: await readUploadedFile(file),
        });
      }
      await buildImportZip(temp, entries);
    }
    const bytes = (await fs.promises.stat(temp)).size;
    if (bytes > importMaxBytes()) {
      throw new TacosError(`Import files are limited to ${megabytes(importMaxBytes())} MB`, 413);
    }
    const fingerprint = await fingerprintZip(temp);
    const source = await registerImportSource({
      workspaceId,
      createdBy: user.id,
      fileName,
      bytes,
      fingerprint,
    });
    sourceId = source.id;
    await fs.promises.rename(temp, importSourcePath(source.id));
    const preview = await previewWorkspaceImport({
      workspaceId,
      sourceId: source.id,
      options: {
        includeAttachments,
        ...(workspaceName ? { workspaceName } : {}),
      },
    });
    return Response.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await fs.promises.rm(temp, { force: true });
    if (sourceId) {
      const { deleteImportSource } = await import("@/lib/import/source");
      await deleteImportSource(sourceId).catch(() => {});
    }
    return errorResponse(error);
  }
}
