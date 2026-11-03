import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import { openPiTurn } from "./pi-turn";
import { loggedTurn } from "../turn-log";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "Pi";
const INSTALL_HINT = "Install Pi (npm i -g @earendil-works/pi-coding-agent), then run pi and /login.";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  const auth = readJsonFile(path.join(os.homedir(), ".pi", "agent", "auth.json"));
  if (!auth) {
    return {
      ok: false,
      error: "not_signed_in",
      hint: "Run pi in Terminal, then /login to connect a subscription.",
    };
  }
  return { ok: true, error: null, hint: null };
}


export const piAdapter: HarnessAdapter = {
  id: "pi",
  label: LABEL,
  osSandbox: false,
  detect(): DetectResult {
    const binary = findHarnessBinary("pi");
    if (!binary) {
      return {
        id: "pi",
        label: LABEL,
        installed: false,
        binary: null,
        version: null,
        ready: false,
        error: "missing_binary",
        hint: INSTALL_HINT,
        osSandbox: false,
        riskLabel: "No OS sandbox",
      };
    }
    const version = readHarnessVersion("pi", binary);
    if (!version) {
      return {
        id: "pi",
        label: LABEL,
        installed: true,
        binary,
        version: null,
        ready: false,
        error: "version_unreadable",
        hint: INSTALL_HINT,
        osSandbox: false,
        riskLabel: "No OS sandbox",
      };
    }
    const ready = isReady(binary);
    return {
      id: "pi",
      label: LABEL,
      installed: true,
      binary,
      version,
      ready: ready.ok,
      error: ready.ok ? null : ready.error,
      hint: ready.ok ? null : ready.hint,
      osSandbox: false,
      riskLabel: "No OS sandbox",
    };
  },
  listModels(): ModelOption[] {
    return [];
  },
  openTurn(input: TurnInput) {
    return loggedTurn("pi", input, (log) => openPiTurn(input, log));
  },
  install() {
    return installHarnessRecipe("pi");
  },
  upgrade() {
    return upgradeHarnessRecipe("pi");
  },
};
