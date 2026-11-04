/**
 * H-P3-18 static E2E: switch harness/model keeps session; New chat creates session.
 * Run: npx tsx scripts/check-session-keep-on-switch.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const chat = read("src/components/agent-chat.tsx");

const choose = chat.split("async function chooseEngine(next: AgentHarnessId)")[1]?.slice(0, 600) ?? "";
assert(choose.includes("setAgentThreadEngineAction"), "chooseEngine must update thread harness");
assert(!choose.includes("router.push"), "chooseEngine must not navigate to a new session");
assert(!choose.includes("startAgentThreadAction"), "chooseEngine must not start a thread");

const changeModel = chat.split("async function changeModel(nextModel: string, nextEffort: string)")[1]?.slice(0, 500) ?? "";
assert(changeModel.includes("setAgentThreadModelAction"), "changeModel must update thread model");
assert(!changeModel.includes("router.push"), "changeModel must not navigate away");

assert(chat.includes('data-testid="agent-new-chat"'), "New chat control required");
assert(chat.includes('href={`/${workspaceId}/agent`}'), "New chat must drop thread query");
assert(chat.includes("startAgentThreadAction"), "empty composer start must create a session");
assert(
  chat.includes("New chat leaves the open thread. Start on the empty composer creates a new session id."),
  "workspace must document new-chat session rule"
);

console.log("check-session-keep-on-switch: pass");
