/**
 * A verified macOS self-update installs on a normal quit without a prompt, while an
 * unfinished download is cancelled and manual restart cannot start a second swap.
 */
import { EventEmitter } from "node:events";
import path from "node:path";
import { Module } from "node:module";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

type RequireFn = (this: unknown, id: string, ...rest: unknown[]) => unknown;
type UpdaterModule = {
  initAppUpdater: (options?: object) => { enabled: boolean };
  getAppUpdateStatus: () => { state: string };
  setTrustedSignatureForTests: (value: boolean) => void;
  stopSchedule: () => void;
};

const updaterPath = path.join(process.cwd(), "electron/updater.js");
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

async function withUpdater(
  holdPreparation: boolean,
  run: (context: {
    ipc: Record<string, () => Promise<unknown>>;
    beforeQuit: () => void;
    swaps: { appPath: string; dir: string; target: string; args: string[] }[];
    quitCalls: () => number;
    dialogCalls: () => number;
    updaterQuitCalls: () => number;
    preparationSignal: () => AbortSignal | undefined;
  }) => Promise<void>,
) {
  const ipc: Record<string, () => Promise<unknown>> = {};
  const events: Record<string, (info?: { version?: string }) => void> = {};
  const swaps: { appPath: string; dir: string; target: string; args: string[] }[] = [];
  let quitCalls = 0;
  let updaterQuitCalls = 0;
  let dialogCalls = 0;
  let preparationSignal: AbortSignal | undefined;

  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    getVersion: () => "2.5.3",
    getLocale: () => "en-US",
    getPath: (name: string) =>
      name === "exe"
        ? "/Applications/TaCos.app/Contents/MacOS/TaCos"
        : `/tmp/tacos-updater-${name}`,
    quit: () => {
      quitCalls += 1;
    },
  });
  const fakeUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    setFeedURL() {},
    on(event: string, handler: (info?: { version?: string }) => void) {
      events[event] = handler;
    },
    async checkForUpdates() {
      const info = { version: "2.5.4", files: [] };
      events["checking-for-update"]?.();
      events["update-available"]?.(info);
      return { updateInfo: info };
    },
    async downloadUpdate() {
      events["update-downloaded"]?.({ version: "2.5.4" });
    },
    quitAndInstall() {
      updaterQuitCalls += 1;
    },
  };
  const fakeMacUpdate = {
    bundleOf: () => "/Applications/TaCos.app",
    canReplace: () => true,
    async prepare({ signal }: { signal: AbortSignal }) {
      preparationSignal = signal;
      if (!holdPreparation) return { appPath: "/pending/new.app", dir: "/pending" };
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
          { once: true },
        );
      });
    },
    startSwap(options: { appPath: string; dir: string; target: string; args: string[] }) {
      swaps.push(options);
    },
  };

  const proto = Module.prototype as unknown as { require: RequireFn };
  const originalRequire = proto.require;
  proto.require = function (this: unknown, id: string, ...rest: unknown[]) {
    if (id === "electron") {
      return {
        app,
        ipcMain: {
          handle(channel: string, handler: () => Promise<unknown>) {
            ipc[channel] = handler;
          },
        },
        BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
        dialog: {
          async showMessageBox() {
            dialogCalls += 1;
            return { response: 1 };
          },
        },
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
    if (id === "electron-updater") return { autoUpdater: fakeUpdater };
    if (id === "./mac-update") return fakeMacUpdate;
    return originalRequire.call(this, id, ...rest);
  };

  if (platformDescriptor) Object.defineProperty(process, "platform", { ...platformDescriptor, value: "darwin" });
  delete require.cache[updaterPath];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const updater = require(updaterPath) as UpdaterModule;
    updater.setTrustedSignatureForTests(false);
    const ready = updater.initAppUpdater({
      log: () => {},
      getServerUrl: () => "http://localhost:3000",
    });
    assert(ready.enabled, "packaged updater must be enabled");
    assert(fakeUpdater.autoInstallOnAppQuit === true, "trusted updater must install on normal quit");
    await run({
      ipc,
      beforeQuit: () => app.emit("before-quit"),
      swaps,
      quitCalls: () => quitCalls,
      dialogCalls: () => dialogCalls,
      updaterQuitCalls: () => updaterQuitCalls,
      preparationSignal: () => preparationSignal,
    });
    updater.stopSchedule();
  } finally {
    proto.require = originalRequire;
    delete require.cache[updaterPath];
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
  }
}

async function main() {
  await withUpdater(false, async ({ ipc, beforeQuit, swaps, quitCalls, dialogCalls, updaterQuitCalls }) => {
    const check = ipc["tacos:app-update:check"];
    assert(typeof check === "function", "check IPC must be registered");
    const checked = (await check()) as { ok: boolean };
    assert(checked.ok, "background check must succeed");
    await new Promise((resolve) => setImmediate(resolve));
    const swapsBeforeQuit = swaps.length;
    assert(swapsBeforeQuit === 0, "downloading must not replace the app");
    assert(dialogCalls() === 0, "background download must not prompt");

    beforeQuit();
    beforeQuit();
    const swapsAfterQuit = swaps.length;
    assert(swapsAfterQuit === 1, "normal quit must start exactly one verified swap");
    assert(swaps[0].target === "/Applications/TaCos.app", "swap must target the running bundle");
    assert(quitCalls() === 0, "before-quit must leave quitting to Electron");
    assert(dialogCalls() === 0, "automatic install must not prompt");

    const restart = ipc["tacos:app-update:restart"];
    assert(typeof restart === "function", "restart IPC must be registered");
    const restarted = (await restart()) as { ok: boolean };
    assert(restarted.ok, "manual restart must still work");
    await new Promise((resolve) => setImmediate(resolve));
    assert(quitCalls() === 1, "manual restart must quit the app");
    assert(swaps.length === 1, "manual restart must not start a second swap");
    assert(updaterQuitCalls() === 0, "self-update must not call electron-updater install");
  });

  await withUpdater(true, async ({ ipc, beforeQuit, swaps, preparationSignal }) => {
    const check = ipc["tacos:app-update:check"];
    assert(typeof check === "function", "check IPC must be registered");
    await check();
    assert(preparationSignal() && !preparationSignal()?.aborted, "preparation must be in flight");
    beforeQuit();
    assert(preparationSignal()?.aborted, "quitting must cancel unfinished preparation");
    assert(swaps.length === 0, "an unfinished download must never be installed");
    await new Promise((resolve) => setImmediate(resolve));
  });

  console.log("check-desktop-updater-quit: pass (automatic swap, cancellation, duplicate guard)");
}

main().catch((err) => {
  console.error("check-desktop-updater-quit: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
