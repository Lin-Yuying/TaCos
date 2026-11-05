/**
 * Pass condition of docs/plans/team-2.2.md item 13: a task handed to the Agent waits while the
 * computer is off and runs when it returns, a write asks by default, and the result comes back as
 * a comment and a notification. Uses the real routes and built runner with a fake pi binary.
 *   npx tsx scripts/check-agent-handoff.ts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const bundle = path.join(root, "dist", "server", "runner");
execFileSync(process.execPath, [path.join(root, "scripts", "bundle-runner.mjs")], { stdio: "ignore" });

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, test: () => boolean | Promise<boolean>, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await test()) return;
    await sleep(100);
  }
  assert(false, `timed out waiting for ${what}`);
}

const SECRET = "sk-check-handoff-0123456789abcd";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-handoff-"));
const serverData = path.join(temp, "server");
const runnerDir = path.join(temp, "runner");
fs.mkdirSync(serverData);
fs.mkdirSync(runnerDir);
process.env.TACOS_DATA_DIR = serverData;
process.env.TACOS_SERVER_MODE = "1";
process.env.TACOS_RUNNER_DIR = runnerDir;
process.env.TACOS_RUNNER_SILENT_MS = "1000";

// Stands in for Pi. "TOOLCALL <task>" in the prompt makes it comment on that task through the tool
// route, the way the MCP bridge does, and report what the route answered.
const fakePi = path.join(temp, "pi");
const piLog = path.join(temp, "pi.log");
fs.writeFileSync(
  fakePi,
  `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("9.9.9"); process.exit(0); }
const say = (m) => console.log(JSON.stringify(m));
const text = args.join(" ");
fs.appendFileSync(${JSON.stringify(piLog)}, JSON.stringify({ text }) + "\\n");
(async () => {
  if (text.includes("SLOWLY")) await new Promise(() => setInterval(() => {}, 1000));
  const call = /TOOLCALL (\\S+)/.exec(text.split("Work on task").pop());
  let said = "finished the work";
  if (call) {
    const answer = await fetch(process.env.TACOS_AGENT_URL + "/api/agent/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.TACOS_AGENT_TOKEN },
      body: JSON.stringify({ name: "add_comment", arguments: { workspace: "HAND", id: call[1], body: "written by the tool" } }),
    }).then((r) => r.json());
    said = answer.isError ? "the write was refused" : "the write went through";
  }
  say({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: said } });
  say({ type: "turn_end", message: { stopReason: "stop" } });
  say({ type: "agent_settled" });
})();
`,
  { mode: 0o755 }
);
process.env.TACOS_PI_BIN = fakePi;

async function main() {
  const { getDb } = await import("../src/db/client");
  const { agentRuns, comments, issues, notifications, projectMembers, projects, users, workspaceMembers, workspaces } =
    await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const hub = await import("../src/lib/runner/hub");
  const handoff = await import("../src/lib/agent-handoff");
  const routes: Record<string, { POST?: (r: Request) => Promise<Response>; GET?: (r: Request) => Promise<Response> }> = {
    "/api/runner/poll": await import("../src/app/api/runner/poll/route"),
    "/api/runner/events": await import("../src/app/api/runner/events/route"),
    "/api/runner/control": await import("../src/app/api/runner/control/route"),
    "/api/runner/approval": await import("../src/app/api/runner/approval/route"),
    "/api/agent/tools": await import("../src/app/api/agent/tools/route"),
  };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const route = routes[(req.url ?? "").split("?")[0]];
    const handler = route?.[req.method as "POST" | "GET"];
    if (!handler) return void res.writeHead(404).end();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const answer = await handler(
      new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === "POST" && chunks.length ? Buffer.concat(chunks) : undefined,
        signal: abort.signal,
      })
    );
    res.writeHead(answer.status, { "Content-Type": "application/json" }).end(await answer.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api = http.createServer((req, res) => {
    if ((req.headers.authorization ?? "") !== `Bearer ${SECRET}`) return void res.writeHead(401).end("{}");
    res.writeHead(200).end(JSON.stringify({ data: [{ id: "model-a" }] }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const keys = require(path.join(bundle, "runner-keys.cjs"));
  await keys.saveKey({ label: "Mine", baseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}/v1`, key: SECRET, models: "" });

  const db = getDb();
  const now = new Date().toISOString();
  for (const id of ["u1", "u2"]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: now } as never);
  }
  await db.insert(workspaces).values({ id: "w1", name: "Hand", key: "HAND", createdBy: "u1", createdAt: now, membersSeeAllTasks: 0 } as never);
  for (const userId of ["u1", "u2"]) {
    await db.insert(workspaceMembers).values({ workspaceId: "w1", userId, role: "member", createdAt: now } as never);
  }
  await db.insert(projects).values({ id: "p1", workspaceId: "w1", key: "HAND", name: "One", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  await db.insert(projectMembers).values({ projectId: "p1", userId: "u1", createdAt: now } as never);
  const task = async (n: number) => {
    const id = `HAND-${n}`;
    await db.insert(issues).values({
      id: `i${n}`, workspaceId: "w1", projectId: "p1", number: n, identifier: id, title: `Task ${n}`, description: "",
      createdBy: "u1", createdAt: now, updatedAt: now,
    } as never);
    return `i${n}`;
  };
  const commentsOn = (issueId: string) => db.select().from(comments).where(eq(comments.issueId, issueId));
  const noticesOn = (issueId: string) => db.select().from(notifications).where(eq(notifications.issueId, issueId));
  const statusOf = async (id: string) =>
    (await db.select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, id)))[0]?.status;
  const refused = async (what: string, work: () => Promise<unknown>, pattern: RegExp) => {
    try {
      await work();
    } catch (err) {
      assert(pattern.test((err as Error).message), `${what}: ${(err as Error).message}`);
      return;
    }
    assert(false, `${what}: was not refused`);
  };

  const one = await task(1);
  await refused("a computer that never connected", () => handoff.handTaskToAgent("w1", one, "u1", { harness: "pi" }), /never connected/);
  console.log("ok   a computer that never connected is refused");

  const pi = { id: "pi", label: "Pi", installed: true, binary: "pi", version: "9", ready: true, error: null, hint: null };
  const capabilities = { harnesses: [pi], models: {}, skills: [], keyed: [], editModel: null } as never;
  await hub.recordRunnerStatus("u1", capabilities);
  await hub.recordRunnerStatus("u2", capabilities);
  await refused("a task the person cannot see", () => handoff.handTaskToAgent("w1", one, "u2", { harness: "pi" }), /not found/i);
  await refused("a harness that is not ready", () => handoff.handTaskToAgent("w1", one, "u1", { harness: "codex" }), /not ready/);
  console.log("ok   a task the person cannot see, and a harness that is not ready, are refused");

  // The computer is off from here on.
  const first = await handoff.handTaskToAgent("w1", one, "u1", { harness: "pi", note: "TOOLCALL HAND-1" });
  await sleep(6500);
  assert((await statusOf(first)) === "queued", "a queued task outlasts the silent limit");
  await hub.failInterruptedRuns();
  assert((await statusOf(first)) === "queued", "a queued task survives a server restart");
  await refused("a second handoff", () => handoff.handTaskToAgent("w1", one, "u1", { harness: "pi" }), /already has/);
  const [thread] = await db.select({ threadId: agentRuns.threadId }).from(agentRuns).where(eq(agentRuns.id, first));
  assert(await handoff.openHandoffOnThread(thread.threadId!), "the conversation is marked busy for chat turns");
  console.log("ok   with the computer off the task stays queued, past the silent limit and a restart");

  // What the Agent reads is the task as it is when the computer takes it.
  await db.update(issues).set({ title: "Renamed while waiting" }).where(eq(issues.id, one));

  const lost = await task(2);
  const dropped = await handoff.handTaskToAgent("w1", lost, "u1", { harness: "pi" });
  await handoff.cancelHandoff(dropped, "u1");
  assert((await statusOf(dropped)) === "cancelled", "a queued task can be cancelled");
  await refused("someone else's cancel", () => handoff.cancelHandoff(first, "u2"), /Not your/);
  console.log("ok   a queued task can be cancelled, only by its owner");

  const token = await hub.issueRunnerToken("u1");
  const runner: ChildProcess = spawn(process.execPath, [path.join(bundle, "runner.cjs")], {
    cwd: runnerDir,
    env: { ...process.env, HOME: temp, TACOS_SERVER_MODE: "", TACOS_DATA_DIR: runnerDir, TACOS_RUNNER_URL: serverUrl, TACOS_RUNNER_TOKEN: token },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const panelOf = (issueId: string) => handoff.handoffPanel("w1", issueId, "u1");
  await until("the queued task to ask for approval", async () => ((await panelOf(one)).handoff?.pending.length ?? 0) > 0);
  assert((await statusOf(first)) === "running", "the queued task runs when the computer returns");
  assert((await commentsOn(one)).length === 0, "the write waits for an answer");
  assert((await noticesOn(one)).some((row) => row.type === "handoff_waiting"), "the person hears a write is waiting");
  const prompt = fs.readFileSync(piLog, "utf8");
  assert(prompt.includes("Renamed while waiting"), "the prompt reads the task as it is now");
  console.log("ok   the queued task runs when the computer returns; a write asks by default and does nothing yet");

  const card = (await panelOf(one)).handoff!.pending[0];
  await refused("someone else's answer", () => handoff.answerHandoff(first, card.requestId, "u2", true), /Not your/);
  await handoff.answerHandoff(first, card.requestId, "u1", false);
  await until("the denied turn to end", async () => (await statusOf(first)) === "done");
  await until("the result comment", async () => (await commentsOn(one)).length > 0);
  const denied = await commentsOn(one);
  assert(denied.length === 1 && denied[0].body === "the write was refused", `deny blocks the write: ${JSON.stringify(denied)}`);
  assert(denied[0].agentAuthor === "pi", "the comment names the Agent");
  await until("the done notice", async () => (await noticesOn(one)).some((row) => row.type === "handoff_done"));
  assert(!(await noticesOn(one)).some((row) => row.type === "commented" && row.userId === "u1"), "one notice, not two");
  console.log("ok   deny blocks the write; the result is a comment and a notification");

  const three = await task(3);
  const allowed = await handoff.handTaskToAgent("w1", three, "u1", { harness: "pi", note: "TOOLCALL HAND-3" });
  await until("the second card", async () => ((await panelOf(three)).handoff?.pending.length ?? 0) > 0);
  await handoff.answerHandoff(allowed, (await panelOf(three)).handoff!.pending[0].requestId, "u1", true);
  await until("the allowed turn to end", async () => (await statusOf(allowed)) === "done");
  await until("both comments", async () => (await commentsOn(three)).length === 2);
  const written = (await commentsOn(three)).map((row) => row.body);
  assert(written.includes("written by the tool") && written.includes("the write went through"), `allow lets it write: ${written}`);
  console.log("ok   allow lets the write through");

  const four = await task(4);
  const auto = await handoff.handTaskToAgent("w1", four, "u1", { harness: "pi", approval: "auto", note: "TOOLCALL HAND-4" });
  await until("the auto turn to end", async () => (await statusOf(auto)) === "done");
  assert((await commentsOn(four)).some((row) => row.body === "written by the tool"), "Approve for me writes without a card");
  console.log("ok   the approval level chosen at handoff applies");

  const five = await task(5);
  const slow = await handoff.handTaskToAgent("w1", five, "u1", { harness: "pi", note: "SLOWLY" });
  await until("the slow turn to start", async () => (await statusOf(slow)) === "running");
  await sleep(500);
  await handoff.cancelHandoff(slow, "u1");
  await until("the running task to cancel", async () => (await statusOf(slow)) === "cancelled");
  await sleep(300);
  assert((await commentsOn(five)).length === 0, "a cancelled task writes nothing back");
  console.log("ok   a running task can be cancelled, and writes nothing back");

  // A restart loses a running turn, and the person hears about it.
  const six = await task(6);
  const interrupted = await handoff.handTaskToAgent("w1", six, "u1", { harness: "pi", note: "SLOWLY" });
  await until("the sixth turn to start", async () => (await statusOf(interrupted)) === "running");
  await hub.failInterruptedRuns();
  assert((await statusOf(interrupted)) === "failed", "a running handoff fails on restart");
  assert((await noticesOn(six)).some((row) => row.type === "handoff_failed"), "the person hears it failed");
  console.log("ok   a restart fails a running handoff and says so");

  runner.kill("SIGKILL");
  server.close();
  api.close();
  console.log("check-agent-handoff: ok");
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
