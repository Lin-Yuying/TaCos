/**
 * H-P3-17 static E2E: composer harness + model + approval.
 * Run: npx tsx scripts/check-composer-harness-model-approval.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const constants = read("src/lib/ai-constants.ts");
assert(constants.includes("AgentHarnessId"), "missing AgentHarnessId");
assert(constants.includes("AgentHarnessOption"), "missing AgentHarnessOption");

const ai = read("src/lib/ai.ts");
assert(ai.includes("listAgentHarnessOptions"), "missing listAgentHarnessOptions");

const page = read("src/app/[workspaceId]/agent/page.tsx");
assert(page.includes("listAgentHarnessOptions"), "agent page must load harness options");
assert(!page.includes("agentCliEngineOptions"), "agent page must not use CLI-only engine list");

const chat = read("src/components/agent-chat.tsx");
assert(
  chat.includes("<SectionLabel>Harness</SectionLabel>") || chat.includes('<SectionLabel>{t("Harness")}</SectionLabel>'),
  "composer must label Harness",
);
assert(chat.includes("ApprovalChip"), "composer must keep ApprovalChip");
assert(chat.includes("approval: draftApproval"), "start must send approval for every harness");
assert(chat.includes("rememberHarness"), "composer must persist harness cookie");

const client = read("src/lib/ai-client.ts");
assert(client.includes("rememberHarness"), "missing rememberHarness");
assert(client.includes("readHarnessCookie"), "missing readHarnessCookie");

console.log("check-composer-harness-model-approval: pass");
