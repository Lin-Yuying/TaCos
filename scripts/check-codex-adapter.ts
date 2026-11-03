/**
 * H-P1-10 static E2E: Codex adapter end-state path.
 * Run: npx tsx scripts/check-codex-adapter.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getHarnessAdapter } from "../src/lib/harness";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const adapter = getHarnessAdapter("codex");
assert(adapter, "codex adapter missing");
const detect = adapter!.detect();
assert(detect.id === "codex", "detect id");
assert(typeof adapter!.openTurn === "function", "openTurn missing");
assert(!read("src/lib/harness/adapters/codex.ts").includes("notImplementedTurn"), "still stub");

const turn = read("src/lib/harness/adapters/codex-turn.ts");
assert(turn.includes("mcpServer/elicitation/request"), "missing elicitation key");
assert(turn.includes("codex_approval_kind"), "missing approval kind key");
assert(turn.includes("sessionId"), "requestId must use session id");

const route = read("src/app/api/ai/chat/route.ts");
assert(route.includes('getHarnessAdapter("codex")'), "route must use codex adapter");
assert(route.includes("turnEventsToSse"), "route must map turn events to SSE");

const types = read("src/lib/harness/types.ts");
assert(types.includes('ApprovalDecision = "allow" | "deny" | "allow_turn"'), "approval keys");

console.log(
  `check-codex-adapter: pass (installed=${detect.installed} ready=${detect.ready} version=${detect.version ?? "null"})`
);
