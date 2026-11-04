/**
 * H-DESKTOP-UPDATE-03: sidebar app-update control (Chinese, desktop-only).
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
  assert(
    fs.existsSync(path.join(process.cwd(), "src/components/desktop-app-update-button.tsx")),
    "desktop-app-update-button.tsx must exist",
  );
  const btn = read("src/components/desktop-app-update-button.tsx");
  assert(btn.includes("检查应用更新"), "button must use Chinese app-update copy");
  assert(btn.includes("重启以安装更新"), "button must offer restart-to-install copy");
  assert(btn.includes("tacosDesktop"), "button must read window.tacosDesktop");
  assert(btn.includes("appUpdate"), "button must use appUpdate API");
  assert(btn.includes("data-desktop-app-update"), "button must mark itself for tests");
  const copyBlock = btn.slice(btn.indexOf("const COPY"), btn.indexOf("} as const;") + 1);
  assert(copyBlock.includes("检查应用更新"), "COPY must include 检查应用更新");
  assert(
    copyBlock.replaceAll("检查应用更新", "").includes("检查更新") === false,
    "COPY must not reuse harness phrase 检查更新",
  );

  const shell = read("src/components/workspace-shell.tsx");
  assert(
    shell.includes("DesktopAppUpdateButton"),
    "workspace-shell must render DesktopAppUpdateButton",
  );
  const occurrences = shell.split("DesktopAppUpdateButton").length - 1;
  assert(occurrences >= 3, "import + rail + full sidebar must reference the button");

  // Harness Settings copy stays intact and separate.
  const zh = read("src/lib/i18n/zh.ts");
  assert(zh.includes('"Check for updates": "检查更新"'), "harness Settings copy must stay");
  const settings = read("src/components/settings-view.tsx");
  assert(settings.includes('t("Check for updates")'), "Settings harness button must stay");

  console.log("check-desktop-updater-sidebar: pass");
}

try {
  main();
} catch (err) {
  console.error(
    "check-desktop-updater-sidebar: fail -",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
