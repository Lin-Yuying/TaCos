// H-P5-29: DeepSeek API (model/API settings) stays separate from dsh (harness).
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };
const settings = read("src/components/settings-view.tsx");
const harnessStart = settings.indexOf('data-testid="harness-settings"');
const aiStart = settings.indexOf(">AI assistant<");
if (harnessStart < 0 || aiStart < 0) fail("settings sections not found");
const harness = settings.slice(harnessStart, aiStart);
const ai = settings.slice(aiStart, settings.indexOf("<section", aiStart + 1));
if (/api\.deepseek\.com|deepseek-chat|apiKey/i.test(harness)) fail("Harness section shows DeepSeek API fields");
if (/\bdsh\b|DeepSeek Harness/.test(ai)) fail("AI assistant section mentions dsh");
for (const f of ["src/lib/harness/adapters/dsh.ts", "src/lib/harness/adapters/dsh-turn.ts"]) {
  const s = read(f);
  if (/@\/lib\/ai["']|aiSettings|decryptKey/.test(s)) fail(`${f} reads TaCos AI API settings`);
}
const consts = read("src/lib/ai-constants.ts");
const ds = consts.slice(consts.indexOf('id: "deepseek"'), consts.indexOf("},", consts.indexOf('id: "deepseek"')));
if (!/not the dsh harness/i.test(ds)) fail("DeepSeek API preset hint does not say it is not the dsh harness");
if (!/label:\s*"DeepSeek API"/.test(ds)) fail("DeepSeek preset label is not 'DeepSeek API'");
console.log("PASS check-deepseek-api-separate");
