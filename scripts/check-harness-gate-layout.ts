/**
 * H-P2-15 static E2E: harnessGate API for Agent layout.
 * Run: npx tsx scripts/check-harness-gate-layout.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const layout = read("src/app/[workspaceId]/layout.tsx");
assert(layout.includes("getWorkspaceHarnessGate"), "layout must load harness gate");
// 2.3 lets a member with existing threads reach Agent even when the harness gate is closed.
assert(/agentAllowed=\{harnessGate\.agentAllowed[^}]*\}/.test(layout), "layout must pass the harness gate to agentAllowed");

const shell = read("src/components/workspace-shell.tsx");
assert(shell.includes("agentAllowed: boolean"), "shell must accept agentAllowed");
assert(shell.includes("disabled={!agentAllowed}"), "Agent nav must respect gate");
assert(shell.includes("Enable a ready harness in Settings"), "disabled title must guide user");

const index = read("src/lib/harness/index.ts");
assert(index.includes("getWorkspaceHarnessGate"), "public export required");

console.log("check-harness-gate-layout: pass");
