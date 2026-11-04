/**
 * H-P2-14 static E2E: all harnesses off disables Agent.
 * Run: npx tsx scripts/check-all-off-disables-agent.ts
 */
import fs from "node:fs";
import path from "node:path";
import { harnessGate } from "../src/lib/harness/gate";
import { FIRST_CLASS_HARNESS_IDS } from "../src/lib/harness/registry";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const allOff = Object.fromEntries(FIRST_CLASS_HARNESS_IDS.map((id) => [id, false]));
const offGate = harnessGate(allOff);
assert(offGate.agentAllowed === false, "all off must disable agent");
assert(offGate.enabledReady.length === 0, "all off has no enabledReady");

const settings = read("src/lib/harness/settings.ts");
assert(settings.includes("getWorkspaceHarnessGate"), "missing getWorkspaceHarnessGate");

const view = read("src/components/settings-view.tsx");
assert(view.includes("harness-agent-disabled"), "missing Agent disabled banner");
assert(view.includes("setHarnessGateView"), "toggle must update gate locally");

const gateSrc = read("src/lib/harness/gate.ts");
assert(gateSrc.includes("anyEnabled"), "gate must require anyEnabled");

console.log("check-all-off-disables-agent: pass");
