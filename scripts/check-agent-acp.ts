/**
 * #79 generic ACP adapter: JSON-RPC over stdio, session/new, streaming updates and a
 * session/request_permission mapped to the same approval event as a harness turn.
 * Run: npx tsx scripts/check-agent-acp.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-acp-"));
const log = path.join(temp, "responses.jsonl");
const fake = path.join(temp, "acp-agent");
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require("node:fs");
const readline = require("node:readline");
const out = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
let sessionId = "";
rl.on("line", (line) => {
  fs.appendFileSync(${JSON.stringify(log)}, line + "\\n");
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === 1) {
    out({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (message.id === 2) {
    sessionId = "acp-session-1";
    out({ jsonrpc: "2.0", id: 2, result: { sessionId } });
    return;
  }
  if (message.id === 3) {
    out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello ACP." } } } });
    out({ jsonrpc: "2.0", id: 10, method: "session/request_permission", params: {
      sessionId,
      toolCall: { toolCallId: "tool-1", title: "Write a file", kind: "edit" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" }
      ]
    } });
    return;
  }
  if (message.id === 10) {
    out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " Done." } } } });
    out({ jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } });
  }
});
`,
  { mode: 0o755 }
);
process.env.TACOS_ACP_BIN = fake;

async function main() {
  // A stuck child must fail the check, never hang check:harness.
  setTimeout(() => {
    console.error("check-agent-acp: timed out");
    process.exit(1);
  }, 20_000).unref();
  const { getHarnessAdapter, listHarnessAdapters } = await import("../src/lib/harness");
  const adapters = listHarnessAdapters();
  assert(adapters.length === 5, "the five built-in harnesses stay first-class");
  const adapter = getHarnessAdapter("acp");
  assert(adapter, "getHarnessAdapter('acp') is available");
  const detect = adapter!.detect();
  assert(detect.ready && detect.id === "acp", "ACP detect uses TACOS_ACP_BIN");

  const events: { type: string; text?: string; requestId?: string; id?: string; decision?: string }[] = [];
  const seen: string[] = [];
  for await (const event of adapter!.openTurn({
    sessionId: "t1",
    cwd: temp,
    prompt: { system: "You are an ACP agent.", body: "Say hello." },
    model: null,
    approval: "ask",
    isTurnApproved: () => false,
    waitForApproval: async (request) => {
      seen.push(`${request.requestId}:${request.message}`);
      return "allow";
    },
    mcp: {
      command: process.execPath,
      args: ["/tmp/does-not-matter.mjs"],
      env: { TACOS_AGENT_URL: "http://127.0.0.1", TACOS_AGENT_TOKEN: "secret" },
    },
    timeoutMs: 10_000,
  })) {
    events.push(event as never);
  }

  assert(events.some((event) => event.type === "session" && event.id === "acp-session-1"), "session id is exposed");
  assert(events.some((event) => event.type === "delta" && event.text === "Hello ACP."), "streams ACP text");
  assert(events.some((event) => event.type === "delta" && event.text === " Done."), "streams after permission");
  assert(seen.length === 1 && seen[0].includes("Write a file"), "permission maps to an approval card");
  assert(events.some((event) => event.type === "approval" && event.requestId), "approval event emitted");
  assert(events.some((event) => event.type === "approval_done" && event.decision === "allow"), "approval answer returned");

  const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as {
    method?: string;
    params?: { mcpServers?: { name?: string; command?: string; env?: { name: string }[] }[] };
    result?: { outcome?: { outcome?: string; optionId?: string } };
  });
  const sessionNew = lines.find((line) => line.method === "session/new");
  assert(sessionNew?.params?.mcpServers?.[0]?.name === "tacos", "TaCos MCP is forwarded");
  assert(sessionNew?.params?.mcpServers?.[0]?.env?.some((entry) => entry.name === "TACOS_AGENT_TOKEN"), "MCP token is forwarded");
  const permissionAnswer = lines.find((line) => line.result?.outcome?.optionId === "allow-once");
  assert(permissionAnswer?.result?.outcome?.outcome === "selected", "the allow option is selected");

  const facade = fs.readFileSync(new URL("../src/lib/agent-acp.ts", import.meta.url), "utf8");
  assert(facade.includes("session/request_permission") && facade.includes("agent_message_chunk"), "ACP protocol mapped");
  console.log("check-agent-acp: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
