/**
 * H-P5-26 E2E: TaCos MCP write path and delete confirms.
 * Drives POST /api/agent/tools in process with real grants.
 * Run: npx tsx scripts/check-mcp-write-delete-e2e.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  answerAgentApproval,
  issueAgentToolGrant,
  subscribeToolApprovals,
  type ToolApprovalCard,
} from "../src/lib/agent-sessions";
import { AGENT_TOOLS } from "../src/lib/agent-tools";
import { decideToolApproval } from "../src/lib/agent-tool-policy";
import { POST } from "../src/app/api/agent/tools/route";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const deleteTools = AGENT_TOOLS.filter((tool) => tool.delete);
const writeTools = AGENT_TOOLS.filter((tool) => tool.write && !tool.delete);
const readTools = AGENT_TOOLS.filter((tool) => !tool.write);
assert(deleteTools.length > 0, "need at least one delete tool");

// 1. Policy matrix: delete always asks, for every mode and every turn grant.
for (const approval of ["ask", "auto", "full"] as const) {
  for (const autoApproveTurn of [false, true]) {
    for (const spec of deleteTools) {
      const all = AGENT_TOOLS.map((t) => t.name);
      assert(
        decideToolApproval(spec, { approval, autoApproveTurn, autoApproveTools: all, neverAutoApproveTools: [] }) === "confirm",
        `delete ${spec.name} must confirm (approval=${approval} turn=${autoApproveTurn})`
      );
    }
    for (const spec of readTools) {
      assert(
        decideToolApproval(spec, { approval, autoApproveTurn, autoApproveTools: [], neverAutoApproveTools: [] }) === "run",
        `read ${spec.name} must run`
      );
    }
  }
}
for (const spec of writeTools) {
  const base = { autoApproveTurn: false, autoApproveTools: [], neverAutoApproveTools: [] };
  assert(decideToolApproval(spec, { ...base, approval: "ask" }) === "confirm", `write ${spec.name} asks on Ask`);
  assert(decideToolApproval(spec, { ...base, approval: "full" }) === "run", `write ${spec.name} runs on Full`);
  assert(
    decideToolApproval(spec, { ...base, approval: "full", neverAutoApproveTools: [spec.name] }) === "confirm",
    `never-auto ${spec.name} confirms on Full`
  );
}

// 2. Every adapter keeps the TaCos MCP write path (no harness-native write tools).
for (const file of ["codex-turn", "pi-turn", "opencode-turn", "codebuddy-turn", "dsh-turn"]) {
  const rel = `src/lib/harness/adapters/${file}.ts`;
  assert(fs.existsSync(path.join(root, rel)), `${rel} missing`);
}
const route = fs.readFileSync(path.join(root, "src/app/api/agent/tools/route.ts"), "utf8");
assert(route.includes("decideToolApproval"), "tools route must use the shared policy");

// 3. Live route: delete on Full with Allow-turn still publishes a card; Deny blocks it.
async function main() {
  const spec = deleteTools[0];
  const grant = issueAgentToolGrant({
    threadId: "e2e-h-p5-26",
    workspaceId: "w",
    projectId: "p",
    projectKey: "P",
    userId: "u",
    approval: "full",
    autoApproveTools: AGENT_TOOLS.map((t) => t.name),
    neverAutoApproveTools: [],
  });
  grant.autoApproveTurn = true;
  const cards: ToolApprovalCard[] = [];
  const unsubscribe = subscribeToolApprovals(grant.threadId, (card) => {
    cards.push(card);
    setTimeout(() => answerAgentApproval(card.requestId, "decline"), 10);
  });
  const response = await POST(
    new Request("http://local/api/agent/tools", {
      method: "POST",
      headers: { authorization: `Bearer ${grant.token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: spec.name, arguments: { key: "P-1", workspace: "w" } }),
    })
  );
  unsubscribe();
  const body = (await response.json()) as { isError?: boolean; content?: { text: string }[] };
  assert(cards.length === 1, `delete on Full must publish one card (got ${cards.length})`);
  assert(cards[0].tool === `tacos.${spec.name}`, "card names the TaCos tool");
  assert(body.isError === true && /denied/.test(body.content?.[0]?.text ?? ""), "Deny must block delete");

  const bad = await POST(new Request("http://local/api/agent/tools", { method: "POST", body: "{}" }));
  assert(bad.status === 401, "no token must be 401");

  console.log(
    `check-mcp-write-delete-e2e: pass (delete=${deleteTools.length} write=${writeTools.length} read=${readTools.length}; live Full+Allow-turn delete card + deny)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
