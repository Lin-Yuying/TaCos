// H-P5-29: Model API keys stay out of the Harness section, and adapters only get them through TurnInput.
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(p, "utf8");
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };
const settings = read("src/components/settings-view.tsx");
const harnessStart = settings.indexOf('data-testid="harness-settings"');
const keysStart = settings.indexOf("<ModelKeysSection");
if (harnessStart < 0 || keysStart < harnessStart) fail("settings sections not found");
if (/api\.deepseek\.com|deepseek-chat|apiKey/i.test(settings.slice(harnessStart, keysStart))) fail("Harness section shows API key fields");
for (const f of ["dsh", "dsh-turn", "pi", "pi-turn"].map((name) => `src/lib/harness/adapters/${name}.ts`)) {
  const s = read(f);
  if (/@\/lib\/(ai|model-keys)["']|aiSettings|userModelKeys|decryptKey/.test(s)) fail(`${f} reads stored keys itself`);
  // Process arguments are visible to every user on the machine.
  if (/["']--api-key["']/.test(s)) fail(`${f} passes a key as an argument`);
}
const keys = read("src/lib/model-keys.ts");
if (/process\.env/.test(keys)) fail("model keys must not touch this server's environment");
console.log("PASS check-deepseek-api-separate");
