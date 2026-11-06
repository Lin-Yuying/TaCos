/**
 * H-DESKTOP-UPDATE-08: the in-app restart path restarts a downloaded build without the
 * native install dialog (the top-bar pill already asked its own questions).
 */
import path from "node:path";
import { Module } from "node:module";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

type RequireFn = (this: unknown, id: string, ...rest: unknown[]) => unknown;

async function main() {
  const ipcHandlers: Record<string, () => Promise<unknown>> = {};
  const handlers: Record<string, (info?: { version?: string }) => void> = {};
  let quitCalls: number = 0;
  let dialogCalls: number = 0;

  const fakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL() {},
    on(ev: string, fn: (info?: { version?: string }) => void) {
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
    async showMessageBox() {
      dialogCalls += 1;
      throw new Error("the in-app restart path must not open a native dialog");
    },
  };

  const proto = Module.prototype as unknown as { require: RequireFn };
  const orig = proto.require;
  proto.require = function (this: unknown, id: string, ...rest: unknown[]) {
    if (id === "electron") {
      return {
        app: {
          isPackaged: true,
          getVersion: () => "2.0.0",
          getLocale: () => "zh-CN",
          on() {},
          getPath: () => "/tmp/TaCos.app/Contents/MacOS/TaCos",
        },
        ipcMain: {
          handle(channel: string, fn: () => Promise<unknown>) {
            ipcHandlers[channel] = fn;
          },
        },
        BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
        dialog: fakeDialog,
        shell: { async openExternal() {} },
        session: {
          defaultSession: {
            async fetch() {
              return { ok: true, json: async () => ({ busy: false }) };
            },
          },
        },
        net: {},
      };
    }
    if (id === "electron-updater") {
      return { autoUpdater: fakeUpdater };
    }
    return orig.call(this, id, ...rest);
  };

  try {
    const abs = path.join(process.cwd(), "electron/updater.js");
    delete require.cache[abs];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(abs) as {
      initAppUpdater: (o?: object) => { enabled: boolean };
      setTrustedSignatureForTests?: (value: boolean | null) => void;
      stopSchedule: () => void;
    };

    const ready = mod.initAppUpdater({ log: () => {} });
    assert(ready.enabled === true, "packaged mock must enable the updater");
    mod.setTrustedSignatureForTests?.(true);

    const restart = ipcHandlers["tacos:app-update:restart"];
    assert(typeof restart === "function", "restart IPC must be registered");

    // Nothing downloaded: refuse before quitting or prompting.
    const early = (await restart()) as { ok: boolean; confirmed?: boolean };
    assert(early.ok === false, "restart without a downloaded build must fail");
    assert(quitCalls === 0, "restart without a downloaded build must not quit");
    assert(dialogCalls === 0, "restart without a downloaded build must not prompt");

    handlers["update-downloaded"]?.({ version: "2.0.1" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const result = (await restart()) as { ok: boolean; confirmed?: boolean };
    assert(result.ok === true && result.confirmed === true, "restart must confirm");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert(quitCalls >= 1, "restart must call quitAndInstall");
    assert(dialogCalls === 0, "the in-app restart path must not show the native dialog");

    mod.stopSchedule();
    console.log(
      `check-desktop-updater-restart: pass (quits=${quitCalls} dialogs=${dialogCalls})`,
    );
  } finally {
    proto.require = orig;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
