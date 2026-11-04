/**
 * H-P2-13 static E2E: live update check + hot refresh after install.
 * Run: npx tsx scripts/check-live-update-hot-refresh.ts
 */
import fs from "node:fs";
import path from "node:path";
import { isNewerVersion } from "../src/lib/harness/update-check";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(isNewerVersion("0.163.0", "0.166.0") === true, "0.166 should be newer");
assert(isNewerVersion("1.5.0", "1.5.0") === false, "same version");
assert(isNewerVersion("2.0.0", "1.9.9") === false, "older latest");
assert(isNewerVersion("codex-cli 0.1.0", "0.2.0") === true, "normalize prefix");

const update = read("src/lib/harness/update-check.ts");
assert(update.includes("checkAllHarnessUpdates"), "missing checkAllHarnessUpdates");

const settings = read("src/lib/harness/settings.ts");
assert(settings.includes("refreshHarnessSettingsView"), "missing refresh helper");
assert(settings.includes("clearHarnessDetectCache"), "refresh must clear cache");

const actions = read("src/app/ai-actions.ts");
assert(actions.includes("checkHarnessUpdatesAction"), "missing check action");
assert(actions.includes("refreshHarnessSettingsView"), "install must refresh view");
assert(actions.includes("rows: view.rows"), "install must return rows");

const view = read("src/components/settings-view.tsx");
assert(view.includes("setHarnessRows(result.data.rows)"), "hot refresh must set rows");
assert(view.includes("checkHarnessUpdates"), "missing check UI");
assert(view.includes("Update available"), "missing update badge");
assert(!view.includes('setHarnessNotice(result.data.message);\n    router.refresh();\n  }\n\n  async function rotateCode'), "install must not rely on router.refresh alone");

const types = read("src/lib/harness/types.ts");
assert(types.includes("latestVersion"), "HarnessStatus missing latestVersion");
assert(types.includes("updateAvailable"), "HarnessStatus missing updateAvailable");

console.log("check-live-update-hot-refresh: pass");
