/**
 * Pass condition of docs/plans/team-2.3.md item 4: files sent from the composer reach the model.
 *   node --import tsx scripts/check-composer-attachments.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-composer-files-"));
process.env.TACOS_DATA_DIR = dir;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  const { attachTurnFiles, fileName } = await import("../src/lib/harness/turn-files");
  const { messageWithAttachments, splitAttachments, AGENT_DRAFT_PAGE } = await import(
    "../src/lib/agent-attachments.shared"
  );
  const { bindTurnAttachments, parseAttachmentIds, threadPage } = await import("../src/lib/agent-attachments");
  const { UPLOAD_DIR } = await import("../src/lib/attachments");
  const { getDb } = await import("../src/db/client");
  const { attachments } = await import("../src/db/schema");

  const write = (name: string, bytes: Buffer | string) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return { name, path: file };
  };
  const prompt = { system: "sys", body: "body" };
  const image = write("red.png", PNG);
  const text = write("notes.txt", "hello harness");
  const binary = write("data.bin", Buffer.from([0, 1, 2, 3]));
  const long = write("long.txt", "x".repeat(200 * 1024 + 1));

  const codex = attachTurnFiles("codex", prompt, [image, text, binary, long]);
  assert.deepEqual(codex.images, [{ name: "red.png", path: image.path, mime: "image/png" }], "an image uses the image input");
  assert.ok(codex.prompt.body.includes("hello harness"), "text is inlined");
  assert.ok(codex.prompt.body.includes(binary.path), "a binary file is named with its path");
  assert.ok(!codex.prompt.body.includes("xxxx"), "too long a text is not inlined");
  assert.ok(codex.prompt.body.includes(long.path), "too long a text is named with its path");

  const dsh = attachTurnFiles("dsh", prompt, [image]);
  assert.equal(dsh.images.length, 0, "dsh has no image input");
  assert.ok(dsh.prompt.body.includes("cannot see images"), "the model can say so");
  assert.equal(attachTurnFiles("pi", prompt, []).prompt, prompt, "no files leave the prompt alone");

  assert.equal(fileName("../../etc/a b.png", "id"), "a_b.png");
  assert.equal(fileName("...", "id"), "id");

  const id1 = "11111111-1111-4111-8111-111111111111";
  const id2 = "22222222-2222-4222-8222-222222222222";
  const stored = messageWithAttachments("look\n[not a file](x)", [
    { id: id1, name: "a]b.png", image: true },
    { id: id2, name: "c.txt", image: false },
  ]);
  const split = splitAttachments(stored);
  assert.equal(split.text, "look\n[not a file](x)", "the text survives");
  assert.deepEqual(split.files.map((file) => [file.id, file.image]), [[id1, true], [id2, false]]);
  assert.equal(splitAttachments("only text").files.length, 0);

  assert.throws(() => parseAttachmentIds(new Array(11).fill(0).map((_, i) => String(i))), /Too many/);
  assert.throws(() => parseAttachmentIds([1]), /list of file ids/);

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, id1), PNG);
  const row = {
    id: id1,
    workspaceId: "w1",
    pageId: AGENT_DRAFT_PAGE,
    uploaderId: "u1",
    name: "red.png",
    size: PNG.length,
    complete: 1,
    createdAt: new Date().toISOString(),
  };
  await getDb().insert(attachments).values([row, { ...row, id: id2, name: "c.txt", complete: 0 }]);
  await assert.rejects(bindTurnAttachments("w1", "u2", "t1", [id1]), /no longer available/, "another person's draft");
  await assert.rejects(bindTurnAttachments("w2", "u1", "t1", [id1]), /no longer available/, "another workspace");
  await assert.rejects(bindTurnAttachments("w1", "u1", "t1", [id2]), /no longer available/, "an unfinished upload");
  const bound = await bindTurnAttachments("w1", "u1", "t1", [id1]);
  assert.deepEqual(bound, [{ id: id1, name: "red.png", image: true }]);
  const [after] = await getDb().select().from(attachments);
  assert.equal(after!.pageId, threadPage("t1"), "the draft moved onto the thread");
  await assert.rejects(bindTurnAttachments("w1", "u1", "t2", [id1]), /no longer available/, "a file binds once");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("PASS composer files reach the model");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
