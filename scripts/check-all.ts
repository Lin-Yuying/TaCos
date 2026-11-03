/**
 * H-P5-28: run every harness E2E check in scripts/check-*.ts.
 * Run: npm run check:harness
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "scripts");
const files = fs
  .readdirSync(dir)
  .filter((f) => /^check-.*\.ts$/.test(f) && f !== "check-all.ts")
  .sort();
const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const failed: string[] = [];
for (const file of files) {
  const run = spawnSync(process.execPath, [tsx, path.join(dir, file)], { encoding: "utf8" });
  const out = `${run.stdout}${run.stderr}`.trim().split("\n");
  if (run.status === 0) {
    console.log(`ok   ${file}  ${out[out.length - 1] ?? ""}`);
  } else {
    failed.push(file);
    const err = out.find((l) => l.startsWith("Error")) ?? out[out.length - 1] ?? "";
    console.log(`FAIL ${file}  ${err}`);
  }
}
console.log(`\n${files.length - failed.length}/${files.length} checks pass`);
process.exit(failed.length ? 1 : 0);
