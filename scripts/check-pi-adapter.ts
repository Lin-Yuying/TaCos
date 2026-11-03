/**
 * H-P4-21 static E2E: Pi adapter end-state path (detect → turn → MCP → cards).
 * Run: npx tsx scripts/check-pi-adapter.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getHarnessAdapter } from "../src/lib/harness";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const adapter = getHarnessAdapter("pi");
assert(adapter, "pi adapter missing");
const detect = adapter!.detect();
assert(detect.id === "pi", "detect id");
assert(typeof adapter!.openTurn === "function", "openTurn missing");
assert(!read("src/lib/harness/adapters/pi.ts").includes("notImplementedTurn"), "still stub");

const turn = read("src/lib/harness/adapters/pi-turn.ts");
assert(turn.includes("PI_CODING_AGENT_DIR"), "must isolate Pi agent dir");
assert(turn.includes("mcp.json"), "must write mcp.json for TaCos tools");
assert(turn.includes("subscribeToolApprovals"), "must stream TaCos-mediated cards");
assert(turn.includes("--no-builtin-tools"), "must prefer TaCos MCP over Pi builtins");
assert(turn.includes("tool_execution_start"), "must map tool steps");

const route = read("src/app/api/ai/chat/route.ts");
assert(route.includes('getHarnessAdapter("pi")'), "route must use pi adapter");
assert(route.includes('engine === "pi"'), "route must branch on pi");

const tools = read("src/app/api/agent/tools/route.ts");
assert(tools.includes("publishToolApproval"), "tools route must publish cards for Pi");
assert(tools.includes("waitForAgentApproval"), "tools route must wait for Allow/Deny");
assert(tools.includes("decideToolApproval"), "tools route must use the shared policy");
assert(read("src/lib/agent-tool-policy.ts").includes("neverAutoApproveTools"), "delete tools must still force confirm");

const sessions = read("src/lib/agent-sessions.ts");
assert(sessions.includes("subscribeToolApprovals"), "approval pubsub required");
assert(sessions.includes("Set<Waiter>"), "multi-waiter required for Pi + tools route");

console.log(
  `check-pi-adapter: pass (installed=${detect.installed} ready=${detect.ready} version=${detect.version ?? "null"})`
);
