/**
 * H-P1-09 static E2E: session stays unbound from harness/model.
 * Run: npx tsx scripts/check-session-unbound.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const threads = read("src/lib/agent-threads.ts");
const actions = read("src/app/agent-actions.ts");
const chat = read("src/components/agent-chat.tsx");
const route = read("src/app/api/ai/chat/route.ts");

assert(
  threads.includes("last-used turn prefs"),
  "agent-threads must document engine/model as last-used turn prefs"
);
assert(
  threads.includes("export async function setAgentThreadEngine"),
  "setAgentThreadEngine must exist for composer harness changes"
);
assert(
  actions.includes("setAgentThreadEngineAction"),
  "setAgentThreadEngineAction must exist"
);
assert(
  chat.includes("setAgentThreadEngineAction"),
  "Conversation must call setAgentThreadEngineAction"
);
assert(
  chat.includes("Do not open a new thread"),
  "chooseEngine must keep the same session"
);
assert(
  chat.includes('router.push(`/${workspaceId}/agent`)'),
  "New chat must leave the open thread"
);
assert(
  route.includes("updates last-used and keeps the session"),
  "agent turn must keep the session when harness changes"
);
assert(!route.includes("Work mode"), "route must not still describe Work mode");

console.log("check-session-unbound: pass");
