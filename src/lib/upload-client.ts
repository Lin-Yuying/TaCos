import Uppy from "@uppy/core";
import Tus from "@uppy/tus";

// Below the 10 MB that Next's middleware buffers per request.
const CHUNK_BYTES = 5 * 1024 * 1024;

/** Sends one file to a page in chunks that survive a dropped tunnel. Returns its address. */
export async function uploadPageFile(
  workspaceId: string,
  pageId: string,
  file: File
): Promise<{ id: string; url: string }> {
  const uppy = new Uppy({ autoProceed: false }).use(Tus, {
    endpoint: "/api/uploads",
    chunkSize: CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 8000],
    removeFingerprintOnSuccess: true,
    allowedMetaFields: ["workspaceId", "pageId", "name"],
  });
  try {
    uppy.addFile({ name: file.name, type: file.type, data: file, meta: { workspaceId, pageId } });
    const result = await uppy.upload();
    const location = result?.successful?.[0]?.uploadURL;
    if (!location) {
      const message = result?.failed?.[0]?.error ?? "Upload failed";
      throw new Error(/\b413\b/.test(String(message)) ? "File is over the upload limit" : String(message));
    }
    const id = location.split("/").pop() ?? "";
    return { id, url: `/api/files/${id}` };
  } finally {
    uppy.destroy();
  }
}
