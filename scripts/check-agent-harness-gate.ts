/**
 * H-P3-16 static E2E: Agent page gated by enabled+ready harness.
 * Run: npx tsx scripts/check-agent-harness-gate.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const page = read("src/app/[workspaceId]/agent/page.tsx");
assert(page.includes("getWorkspaceHarnessGate"), "agent page must load harness gate");
assert(page.includes("gate.agentAllowed"), "ready must use agentAllowed");
assert(!page.includes("const ready = engines.some"), "ready must not use engines.some alone");

const chat = read("src/components/agent-chat.tsx");
assert(chat.includes('data-testid="agent-harness-gate"'), "missing gate empty state");
assert(chat.includes("Agent needs a ready harness"), "missing gate title");
assert(chat.includes("Enable at least one local harness"), "missing gate copy");

console.log("check-agent-harness-gate: pass");
