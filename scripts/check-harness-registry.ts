/**
 * E2E smoke for H-P1-05: registry exports + detect on this machine.
 * Run: npx tsx scripts/check-harness-registry.ts
 */
import {
  FIRST_CLASS_HARNESS_IDS,
  getHarnessAdapter,
  harnessGate,
  listHarnessAdapters,
  listHarnessDetect,
} from "../src/lib/harness";

const expected = ["codex", "pi", "opencode", "dsh", "codebuddy"] as const;
const adapters = listHarnessAdapters();
const ids = adapters.map((a) => a.id);

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`PASS: ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}

check("five first-class adapters", ids.length === 5 && expected.every((id) => ids.includes(id)));
check("FIRST_CLASS_HARNESS_IDS length", FIRST_CLASS_HARNESS_IDS.length === 5);

for (const id of expected) {
  const adapter = getHarnessAdapter(id);
  check(`getHarnessAdapter(${id})`, Boolean(adapter));
  if (!adapter) continue;
  const detect = adapter.detect();
  check(
    `detect(${id}) shape`,
    detect.id === id && typeof detect.installed === "boolean" && typeof detect.ready === "boolean",
    `installed=${detect.installed} version=${detect.version ?? "null"} ready=${detect.ready}`,
  );
  // openTurn must be callable (stub yields error+done)
}

const all = listHarnessDetect();
check("listHarnessDetect count", all.length === 5);

const gate = harnessGate();
check("harnessGate fields", typeof gate.agentAllowed === "boolean" && Array.isArray(gate.enabledReady));
console.log(
  "gate:",
  JSON.stringify({
    agentAllowed: gate.agentAllowed,
    ready: gate.enabledReady.map((s) => s.id),
  }),
);

if (failed) {
  console.error(`H-P1-05 check failed: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("H-P1-05 check passed");
