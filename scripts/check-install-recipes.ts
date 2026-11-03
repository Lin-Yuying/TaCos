/**
 * H-P2-12 static E2E: per-harness install/upgrade recipes.
 * Run: npx tsx scripts/check-install-recipes.ts
 */
import fs from "node:fs";
import path from "node:path";
import { getHarnessAdapter, FIRST_CLASS_HARNESS_IDS } from "../src/lib/harness/registry";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const recipes = read("src/lib/harness/install-recipes.ts");
assert(recipes.includes("installHarnessRecipe"), "missing installHarnessRecipe");
assert(recipes.includes("upgradeHarnessRecipe"), "missing upgradeHarnessRecipe");
assert(recipes.includes("@openai/codex"), "codex package missing");
assert(recipes.includes("@earendil-works/pi-coding-agent"), "pi package missing");
assert(recipes.includes("opencode-ai"), "opencode package missing");
assert(recipes.includes("@deepseek-ai/dsh"), "dsh package missing");
assert(recipes.includes("@tencent-ai/codebuddy-code"), "codebuddy package missing");
assert(recipes.includes("permission denied") || recipes.includes("EACCES"), "missing permission diagnose");
assert(recipes.includes("engine"), "missing engine diagnose");

for (const id of FIRST_CLASS_HARNESS_IDS) {
  const adapter = getHarnessAdapter(id);
  assert(adapter, `missing adapter ${id}`);
  assert(typeof adapter.install === "function", `${id} missing install`);
  assert(typeof adapter.upgrade === "function", `${id} missing upgrade`);
}

const actions = read("src/app/ai-actions.ts");
assert(actions.includes("runHarnessInstallAction"), "missing install action");

const view = read("src/components/settings-view.tsx");
assert(view.includes("runHarnessRecipe"), "missing UI recipe runner");
assert(view.includes(">Install<") || view.includes('"Install"'), "missing Install button");
assert(view.includes(">Upgrade<") || view.includes('"Upgrade"'), "missing Upgrade button");

console.log("check-install-recipes: pass");
