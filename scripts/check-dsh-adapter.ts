/**
 * H-P4-24 E2E: DeepSeek Harness (dsh) adapter end-state path.
 * Static checks, then a live dsh boot with the TaCos patch overlay.
 * Run: npx tsx scripts/check-dsh-adapter.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getHarnessAdapter } from "../src/lib/harness";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const adapter = getHarnessAdapter("dsh");
assert(adapter, "dsh adapter missing");
const detect = adapter!.detect();
assert(detect.id === "dsh", "detect id");
assert(!read("src/lib/harness/adapters/dsh.ts").includes("notImplementedTurn"), "still stub");
assert(fs.existsSync(path.join(root, "src/lib/harness/adapters/dsh-turn.ts")), "dsh-turn.ts missing");

const turn = read("src/lib/harness/adapters/dsh-turn.ts");
assert(turn.includes("--patch"), "must mount TaCos patch overlay");
assert(turn.includes("dsh-mcp-client"), "must insert TaCos MCP");
assert(turn.includes('"--json"'), "must stream json events");
assert(turn.includes("tool-bash") && turn.includes("tool-fs"), "must disable builtins");
assert(turn.includes("subscribeToolApprovals"), "must stream TaCos-mediated cards");

const route = read("src/app/api/ai/chat/route.ts");
assert(route.includes('getHarnessAdapter("dsh")'), "route must use dsh adapter");
assert(route.includes('engine === "dsh"'), "route must branch on dsh");

let live = "skipped (dsh not installed)";
if (detect.installed && detect.binary) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildDshPatch, explainDshError } = require("../src/lib/harness/adapters/dsh-turn");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-dsh-"));
  const patch = path.join(dir, "patch.yml");
  fs.writeFileSync(patch, buildDshPatch({ command: process.execPath, args: ["-e", "0"], env: { TACOS_AGENT_URL: "http://127.0.0.1:1" } }));
  const dump = execFileSync(detect.binary, ["--profile", "headless", "--patch", patch, "--dump-config"], { encoding: "utf8", cwd: dir });
  assert(dump.includes("id: mcp-tacos"), "live: TaCos MCP entry not composed");
  assert(/- id: tool-bash\n(?:.*\n)*?\s+disabled: true/.test(dump), "live: tool-bash not disabled");
  assert(explainDshError("MISSING_CREDENTIAL: x").includes("Settings → Model API"), "credential hint");
  live = "pass (patch composed by dsh)";
}

console.log(
  `check-dsh-adapter: pass (installed=${detect.installed} ready=${detect.ready} version=${detect.version ?? "null"} live=${live})`
);
