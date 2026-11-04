/**
 * Pass condition of docs/plans/team-2.2.md item 2: a turn runs through the runner with server mode
 * on, and no key reaches the server. Uses the real server routes and the built runner, with a fake
 * pi binary and a fake model API on loopback, because the point here is the road between them.
 *   npx tsx scripts/check-runner.ts
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

const SECRET = "sk-check-runner-0123456789abcd";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-runner-"));
const serverData = path.join(temp, "server");
const runnerDir = path.join(temp, "runner");
fs.mkdirSync(serverData);
fs.mkdirSync(runnerDir);
process.env.TACOS_DATA_DIR = serverData;
process.env.TACOS_SERVER_MODE = "1";
process.env.TACOS_RUNNER_DIR = runnerDir;
process.env.TACOS_RUNNER_SILENT_MS = "3000";

// Stands in for Pi: speaks its JSON lines, records what it was given, and calls a TaCos tool the
// way the MCP bridge does.
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
const keys = Object.keys(process.env).filter((k) => k.startsWith("TACOS_MODEL_KEY_") && process.env[k] === ${JSON.stringify(SECRET)});
fs.appendFileSync(${JSON.stringify(piLog)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), keys, url: process.env.TACOS_AGENT_URL ?? null }) + "\\n");
(async () => {
  say({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "from " } });
  if (text.includes("SLOW")) await new Promise(() => setInterval(() => {}, 1000));
  say({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "the computer" } });
  if (text.includes("TOOL")) {
    const answer = await fetch(process.env.TACOS_AGENT_URL + "/api/agent/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.TACOS_AGENT_TOKEN },
      body: JSON.stringify({ name: process.env.CHECK_TOOL_NAME, arguments: {} }),
    }).then((r) => r.json());
    fs.appendFileSync(${JSON.stringify(piLog)}, JSON.stringify({ tool: answer }) + "\\n");
  }
  say({ type: "turn_end", message: { stopReason: "stop" } });
  say({ type: "agent_settled" });
})();
`,
  { mode: 0o755 }
);
process.env.TACOS_PI_BIN = fakePi;

async function main() {
  const { AGENT_TOOLS } = await import("../src/lib/agent-tools");
  const hub = await import("../src/lib/runner/hub");
  const sessions = await import("../src/lib/agent-sessions");
  const modelKeys = await import("../src/lib/model-keys");
  const routes: Record<string, { POST?: (r: Request) => Promise<Response>; GET?: (r: Request) => Promise<Response> }> = {
    "/api/runner/poll": await import("../src/app/api/runner/poll/route"),
    "/api/runner/events": await import("../src/app/api/runner/events/route"),
    "/api/runner/control": await import("../src/app/api/runner/control/route"),
    "/api/runner/approval": await import("../src/app/api/runner/approval/route"),
    "/api/agent/tools": await import("../src/app/api/agent/tools/route"),
  };

  const seenTokens: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const route = routes[(req.url ?? "").split("?")[0]];
    const handler = route?.[req.method as "POST" | "GET"];
    if (!handler) return void res.writeHead(404).end();
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    if (body) seenTokens.push(body.toString("utf8"));
    const answer = await handler(
      new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === "POST" ? body : undefined,
        signal: abort.signal,
      })
    );
    res.writeHead(answer.status, { "Content-Type": "application/json" }).end(await answer.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const api = http.createServer((req, res) => {
    if ((req.headers.authorization ?? "") !== `Bearer ${SECRET}`) return void res.writeHead(401).end("{}");
    if (req.url === "/v1/models") {
      return void res.writeHead(200).end(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "edited " } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "text" } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/v1`;

  // Keys, through the same module the desktop app loads.
  const keys = require(path.join(bundle, "runner-keys.cjs"));
  await keys.saveKey({ label: "", baseUrl: apiUrl, key: "wrong", models: "" }).then(
    () => assert(false, "a rejected key must not be saved"),
    (err: Error) => assert(/rejected/.test(err.message), `rejected key error: ${err.message}`)
  );
  const saved = await keys.saveKey({ label: "Mine", baseUrl: apiUrl, key: SECRET, models: "" });
  assert(saved.verified, "the service accepted the key");
  assert(saved.view.endpoints[0].models.length === 2, "models are read from the API");
  assert(saved.view.editModel === "model-a", "the first API does inline edits");
  assert(!JSON.stringify(saved.view).includes(SECRET), "the key view holds only the last 4 characters");
  const configFile = path.join(runnerDir, "config.json");
  assert((fs.statSync(configFile).mode & 0o077) === 0, "the key file is private to the account");
  await keys.saveKey({ id: saved.view.endpoints[0].id, label: "Mine", baseUrl: "http://127.0.0.1:1/v1", key: "", models: "m" }).then(
    () => assert(false, "the stored key must not follow a changed address"),
    (err: Error) => assert(/required/.test(err.message), `changed address error: ${err.message}`)
  );
  console.log("ok   keys stay in a private file on the computer");

  await modelKeys.saveModelEndpoint("u1", { label: "", baseUrl: apiUrl, key: SECRET, models: "m" }).then(
    () => assert(false, "the server must refuse to store a key"),
    (err: Error) => assert(/computer/.test(err.message), `server refusal: ${err.message}`)
  );
  console.log("ok   the server refuses to store a key");

  await hub.requireRunnerOnline("u1").then(
    () => assert(false, "no computer has connected yet"),
    (err: { status?: number }) => assert(err.status === 409, "away computer answers 409")
  );
  console.log("ok   a turn with the computer away is refused with a hint");

  const token = await hub.issueRunnerToken("u1");
  const startRunner = (): ChildProcess =>
    spawn(process.execPath, [path.join(bundle, "runner.cjs")], {
      cwd: runnerDir,
      env: {
        ...process.env,
        HOME: temp,
        TACOS_SERVER_MODE: "",
        TACOS_DATA_DIR: runnerDir,
        TACOS_RUNNER_URL: serverUrl,
        TACOS_RUNNER_TOKEN: token,
        CHECK_TOOL_NAME: AGENT_TOOLS.find((tool) => tool.write)!.name,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
  const runner = startRunner();
  await until("the runner to report in", async () => (await hub.runnerViewFor("u1")).online);
  const view = await hub.runnerViewFor("u1");
  assert(view.capabilities?.keyed.includes("pi"), "the computer reports Pi as usable on its API");
  assert(view.capabilities?.harnesses.find((h) => h.id === "pi")?.installed, "the computer reports Pi installed");
  assert(view.capabilities?.editModel === "model-a", "the computer reports its edit model");
  assert(view.capabilities?.models.pi?.some((m) => m.slug.includes("model-a")), "the computer reports its models");
  const gate = (await import("../src/lib/harness/gate")).harnessGate({}, ...(await modelKeys.harnessViewFor("u1")));
  assert(gate.agentAllowed && gate.enabledReady.some((row) => row.id === "pi"), "Agent opens on what the computer reported");
  console.log("ok   the computer reports what it can run");

  const refused = await routes["/api/runner/events"].POST!(
    new Request("http://x/", { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" })
  );
  assert(refused.status === 401, "a wrong runner token is refused");
  console.log("ok   a wrong runner token is refused");

  const collect = async (events: AsyncIterable<{ type: string; text?: string; message?: string }>) => {
    const all: { type: string; text?: string; message?: string }[] = [];
    for await (const event of events) all.push(event);
    return all;
  };
  const textOf = (events: { type: string; text?: string }[]) =>
    events.filter((event) => event.type === "delta").map((event) => event.text).join("");

  const edit = await collect(
    await hub.startRun({
      userId: "u1",
      workspaceId: "w1",
      payload: {
        kind: "edit",
        engine: "api",
        messages: [{ role: "user", content: "fix" }],
        prompt: { system: "", body: "fix" },
        proxy: "",
      },
    })
  );
  assert(textOf(edit) === "edited text", `edit answered from the computer's API: ${JSON.stringify(edit)}`);
  console.log("ok   an inline edit runs on the computer's API");

  const toolName = AGENT_TOOLS.find((tool) => tool.write)!.name;
  const turnPayload = (body: string, threadId: string) => ({
    kind: "turn" as const,
    harness: "pi" as const,
    threadId,
    projectId: "",
    prompt: { system: "", body },
    message: body,
    model: view.capabilities!.models.pi![0].slug,
    effort: "",
    approval: "ask" as const,
    autoApproveTools: [],
    neverAutoApproveTools: [],
    proxy: "",
  });

  const plain = await collect(await hub.startRun({ userId: "u1", workspaceId: "w1", threadId: "t1", payload: turnPayload("hello", "t1") }));
  assert(textOf(plain) === "from the computer", `turn text: ${JSON.stringify(plain)}`);
  const firstCall = JSON.parse(fs.readFileSync(piLog, "utf8").split("\n")[0]) as { cwd: string; keys: string[]; url: string };
  assert(firstCall.keys.length === 1, "the harness got the member's key from the computer");
  assert(firstCall.url === serverUrl, "the harness's tools point at the server");
  assert(firstCall.cwd.startsWith(path.join(fs.realpathSync(temp), ".tacos", "agent")), "the turn runs under the member's own folder");
  console.log("ok   a turn runs through the runner");

  // A tool on the server asks the person, and the answer reaches the turn on the computer.
  const seen: { type: string; requestId?: string; decision?: string; tool?: string }[] = [];
  for await (const event of await hub.startRun({ userId: "u1", workspaceId: "w1", threadId: "t2", payload: turnPayload("TOOL", "t2") })) {
    seen.push(event);
    if (event.type === "approval") sessions.answerAgentApproval(event.requestId, "accept");
  }
  const card = seen.find((event) => event.type === "approval");
  assert(card?.tool === `tacos.${toolName}`, `the person is asked about the tool: ${JSON.stringify(seen)}`);
  assert(seen.some((event) => event.type === "approval_done" && event.decision === "allow"), "the answer closes the card");
  assert(!seen.some((event) => event.type === "error") && seen.at(-1)?.type === "done", `tool turn finished: ${JSON.stringify(seen)}`);
  const toolLine = fs.readFileSync(piLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { tool?: { content?: unknown } }).find((line) => line.tool);
  assert(toolLine?.tool?.content, `the tool answered the harness: ${JSON.stringify(toolLine)}`);
  console.log("ok   a tool asks in the browser and answers the harness on the computer");

  // Stop in the browser ends the harness on the computer.
  const before = fs.readFileSync(piLog, "utf8").trim().split("\n").length;
  const abort = new AbortController();
  const slow = await hub.startRun({ userId: "u1", workspaceId: "w1", threadId: "t3", payload: turnPayload("SLOW", "t3"), signal: abort.signal });
  const slowDone = collect(slow);
  await until("the slow turn to start", () => fs.readFileSync(piLog, "utf8").trim().split("\n").length > before);
  const slowPid = (JSON.parse(fs.readFileSync(piLog, "utf8").trim().split("\n").at(-1)!) as { pid: number }).pid;
  abort.abort();
  await slowDone;
  const gone = () => {
    try {
      process.kill(slowPid, 0);
      return false;
    } catch {
      return true;
    }
  };
  await until("the harness to stop after Stop", gone);
  console.log("ok   Stop in the browser ends the harness on the computer");

  // The computer disappears mid-turn: the person is told instead of waiting forever.
  const lost = await hub.startRun({ userId: "u1", workspaceId: "w1", threadId: "t4", payload: turnPayload("SLOW", "t4") });
  const lostDone = collect(lost);
  await sleep(1_000);
  runner.kill("SIGKILL");
  const lostEvents = await lostDone;
  const lostError = lostEvents.find((event) => event.type === "error");
  assert(lostError?.message?.includes("stopped responding"), `lost computer: ${JSON.stringify(lostEvents)}`);
  console.log("ok   a computer lost mid-turn ends the turn with a message");

  // Everything the server kept or was sent must be free of the key.
  const files = fs.readdirSync(serverData, { recursive: true }).map(String);
  for (const file of files) {
    const full = path.join(serverData, file);
    if (fs.statSync(full).isFile()) assert(!fs.readFileSync(full).includes(SECRET), `key found in server file ${file}`);
  }
  assert(!seenTokens.some((body) => body.includes(SECRET)), "the key was sent to the server");
  assert(!JSON.stringify(await hub.runnerViewFor("u1")).includes(SECRET), "the key is in the capabilities");
  console.log(`ok   the key is in none of the ${files.length} server files or ${seenTokens.length} requests`);

  server.close();
  api.close();
  console.log("check-runner passed");
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
