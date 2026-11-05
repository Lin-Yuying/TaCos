/**
 * Uploads (docs/plans/team-2.2.md item 9): an over-limit upload is refused, a resumed upload
 * completes, only an editor can start one and only its starter can continue it.
 *   npx tsx scripts/check-uploads.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-uploads-"));
process.env.TACOS_DATA_DIR = dir;
process.env.TACOS_UPLOAD_MAX_MB = "1";
process.env.TACOS_WORKSPACE_QUOTA_MB = "2";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const BASE = "http://localhost/api/uploads";

async function main() {
  const { getDb } = await import("../src/db/client");
  const { workspaceMembers, attachments } = await import("../src/db/schema");
  const { handleUpload } = await import("../src/lib/uploads");
  const lib = await import("../src/lib/attachments");
  const pagesLib = await import("../src/lib/pages");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w1";
  for (const userId of ["owner", "viewer", "editor"]) {
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId, role: "member", createdAt: at } as never);
  }
  const page = await pagesLib.createPage(ws, "owner", { title: "Doc" });
  await pagesLib.setPageShared(ws, page.id, "owner", true);
  await pagesLib.setPageMemberLevel(ws, page.id, "owner", "viewer", "comment");

  const create = (user: string, length: number, meta: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    handleUpload(
      new Request(BASE, {
        method: "POST",
        headers: {
          host: "localhost",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(length),
          "Upload-Metadata": Object.entries({ workspaceId: ws, pageId: page.id, name: "a.bin", ...meta })
            .map(([key, value]) => `${key} ${b64(value)}`)
            .join(","),
          ...headers,
        },
      }),
      user
    );
  const idOf = (res: Response) => res.headers.get("location")!.split("/").pop()!;
  const patch = (user: string, id: string, offset: number, body: Buffer) =>
    handleUpload(
      new Request(`${BASE}/${id}`, {
        method: "PATCH",
        headers: {
          host: "localhost",
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": String(offset),
          "Content-Type": "application/offset+octet-stream",
        },
        body: new Uint8Array(body),
      }),
      user
    );
  const head = (user: string, id: string) =>
    handleUpload(new Request(`${BASE}/${id}`, { method: "HEAD", headers: { host: "localhost", "Tus-Resumable": "1.0.0" } }), user);

  // Over the limit, and each person who may not upload.
  const overLimit = await create("owner", 1024 * 1024 + 1);
  assert(overLimit.status === 413, `over the limit is refused: ${overLimit.status}`);
  const viewerTry = await create("viewer", 10);
  assert(viewerTry.status === 403, `comment level cannot upload: ${viewerTry.status} ${await viewerTry.text()}`);
  assert((await create("stranger", 10)).status === 403, "not a member");
  assert((await create("owner", 10, { pageId: "nope" })).status === 404, "unknown page");
  assert((await create("owner", 10, {}, { Origin: "http://evil.example" })).status === 403, "another site");
  assert(!(await db.select().from(attachments)).length, "nothing refused leaves a row");

  // A resumed upload: half, an interruption, ask where it stopped, the rest.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100_000, 7)]);
  const started = await create("owner", png.length, { name: "shot 图.png" });
  assert(started.status === 201, `create: ${started.status}`);
  const id = idOf(started);
  const half = 60_000;
  assert((await patch("owner", id, 0, png.subarray(0, half))).status === 204, "first half");
  assert(!(await lib.getAttachment(id))?.complete, "not complete at half");
  assert((await head("editor", id)).status === 404, "another person cannot see it");
  assert((await patch("editor", id, half, png.subarray(half))).status === 404, "another person cannot continue it");
  const resumed = await head("owner", id);
  assert(resumed.headers.get("upload-offset") === String(half), "offset survives");
  assert((await patch("owner", id, half + 1, png.subarray(half))).status === 409, "wrong offset refused");
  assert((await patch("owner", id, half, png.subarray(half))).status === 204, "second half");
  assert((await lib.getAttachment(id))?.complete === 1, "complete");
  assert(fs.readFileSync(path.join(lib.UPLOAD_DIR, id)).equals(png), "bytes match");
  assert((await lib.getAttachment(id))?.name === "shot 图.png", "name survives");

  // Type comes from the bytes.
  assert(lib.attachmentImageType(id) === "image/png", "png detected");
  assert(lib.sniffImage(Buffer.from("<svg onload=alert(1)>")) === null, "svg is not shown inline");
  assert(lib.sniffImage(Buffer.from("<!doctype html><script>")) === null, "html is not shown inline");

  // Cover.
  await pagesLib.setPageCover(ws, page.id, "owner", id);
  assert((await pagesLib.getPage(ws, page.id, "owner"))?.cover === id, "cover set");
  const text = await create("owner", 5, { name: "a.txt" });
  const textId = idOf(text);
  await patch("owner", textId, 0, Buffer.from("hello"));
  let coverError = 0;
  await pagesLib.setPageCover(ws, page.id, "owner", textId).catch((err) => (coverError = err.status));
  assert(coverError === 400, "a cover has to be an image");

  // Workspace quota counts what is there.
  await create("owner", 900_000);
  const big = await create("owner", 900_000);
  assert(big.status === 201, "still inside the quota");
  assert((await create("owner", 500_000)).status === 413, "workspace quota");

  // An abandoned upload goes after a day, with its file and space.
  await db.update(attachments).set({ createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }).where(eqIncomplete());
  const before = await lib.usedBytes(ws);
  await lib.removeStaleUploads();
  assert((await lib.usedBytes(ws)) < before, "stale uploads free their space");

  // A purge removes files.
  await pagesLib.deletePage(ws, page.id, "owner");
  await pagesLib.purgePage(ws, page.id, "owner", true);
  assert(!fs.existsSync(path.join(lib.UPLOAD_DIR, id)), "purge removes the file");
  assert(!(await lib.getAttachment(id)), "purge removes the row");
  console.log("check-uploads: ok");

  function eqIncomplete() {
    return sql`complete = 0`;
  }
}

import { sql } from "drizzle-orm";
void main();
