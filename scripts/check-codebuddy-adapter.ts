/**
 * H-P4-23 static E2E: WorkBuddy (codebuddy) adapter end-state path.
 * Run: npx tsx scripts/check-codebuddy-adapter.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getHarnessAdapter } from "../src/lib/harness";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const adapter = getHarnessAdapter("codebuddy");
assert(adapter, "codebuddy adapter missing");
const detect = adapter!.detect();
assert(detect.id === "codebuddy", "detect id");
assert(detect.label === "WorkBuddy", "product label WorkBuddy");
assert(typeof adapter!.openTurn === "function", "openTurn missing");
assert(!read("src/lib/harness/adapters/codebuddy.ts").includes("notImplementedTurn"), "still stub");

const turn = read("src/lib/harness/adapters/codebuddy-turn.ts");
assert(turn.includes("--mcp-config"), "must mount MCP config");
assert(turn.includes("--strict-mcp-config"), "must isolate MCP to TaCos");
assert(turn.includes('"--tools"') || turn.includes("--tools"), "must disable builtins");
assert(turn.includes("stream-json"), "must stream json");
assert(turn.includes("subscribeToolApprovals"), "must stream TaCos-mediated cards");

const route = read("src/app/api/ai/chat/route.ts");
assert(route.includes('getHarnessAdapter("codebuddy")'), "route must use codebuddy adapter");
assert(route.includes('engine === "codebuddy"'), "route must branch on codebuddy");

console.log(
  `check-codebuddy-adapter: pass (installed=${detect.installed} ready=${detect.ready} version=${detect.version ?? "null"})`
);
