// H-FIX-32: no OS-sandbox risk label in the UI, and no version in the composer harness menu.
import fs from "node:fs";
import { listHarnessDetect } from "../src/lib/harness/registry";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const read = (p: string) => fs.readFileSync(p, "utf8");
const files = [
  "src/lib/harness/types.ts",
  "src/lib/ai-constants.ts",
  "src/lib/ai.ts",
  "src/components/agent-chat.tsx",
  "src/components/settings-view.tsx",
  "src/lib/i18n/zh.ts",
];
for (const file of files) {
  const text = read(file);
  assert(!/riskLabel|osSandbox|No OS sandbox|无系统沙箱|OS sandbox/.test(text), `${file} must not have the sandbox label`);
}
for (const row of listHarnessDetect()) {
  assert(!("riskLabel" in row) && !("osSandbox" in row), `${row.id} detect must not return the sandbox label`);
}
const chat = read("src/components/agent-chat.tsx");
const chip = chat.slice(chat.indexOf("function HarnessChip("), chat.indexOf("function ModelChip("));
assert(chip.length > 0, "HarnessChip required");
assert(!chip.includes("option.detail"), "harness menu must not show the version");
console.log("check-no-sandbox-label: pass");
