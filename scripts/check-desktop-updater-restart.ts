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
  // "busy" is what /api/agent/busy answers; null means the probe failed.
  let busyState: boolean | null = false;

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
              if (busyState === null) throw new Error("busy probe failed");
              return { ok: true, json: async () => ({ busy: busyState === true }) };
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
      getAppUpdateStatus: () => Record<string, unknown>;
      setTrustedSignatureForTests?: (value: boolean | null) => void;
      stopSchedule: () => void;
    };

    const ready = mod.initAppUpdater({
      log: () => {},
      getServerUrl: () => "http://localhost:3000",
    });
    assert(ready.enabled === true, "packaged mock must enable the updater");
    mod.setTrustedSignatureForTests?.(true);

    const status = mod.getAppUpdateStatus();
    assert("stage" in status, "status must carry the preparation stage");
    assert("cancelable" in status, "status must say whether cancel is real");

    const restart = ipcHandlers["tacos:app-update:restart"];
    assert(typeof restart === "function", "restart IPC must be registered");

    // Nothing downloaded: refuse before quitting or prompting.
    const early = (await restart()) as { ok: boolean; confirmed?: boolean };
    assert(early.ok === false, "restart without a downloaded build must fail");
    assert(quitCalls === 0, "restart without a downloaded build must not quit");
    assert(dialogCalls === 0, "restart without a downloaded build must not prompt");

    handlers["update-downloaded"]?.({ version: "2.0.1" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A live or unknown Agent blocks the restart in the main process too.
    busyState = true;
    const busy = (await restart()) as { ok: boolean; busy?: boolean };
    assert(busy.ok === false && busy.busy === true, "restart must refuse while the Agent works");
    assert(quitCalls === 0, "busy restart must not quit");
    busyState = null;
    const unknown = (await restart()) as { ok: boolean; busy?: boolean };
    assert(unknown.ok === false && unknown.busy === true, "restart must refuse when the probe fails");
    assert(quitCalls === 0, "unknown restart must not quit");
    busyState = false;

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
