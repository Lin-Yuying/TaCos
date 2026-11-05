/**
 * Pass condition of docs/plans/team-2.3.md item 4: composer attachments reach TurnPayload and TurnInput.
 *   npx tsx scripts/check-composer-attachments.ts
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

async function main() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-composer-attach-"));
  const { buildAgentTurnPayload, materializePayloadAttachments } = await import(
    "../src/lib/agent-composer-attachments"
  );
  const wires = [
    {
      name: "screenshot.png",
      mimeType: "image/png",
      data: Buffer.from("fake-png").toString("base64"),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      data: Buffer.from("hello harness").toString("base64"),
    },
  ];
  const local = buildAgentTurnPayload({ cwd, prompt: { system: "sys", body: "body" }, wires });
  assert(local.payload.length === 2, "TurnPayload carries every attachment");
  assert(local.turnInput.attachments?.length === 2, "TurnInput lists attachments");
  assert(local.turnInput.prompt.body.includes("attachments/screenshot.png"), "prompt manifest lists paths");
  assert(fs.existsSync(path.join(cwd, local.refs[0]!.relPath)), "local turn writes files under cwd");

  const remote = buildAgentTurnPayload({
    cwd: path.join(cwd, "unused"),
    prompt: { system: "sys", body: "remote" },
    wires: [wires[1]!],
    remote: true,
  });
  assert(!fs.existsSync(path.join(cwd, "unused", remote.refs[0]!.relPath)), "remote plan does not write on server");
  assert(remote.payload[0]?.base64.length > 0, "remote payload keeps bytes for the runner");

  const runnerCwd = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-runner-attach-"));
  const runnerRefs = materializePayloadAttachments(runnerCwd, remote.payload);
  assert(runnerRefs[0]?.relPath === remote.refs[0]?.relPath, "runner materializes the same relPath");
  assert(
    fs.readFileSync(path.join(runnerCwd, runnerRefs[0]!.relPath), "utf8") === "hello harness",
    "runner writes attachment bytes"
  );

  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(runnerCwd, { recursive: true, force: true });
  console.log("check-composer-attachments: pass");
}

main();
