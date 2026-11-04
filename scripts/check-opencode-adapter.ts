/**
 * H-P4-22 static E2E: OpenCode adapter end-state path.
 * Run: npx tsx scripts/check-opencode-adapter.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getHarnessAdapter } from "../src/lib/harness";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const adapter = getHarnessAdapter("opencode");
assert(adapter, "opencode adapter missing");
const detect = adapter!.detect();
assert(detect.id === "opencode", "detect id");
assert(typeof adapter!.openTurn === "function", "openTurn missing");
assert(!read("src/lib/harness/adapters/opencode.ts").includes("notImplementedTurn"), "still stub");

const turn = read("src/lib/harness/adapters/opencode-turn.ts");
assert(turn.includes("OPENCODE_CONFIG_CONTENT"), "must inject OpenCode config");
assert(turn.includes('"type": "local"') || turn.includes("type: \"local\""), "must mount local MCP");
assert(turn.includes("subscribeToolApprovals"), "must stream TaCos-mediated cards");
assert(turn.includes("--format"), "must stream json events");
assert(turn.includes("--auto"), "headless ask rejects; use --auto with deny list");
assert(turn.includes('edit: "deny"'), "must deny builtin edit");

const route = read("src/app/api/ai/chat/route.ts");
assert(route.includes('getHarnessAdapter("opencode")'), "route must use opencode adapter");
assert(route.includes('engine === "opencode"'), "route must branch on opencode");
assert(route.includes("AGENT_HARNESS_IDS"), "route must accept harness ids");

const tools = read("src/app/api/agent/tools/route.ts");
assert(tools.includes("publishToolApproval"), "tools route must publish cards");

console.log(
  `check-opencode-adapter: pass (installed=${detect.installed} ready=${detect.ready} version=${detect.version ?? "null"})`
);
