#!/usr/bin/env node
// Builds the code a member's computer runs for a TaCos server: the runner, the module the desktop
// app uses to change their API keys, and the tool bridge the harnesses spawn. It must not contain
// the database: nothing here keeps workspace data.
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "server", "runner");
mkdirSync(outDir, { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { runner: "src/runner/main.ts", "runner-keys": "src/runner/keys.ts" },
  outdir: outDir,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  metafile: true,
  logLevel: "warning",
});

const forbidden = Object.keys(result.metafile.inputs).filter((file) => /better-sqlite3|drizzle-orm|src\/db\//.test(file));
if (forbidden.length > 0) {
  console.error(`[bundle-runner] the runner pulled in the database: ${forbidden.join(", ")}`);
  process.exit(1);
}
copyFileSync(path.join(root, "scripts", "agent-mcp.mjs"), path.join(outDir, "agent-mcp.mjs"));
console.log(`[bundle-runner] ${path.relative(root, outDir)} ready`);
