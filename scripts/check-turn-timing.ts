/**
 * Pass condition of docs/plans/team-2.3.md item 2: a turn writes every timing segment, and the
 * tool shim counts network time apart from the wait for a person's answer.
 *   npx tsx scripts/check-turn-timing.ts
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { readToolTimings, turnTimer, writeTurnTiming } from "../src/lib/harness/turn-timing";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-timing-"));
process.env.TACOS_LOG_DIR = dir;

let clock = 1000;
const timer = turnTimer(() => clock);
clock = 1500;
timer.event({ type: "step", id: "a", title: "x", status: "running" } as never);
timer.event({ type: "step", id: "a", title: "x", status: "done" } as never);
clock = 2000;
timer.event({ type: "delta", text: "hi" });
timer.event({ type: "delta", text: "there" });
timer.upload(300, 50);
timer.upload(100, 20);
timer.uploadRetry();
clock = 5000;
timer.event({ type: "done" });
clock = 5400;
const toolFile = path.join(dir, "tools.jsonl");
fs.writeFileSync(
  toolFile,
  [
    { tool: "tools/list", ms: 100, approvalMs: 0, bytes: 900 },
    { tool: "get_doc", ms: 400, approvalMs: 0, bytes: 2000 },
    { tool: "edit_doc", ms: 200, approvalMs: 1000, bytes: 40 },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n") + "\n{half"
);
const timing = writeTurnTiming("run-1", "turn", "pi", timer, toolFile);
assert(timing.totalMs === 4400 && timing.firstTextMs === 1000 && timing.doneMs === 4000, "turn times");
assert(timing.steps === 1, "a step counts once");
assert(timing.tools.calls === 2 && timing.tools.ms === 600 && timing.tools.maxMs === 400, "tool time");
assert(timing.tools.bytes === 2040 && timing.tools.listMs === 100, "tool bytes and listing");
assert(timing.approvalWaitMs === 1000, "wait for a person");
assert(timing.modelMs === 2300, "model time leaves out tools and the wait");
assert(timing.upload.batches === 2 && timing.upload.ms === 400 && timing.upload.retries === 1, "upload");
assert(timing.upload.afterDoneMs === 400, "upload after done");
assert(!fs.existsSync(toolFile), "shim file removed");
const row = JSON.parse(fs.readFileSync(path.join(dir, "harness", "timing.jsonl"), "utf8").trim());
assert(row.runId === "run-1" && row.harness === "pi" && row.upload.bytes === 70, "log row");

async function main() {
  // The real shim against a loopback server that says it waited 300 ms for a person.
  const server = http.createServer((req, res) => {
    const wait = req.method === "POST" ? 300 : 0;
    setTimeout(() => {
      res.setHeader("x-tacos-approval-ms", String(wait));
      res.end(JSON.stringify(req.method === "POST" ? { content: [] } : { tools: [] }));
    }, wait);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const file = path.join(dir, "shim.jsonl");
  const shim = spawn(process.execPath, [path.join(import.meta.dirname, "agent-mcp.mjs")], {
    env: {
      ...process.env,
      TACOS_AGENT_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      TACOS_AGENT_TOKEN: "t",
      TACOS_TIMING_FILE: file,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const replies = new Promise<void>((resolve) => {
    let seen = 0;
    shim.stdout.on("data", (chunk) => {
      seen += String(chunk).trim().split("\n").length;
      if (seen >= 2) resolve();
    });
  });
  shim.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
  shim.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_doc", arguments: {} } })}\n`
  );
  await replies;
  shim.kill();
  server.close();
  const lines = readToolTimings(file);
  const call = lines.find((line) => line.tool === "get_doc");
  assert(lines.some((line) => line.tool === "tools/list"), "shim notes the listing");
  assert(call && call.approvalMs === 300 && call.ms < 250 && call.bytes > 0, `shim splits the wait: ${JSON.stringify(call)}`);

}

main().then(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("check-turn-timing: pass");
});
