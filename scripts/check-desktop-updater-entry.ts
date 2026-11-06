/**
 * H-DESKTOP-UPDATE-03: top-bar app-update pill (Chinese, desktop-only).
 *
 * The 2.3.x update UX moved the control out of the sidebar and into the tab bar, made it
 * a pill that names the version in a tooltip, and moved the restart confirmation into the
 * app. The native Help-menu check and the Settings › Harness CLI update stay separate.
 */
import fs from "node:fs";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `could not slice ${start} … ${end}`);
  return source.slice(from, to);
}

function main() {
  const component = read("src/components/desktop-app-update-button.tsx");
  for (const copy of [
    "新版本",
    "安装并重启",
    "正在准备重启",
    "仍有进行中的任务",
    "更新将停止进行中的任务并重启应用，是否继续？",
    "停止任务并更新",
    "稍后更新",
    "取消准备更新",
  ]) {
    assert(component.includes(copy), `update pill copy must include ${copy}`);
  }
  assert(component.includes("data-desktop-app-update"), "pill must mark itself for tests");
  assert(component.includes("tacosDesktop"), "pill must read window.tacosDesktop");
  assert(component.includes("appUpdate"), "pill must use the appUpdate API");
  assert(
    component.includes("/api/agent/busy"),
    "pill must ask the server about a running Agent before restart",
  );
  assert(
    component.includes("api.restart ?? api.install"),
    "pill must prefer the dialog-free restart path",
  );
  assert(component.includes("bg-update-bg"), "pill must use the update tint token");
  const css = read("src/app/globals.css");
  assert(css.includes("--color-update-bg"), "globals.css must define the update tint token");

  // One render, in the tab bar. The sidebar used to carry the control.
  const shell = read("src/components/workspace-shell.tsx");
  const occurrences = shell.split("DesktopAppUpdateButton").length - 1;
  assert(occurrences === 2, "import + exactly one top-bar render");
  const tabBar = slice(shell, "function TabBar(", "export function WorkspaceShell(");
  assert(tabBar.includes("<DesktopAppUpdateButton />"), "pill must render in the tab bar");
  const rail = slice(shell, "function SidebarRail(", "function useSidebarWidth(");
  assert(!rail.includes("DesktopAppUpdateButton"), "pill must not render in the sidebar rail");
  assert(
    !shell.includes("DesktopAppUpdateButton compact"),
    "the compact sidebar variant must be gone",
  );

  // Electron bridge: the in-app confirmation restarts without a second native dialog.
  const preload = read("electron/preload.js");
  assert(preload.includes("tacos:app-update:restart"), "preload must expose the restart path");
  const updater = read("electron/updater.js");
  const restart = slice(
    updater,
    'ipcMain.handle("tacos:app-update:restart"',
    "function bindUpdaterEvents(",
  );
  assert(restart.includes("runQuitAndInstall()"), "restart must quit and install");
  assert(
    !restart.includes("confirmAndInstall("),
    "restart must not re-open the native install dialog",
  );
  assert(restart.includes("agentBusy()"), "the main process must re-check the Agent");
  assert(
    restart.includes("busy !== false"),
    "restart must refuse while the Agent is working or its state is unknown",
  );
  assert(updater.includes("stage: status.stage"), "status must carry the preparation stage");
  assert(
    updater.includes("cancelable: Boolean(preparationAbort)"),
    "status must say whether the cancel is real",
  );
  assert(
    component.includes("Boolean(status.cancelable)"),
    "the pill must only offer a cancel that reaches the download",
  );
  assert(component.includes("if (!api.restart)"), "older shells keep their own native prompt");

  const header = read("src/components/list-header.tsx");
  assert(
    header.includes('t("Views")') && header.includes("@min-[640px]:hidden"),
    "a narrow list column needs a view menu instead of losing the filters",
  );
  assert(
    header.includes("buildUrl({ q: undefined })"),
    "clearing the search box must also clear the q parameter",
  );

  // Harness Settings copy stays intact and separate.
  const zh = read("src/lib/i18n/zh.ts");
  assert(zh.includes('"Check for updates": "检查更新"'), "harness Settings copy must stay");
  const settings = read("src/components/settings-view.tsx");
  assert(settings.includes('t("Check for updates")'), "Settings harness button must stay");

  console.log("check-desktop-updater-entry: pass");
}

try {
  main();
} catch (err) {
  console.error(
    "check-desktop-updater-entry: fail -",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
