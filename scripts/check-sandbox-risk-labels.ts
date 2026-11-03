/**
 * H-P3-20 static E2E: risk labels for harnesses without OS sandbox.
 * Run: npx tsx scripts/check-sandbox-risk-labels.ts
 */
import fs from "node:fs";
import path from "node:path";
import { listHarnessDetect } from "../src/lib/harness/registry";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const types = read("src/lib/harness/types.ts");
assert(types.includes("osSandbox: boolean"), "DetectResult/HarnessAdapter must declare osSandbox");
assert(types.includes("riskLabel: string | null"), "DetectResult must declare riskLabel");

const rows = listHarnessDetect();
const codex = rows.find((row) => row.id === "codex");
assert(codex?.osSandbox === true, "codex must report OS sandbox");
assert(codex?.riskLabel === null, "codex must not show a risk label");

for (const id of ["pi", "opencode", "dsh", "codebuddy"] as const) {
  const row = rows.find((entry) => entry.id === id);
  assert(row, `${id} missing from detect list`);
  assert(row.osSandbox === false, `${id} must report no OS sandbox`);
  assert(row.riskLabel === "No OS sandbox", `${id} must show No OS sandbox`);
}

const settings = read("src/components/settings-view.tsx");
assert(settings.includes("harness-risk-"), "Settings must render risk badges");
assert(settings.includes("OS sandbox"), "Settings must label sandboxed harnesses");

const chat = read("src/components/agent-chat.tsx");
assert(chat.includes("composer-risk-"), "Composer must show risk labels");
assert(chat.includes("option.riskLabel"), "Composer menu must read riskLabel");

const options = read("src/lib/ai-constants.ts");
assert(options.includes("riskLabel: string | null"), "AgentHarnessOption must include riskLabel");

const ai = read("src/lib/ai.ts");
assert(ai.includes("riskLabel: row.riskLabel"), "listAgentHarnessOptions must pass riskLabel");

console.log("check-sandbox-risk-labels: pass");
