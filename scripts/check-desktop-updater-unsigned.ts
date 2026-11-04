/**
 * H-DESKTOP-UPDATE-07: unsigned / ad-hoc builds open the GitHub download page.
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
  const src = read("electron/updater.js");
  assert(src.includes("hasTrustedAppSignature"), "updater must probe signature trust");
  assert(src.includes("Developer ID Application"), "mac probe must look for Developer ID");
  assert(src.includes("DOWNLOAD_PAGE_URL"), "updater must define the download page URL");
  assert(
    src.includes("github.com/Lin-Yuying/TaCos/releases/latest"),
    "download page must point at the TaCos releases latest URL",
  );
  assert(src.includes("Open Download Page"), "unsigned dialog must offer Open Download Page");
  assert(src.includes("openExternal"), "unsigned path must open an external URL");

  let openCalls = 0;
  let quitCalls = 0;
  let dialogResponse = 0;
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
    async showMessageBox(winOrOpts: unknown, maybeOpts?: { title?: string; buttons?: string[] }) {
      const opts = (maybeOpts ?? winOrOpts) as { title?: string; buttons?: string[] };
      return { response: dialogResponse, title: opts.title, buttons: opts.buttons };
    },
  };

  const fakeShell = {
    async openExternal(url: string) {
      openCalls += 1;
      assert(
        url === "https://github.com/Lin-Yuying/TaCos/releases/latest",
        "must open the releases latest URL",
      );
    },
  };

  const orig = (Module.prototype as { require: Function }).require;
  (Module.prototype as { require: Function }).require = function (this: unknown, id: string) {
    if (id === "electron") {
      return {
        app: {
          isPackaged: true,
          getVersion: () => "2.0.0",
          getPath: () => "/Applications/TaCos.app/Contents/MacOS/TaCos",
          getAppPath: () => "/Applications/TaCos.app/Contents/Resources/app.asar",
        },
        ipcMain: { handle() {} },
        BrowserWindow: {
          getAllWindows: () => [],
          getFocusedWindow: () => null,
        },
        dialog: fakeDialog,
        shell: fakeShell,
      };
    }
    if (id === "electron-updater") return { autoUpdater: fakeUpdater };
    return orig.apply(this, arguments as unknown as [string]);
  };

  try {
    const abs = path.join(process.cwd(), "electron/updater.js");
    delete require.cache[abs];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(abs) as {
      initAppUpdater: (o?: object) => { enabled: boolean };
      confirmAndInstall: (o?: { force?: boolean }) => Promise<{
        ok: boolean;
        confirmed?: boolean;
        degraded?: boolean;
      }>;
      setTrustedSignatureForTests: (v: boolean | null) => void;
      stopSchedule: () => void;
      DOWNLOAD_PAGE_URL: string;
    };

    mod.initAppUpdater({ log: () => {} });
    handlers["update-downloaded"]?.({ version: "2.0.1" });
    // clear auto prompt side effects by forcing next call
    await new Promise((r) => setTimeout(r, 20));

    // Unsigned path
    openCalls = 0;
    quitCalls = 0;
    dialogResponse = 0;
    mod.setTrustedSignatureForTests(false);
    const degraded = await mod.confirmAndInstall({ force: true });
    assert(degraded.ok && degraded.confirmed && degraded.degraded, "unsigned must degrade");
    assert(openCalls === 1, "unsigned confirm must open download page");
    assert(quitCalls === 0, "unsigned path must not quitAndInstall");

    // Signed path still installs
    openCalls = 0;
    quitCalls = 0;
    mod.setTrustedSignatureForTests(true);
    const signed = await mod.confirmAndInstall({ force: true });
    assert(signed.ok && signed.confirmed && !signed.degraded, "signed must install");
    await new Promise((r) => setTimeout(r, 20));
    assert(quitCalls >= 1, "signed path must quitAndInstall");
    assert(openCalls === 0, "signed path must not open download page");

    mod.setTrustedSignatureForTests(null);
    mod.stopSchedule();
    console.log(
      `check-desktop-updater-unsigned: pass (url=${mod.DOWNLOAD_PAGE_URL})`,
    );
  } finally {
    (Module.prototype as { require: Function }).require = orig;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
