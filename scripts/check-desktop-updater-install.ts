/**
 * H-DESKTOP-UPDATE-05: confirm before quitAndInstall, and a Help menu check item.
 * Menu / dialog copy is app-update specific (not Settings › Harness "Check for updates").
 */
import fs from "node:fs";
import path from "node:path";
import { Module } from "node:module";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

async function main() {
  const updater = read("electron/updater.js");
  const mainJs = read("electron/main.js");

  assert(updater.includes("confirmAndInstall"), "updater must confirm before install");
  assert(updater.includes("dialog.showMessageBox"), "updater must use a native confirm dialog");
  assert(updater.includes("quitAndInstall"), "updater must still call quitAndInstall after confirm");
  assert(updater.includes("Restart and Install"), "confirm dialog must offer Restart and Install");
  assert(updater.includes("Later"), "confirm dialog must offer Later");
  assert(updater.includes("Check for App Updates"), "menu label must be app-update specific");
  assert(
    updater.includes('"Check for updates"') === false,
    "app updater must not reuse harness Settings exact copy",
  );
  assert(updater.includes("getAppUpdateMenuItem"), "updater must export a menu item helper");
  assert(updater.includes("checkForAppUpdatesFromMenu"), "updater must expose a menu check path");
  assert(
    updater.includes("update-downloaded") && updater.includes("confirmAndInstall"),
    "downloaded update must open the confirm path",
  );

  assert(mainJs.includes("getAppUpdateMenuItem"), "main must load the app-update menu item");
  assert(
    mainJs.includes("getAppUpdateMenuItem()"),
    "Help menu must include the app-update check item",
  );
  const helpIdx = mainJs.indexOf('label: "Help"');
  const menuItemIdx = mainJs.indexOf("getAppUpdateMenuItem()");
  assert(helpIdx >= 0 && menuItemIdx > helpIdx, "app-update item must sit under Help");

  // Runtime: mock dialog + updater, confirm then quitAndInstall.
  let dialogCalls = 0;
  let dialogResponse = 0;
  let quitCalls = 0;
  const handlers: Record<string, Function> = {};

  const fakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL() {},
    on(ev: string, fn: Function) {
      handlers[ev] = fn;
    },
    async checkForUpdates() {
      return { updateInfo: { version: "2.0.1" } };
    },
    async downloadUpdate() {},
    quitAndInstall() {
      quitCalls += 1;
    },
  };

  const fakeDialog = {
    async showMessageBox(
      winOrOpts: unknown,
      maybeOpts?: { buttons?: string[]; title?: string },
    ) {
      const opts = (maybeOpts ?? winOrOpts) as { buttons?: string[]; title?: string };
      dialogCalls += 1;
      assert(
        opts && opts.title === "Install App Update",
        "dialog title must be Install App Update",
      );
      assert(
        Array.isArray(opts.buttons) && opts.buttons[0] === "Restart and Install",
        "first button must be Restart and Install",
      );
      return { response: dialogResponse };
    },
  };

  const orig = (Module.prototype as { require: Function }).require;
  (Module.prototype as { require: Function }).require = function (this: unknown, id: string) {
    if (id === "electron") {
      return {
        app: { isPackaged: true, getVersion: () => "2.0.0" },
        ipcMain: { handle() {} },
        BrowserWindow: {
          getAllWindows: () => [],
          getFocusedWindow: () => null,
        },
        dialog: fakeDialog,
        shell: { async openExternal() {} },
      };
    }
    if (id === "electron-updater") {
      return { autoUpdater: fakeUpdater };
    }
    return orig.apply(this, arguments as unknown as [string]);
  };

  try {
    // Fresh load
    const abs = path.join(process.cwd(), "electron/updater.js");
    delete require.cache[abs];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(abs) as {
      initAppUpdater: (o?: object) => { enabled: boolean };
      confirmAndInstall: (o?: { force?: boolean; silent?: boolean }) => Promise<{
        ok: boolean;
        confirmed?: boolean;
      }>;
      stopSchedule: () => void;
      MENU_CHECK_LABEL: string;
      INSTALL_CONFIRM: string;
      setTrustedSignatureForTests?: (v: boolean | null) => void;
    };

    assert(mod.MENU_CHECK_LABEL.includes("App Updates"), "menu label export must mention App Updates");
    assert(mod.INSTALL_CONFIRM === "Restart and Install", "confirm label export mismatch");

    const ready = mod.initAppUpdater({ log: () => {} });
    assert(ready.enabled === true, "packaged mock must enable updater");
    // H-DESKTOP-UPDATE-07: force trusted so this check still covers silent install.
    mod.setTrustedSignatureForTests?.(true);

    // A finished download asks nothing until the person clicks.
    dialogResponse = 0;
    handlers["update-downloaded"]?.({ version: "2.0.1" });
    await new Promise((r) => setTimeout(r, 30));
    assert(dialogCalls === 0, "update-downloaded must not open a dialog by itself");
    assert(quitCalls === 0, "update-downloaded must not restart by itself");
    await mod.confirmAndInstall({ force: true });
    assert(dialogCalls >= 1, "clicking update must open the confirm dialog");
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 30));
    assert(quitCalls >= 1, "confirm must call quitAndInstall");

    // Decline path via force re-prompt
    dialogResponse = 1;
    const beforeQuit = quitCalls;
    const declined = await mod.confirmAndInstall({ force: true });
    assert(declined.ok === true && declined.confirmed === false, "Later must not install");
    assert(quitCalls === beforeQuit, "Later must not call quitAndInstall");

    mod.stopSchedule();
  } finally {
    (Module.prototype as { require: Function }).require = orig;
  }

  console.log(
    `check-desktop-updater-install: pass (dialogs=${dialogCalls} quits=${quitCalls})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
