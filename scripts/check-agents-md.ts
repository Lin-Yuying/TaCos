/**
 * H-P5-28 E2E: AGENTS.md and the test runner match the harness model.
 * Run: npx tsx scripts/check-agents-md.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const doc = read("AGENTS.md");
// Clean cutover: no Chat / Work mode language.
assert(!/Chat mode|Work mode|Work-mode|Chat\/Work/.test(doc), "AGENTS.md still describes Chat/Work modes");
for (const id of ["codex", "pi", "opencode", "codebuddy", "dsh"]) {
  assert(doc.includes(`\`${id}\``), `AGENTS.md must name harness ${id}`);
}
assert(/qoder/i.test(doc) && /skipped/i.test(doc), "AGENTS.md must say qoder is skipped");
for (const needle of [
  "src/lib/harness",
  "harness_enabled",
  "decideToolApproval",
  "Delete always confirms",
  "loggedTurn",
  "TACOS_LOG_DIR",
  "New chat",
  "npm run check:harness",
]) {
  assert(doc.includes(needle), `AGENTS.md must mention ${needle}`);
}
assert(/DeepSeek API/.test(doc) && /not .*dsh|dsh.*not/i.test(doc), "AGENTS.md must separate DeepSeek API from dsh");

const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
assert(pkg.scripts["check:harness"] === "tsx scripts/check-all.ts", "package.json needs check:harness");
assert(fs.existsSync(path.join(root, "scripts/check-all.ts")), "scripts/check-all.ts missing");

const glossary = doc.slice(doc.indexOf("## Glossary"));
assert(/\| Workspace \|/.test(glossary), "AGENTS.md glossary must define Workspace");
assert(!/\| Work space \||\| Work-space \|/.test(glossary), "Glossary Workspace must be one word");

const shell = read("src/components/workspace-shell.tsx");
const navBlock = shell.slice(shell.indexOf("data-sidebar-nav"), shell.indexOf("data-sidebar-footer"));
const footerStart = shell.indexOf("data-sidebar-footer");
const footerEnd = shell.indexOf("{/* The handle spans both looks", footerStart);
const footerBlock = shell.slice(footerStart, footerEnd);
function after(needle: string, block: string) {
  const at = block.indexOf(needle);
  assert(at >= 0, `workspace-shell missing ${needle}`);
  return at;
}
const navOrder = [
  't("Inbox")',
  't("Agent")',
  't("Tasks")',
  't("Projects")',
  't("Documents")',
  't("Your team")',
];
for (let i = 1; i < navOrder.length; i++) {
  assert(
    after(navOrder[i]!, navBlock) > after(navOrder[i - 1]!, navBlock),
    `Sidebar nav order: ${navOrder[i - 1]} must precede ${navOrder[i]}`
  );
}
assert(!navBlock.includes('label={t("Workspace")}'), 'Sidebar must use "Tasks", not "Workspace" as a group');
assert(
  /t\("Help"\)[\s\S]*t\("Trash"\)[\s\S]*t\("Settings"\)/.test(footerBlock),
  "Sidebar footer: Help, Trash, Settings"
);
assert(!footerBlock.includes("/labels"), "Labels must not stay in the sidebar footer");
assert(!footerBlock.includes("/review"), "Review belongs under Tasks, not the footer");

const settings = read("src/components/settings-view.tsx");
assert(settings.includes('id="labels"'), "Settings must host Labels");

console.log("check-agents-md: pass");
