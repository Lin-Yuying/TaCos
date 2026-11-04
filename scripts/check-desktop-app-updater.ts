/**
 * H-DESKTOP-UPDATE-01: electron-updater is wired for packaged desktop builds.
 * App update IPC is separate from Settings › Harness CLI "检查更新".
 */
import fs from "node:fs";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main() {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert(
    Boolean(pkg.dependencies && pkg.dependencies["electron-updater"]),
    "package.json dependencies must list electron-updater (packaged runtime)",
  );
  assert(
    fs.existsSync(path.join(process.cwd(), "node_modules/electron-updater/package.json")),
    "node_modules/electron-updater must be installed",
  );
  assert(fs.existsSync(path.join(process.cwd(), "electron/updater.js")), "electron/updater.js must exist");

  const updater = read("electron/updater.js");
  assert(updater.includes('require("electron-updater")'), "updater must load electron-updater");
  assert(updater.includes("app.isPackaged"), "updater must gate on app.isPackaged");
  assert(updater.includes("autoDownload = false"), "updater must leave autoDownload off in this id");
  assert(updater.includes("tacos:app-update:status"), "updater must register status IPC");
  assert(updater.includes("tacos:app-update:check"), "updater must register check IPC");
  assert(updater.includes("tacos:app-update:download"), "updater must register download IPC");
  assert(updater.includes("tacos:app-update:install"), "updater must register install IPC");
  assert(updater.includes("tacos:app-update:status-changed"), "updater must broadcast status events");
  assert(
    updater.includes("upgradeHarnessRecipe") === false,
    "app updater must not call harness CLI upgrade helpers",
  );

  const mainJs = read("electron/main.js");
  assert(mainJs.includes('require("./updater")'), "main must require ./updater");
  assert(mainJs.includes("initAppUpdater"), "main must call initAppUpdater");

  const preload = read("electron/preload.js");
  assert(preload.includes("appUpdate"), "preload must expose appUpdate");
  assert(preload.includes("tacos:app-update:status"), "preload must invoke app-update status");
  assert(preload.includes("tacos:app-update:check"), "preload must invoke app-update check");
  assert(preload.includes("onStatus"), "preload must expose onStatus subscription");

  const builder = JSON.parse(read("electron/builder.base.json")) as { files?: string[] };
  const files = builder.files ?? [];
  assert(files.includes("!node_modules/**"), "builder still excludes default node_modules");
  assert(
    files.some((f) => f.includes("node_modules/electron-updater")),
    "builder must re-include electron-updater for the packaged app",
  );

  // Distinct from harness Settings update (H-P2-13).
  assert(
    fs.existsSync(path.join(process.cwd(), "src/lib/harness/install-recipes.ts")),
    "harness install recipes must still exist",
  );
  const recipes = read("src/lib/harness/install-recipes.ts");
  assert(recipes.includes("upgradeHarnessRecipe"), "harness CLI upgrade helper must stay");
  const zh = read("src/lib/i18n/zh.ts");
  assert(zh.includes('"Check for updates"'), "harness Settings update copy must stay");
  assert(
    updater.includes("Check for updates") === false,
    "app updater module must not reuse harness Settings update copy",
  );

  // Dev / unpackaged gate: the idle path must set enabled false before loading updater.
  const idleIdx = updater.indexOf("!app.isPackaged");
  const requireIdx = updater.indexOf('require("electron-updater")');
  assert(idleIdx >= 0 && requireIdx > idleIdx, "unpackaged path must return before require(electron-updater)");

  console.log("check-desktop-app-updater: pass");
}

try {
  main();
} catch (err) {
  console.error("check-desktop-app-updater: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
}
