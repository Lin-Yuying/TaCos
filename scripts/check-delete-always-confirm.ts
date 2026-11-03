/**
 * H-P3-19 static E2E: delete actions always confirm, even when approval is Full.
 * Run: npx tsx scripts/check-delete-always-confirm.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const tools = read("src/lib/agent-tools.ts");
const types = read("src/lib/harness/types.ts");
const codex = read("src/lib/harness/adapters/codex-turn.ts");
const cli = read("src/lib/cli-agents.ts");
const route = read("src/app/api/ai/chat/route.ts");
const consts = read("src/lib/ai-constants.ts");
const chat = read("src/components/agent-chat.tsx");

assert(tools.includes("delete?: boolean"), "AgentToolSpec must mark delete tools");
assert(tools.includes('name: "delete_task"'), "delete_task tool required");
assert(tools.includes("delete: true"), "delete_task must set delete: true");
assert(tools.includes("export function isDeleteTool"), "isDeleteTool helper required");
assert(tools.includes("case \"delete_task\""), "executeAgentTool must handle delete_task");

assert(types.includes("neverAutoApproveTools?: string[]"), "TurnInput must list never-auto tools");
assert(codex.includes("forceConfirm"), "codex-turn must force confirm for delete tools");
assert(codex.includes("neverAutoApproveTools?.includes(toolName)"), "codex-turn must read neverAutoApproveTools");
assert(codex.includes('approvalPolicy: "on-request"'), "codex Agent turns must keep on-request for MCP cards");
assert(!codex.includes('approvalPolicy: input.approval !== "full" ? "on-request" : "never"'), "codex must not skip cards on Full");

assert(cli.includes("neverAutoApprove?: string[]"), "cli agent must list never-auto tools");
assert(cli.includes("!agent.neverAutoApprove?.includes(toolName)"), "cli must force confirm delete tools");
assert(cli.includes('approvalPolicy: work ? "on-request" : "never"'), "cli Agent path must keep on-request");

assert(route.includes("neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete)"), "route must pass delete tools to adapter");
// H-P4-22 removed the cli Agent path. Each harness branch must pass delete tools instead (H-P5-26).
const neverAutoCount = route.split("neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete)").length - 1;
assert(neverAutoCount >= 5, `every harness branch must pass delete tools (found ${neverAutoCount})`);

assert(consts.includes("Delete actions still ask"), "Full access detail must say delete still asks");
assert(!consts.includes("No cards, and the agent may touch the machine"), "Full must not claim no cards");

// UI delete actions always use window.confirm (independent of approval mode).
assert(chat.includes("Delete “${thread.title") || chat.includes("title: thread.title"), "thread delete confirm required");
assert(chat.includes("Delete “${active.title") || chat.includes("title: active.title"), "active thread delete confirm required");
assert(chat.includes('Delete the skill "${skillToken(skill)}"') || chat.includes('Delete the skill "{name}"'), "skill delete confirm required");

console.log("check-delete-always-confirm: pass");
