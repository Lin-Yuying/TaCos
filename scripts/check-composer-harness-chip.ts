// H-FIX-31: the composer shows three separate controls: harness, model, approval.
import fs from "node:fs";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const chat = fs.readFileSync("src/components/agent-chat.tsx", "utf8");
assert(chat.includes("function HarnessChip("), "HarnessChip component required");
assert((chat.match(/<HarnessChip\b/g) ?? []).length >= 2, "HarnessChip must show in the new and the open composer");
assert((chat.match(/<ModelChip\b/g) ?? []).length >= 2, "ModelChip must show in both composers");
assert((chat.match(/<ApprovalChip\b/g) ?? []).length >= 2, "ApprovalChip must show in both composers");
assert(chat.includes('data-testid="composer-harness"'), "harness chip needs data-testid composer-harness");
assert(chat.includes('data-testid="composer-model"'), "model chip needs data-testid composer-model");
const model = chat.slice(chat.indexOf("function ModelChip("), chat.indexOf("function ApprovalChip("));
assert(!model.includes('t("Harness")'), "ModelChip must not list harnesses; HarnessChip does");
// Switching harness on an open thread updates the same thread (H-P3-18).
assert(chat.includes("setAgentThreadEngineAction(workspaceId, active.id, next)"), "harness switch must keep the session");
console.log("check-composer-harness-chip: pass");
