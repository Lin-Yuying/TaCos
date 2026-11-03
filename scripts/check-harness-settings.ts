/**
 * H-P2-11 static E2E: Settings Harness panel.
 * Run: npx tsx scripts/check-harness-settings.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const schema = read("src/db/schema.ts");
assert(schema.includes("harnessEnabled"), "schema missing harnessEnabled");

const client = read("src/db/client.ts");
assert(client.includes("harness_enabled"), "bootstrap missing harness_enabled");

const settings = read("src/lib/harness/settings.ts");
assert(settings.includes("getHarnessSettingsView"), "missing getHarnessSettingsView");
assert(settings.includes("setHarnessEnabled"), "missing setHarnessEnabled");

const view = read("src/components/settings-view.tsx");
assert(view.includes('data-testid="harness-settings"'), "missing Harness panel");
assert(view.includes("toggleHarness"), "missing toggle");
assert(view.includes("Version:"), "missing version display");

const actions = read("src/app/ai-actions.ts");
assert(actions.includes("setHarnessEnabledAction"), "missing action");

const page = read("src/app/[workspaceId]/settings/page.tsx");
assert(page.includes("getHarnessSettingsView"), "settings page must load harness view");

console.log("check-harness-settings: pass");
