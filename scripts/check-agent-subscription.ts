/**
 * #79 subscription display: Codex app-server rate limits map to used/remaining windows,
 * an unreported harness says so and points at its own status command, and the three
 * surfaces render the same shape. Run: npx tsx scripts/check-agent-subscription.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-subscription-"));
const fake = path.join(temp, "codex-fake");
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === 1) send({ jsonrpc: "2.0", id: 1, result: {} });
  if (message.id === 2) {
    if (process.env.FAKE_EMPTY === "1") send({ jsonrpc: "2.0", id: 2, result: {} });
    else send({ jsonrpc: "2.0", id: 2, result: { plan: "Plus", rateLimits: {
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1893456000 },
      secondary: { used_percent: 15, window_minutes: 10080, resets_at: 1894060800 }
    } } });
  }
});
`,
  { mode: 0o755 }
);
process.env.TACOS_CODEX_BIN = fake;
delete process.env.TACOS_CODEX_SUBSCRIPTION_JSON;

async function main() {
  const { clearHarnessDetectCache } = await import("../src/lib/harness/detect-bin");
  const { codexSubscription, clearCodexSubscriptionCache } = await import("../src/lib/harness/adapters/codex-subscription");
  clearHarnessDetectCache();
  clearCodexSubscriptionCache();

  const info = await codexSubscription(true);
  assert(info.source === "app-server", `source ${info.source}`);
  assert(info.plan === "Plus", `plan ${info.plan}`);
  assert(info.windows.length === 2, `windows ${info.windows.length}`);
  const primary = info.windows.find((window) => window.id === "primary");
  assert(primary?.usedPercent === 40 && primary.remainingPercent === 60, "primary used/remaining");
  assert(primary.resetsAt === new Date(1893456000 * 1000).toISOString(), "primary reset time");
  const secondary = info.windows.find((window) => window.id === "secondary");
  assert(secondary?.remainingPercent === 85 && secondary.windowMinutes === 10080, "secondary window");

  // An older endpoint that answers without limits must say "not reported", never guess.
  process.env.FAKE_EMPTY = "1";
  clearCodexSubscriptionCache();
  const empty = await codexSubscription(true);
  assert(empty.source === "none" && empty.windows.length === 0, "empty limits mean not reported");
  assert(/status/i.test(empty.hint ?? ""), "the hint points at the CLI status command");

  // The explicit env snapshot is what a headless deployment can feed.
  process.env.TACOS_CODEX_SUBSCRIPTION_JSON = JSON.stringify({
    plan: "Pro",
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: "2030-01-01T00:00:00.000Z" },
  });
  clearCodexSubscriptionCache();
  const env = await codexSubscription(true);
  assert(env.source === "app-server" && env.plan === "Pro" && env.windows[0].remainingPercent === 75, "env snapshot");

  const settings = fs.readFileSync(new URL("../src/components/settings-view.tsx", import.meta.url), "utf8");
  const composer = fs.readFileSync(new URL("../src/components/agent-chat.tsx", import.meta.url), "utf8");
  const row = fs.readFileSync(new URL("../src/components/harness-subscription.tsx", import.meta.url), "utf8");
  assert(settings.includes("<HarnessSubscription"), "Settings → Harness renders plan usage");
  assert(composer.includes('data-testid="composer-subscription"'), "the composer shows a plan chip");
  assert(row.includes("Not reported") && row.includes("Refresh plan usage"), "not-reported + refresh copy");
  const delegation = fs.readFileSync(new URL("../src/components/issue-panel/delegation-row.tsx", import.meta.url), "utf8");
  assert(delegation.includes("delegation-source") && delegation.includes("delegation-tokens"), "run panel shows source and tokens");
  assert(delegation.includes("delegation-subscription") && delegation.includes("Plan: not reported"), "run panel shows the plan snapshot");

  console.log("check-agent-subscription: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
