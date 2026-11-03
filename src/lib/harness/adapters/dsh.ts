import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { openDshTurn } from "./dsh-turn";
import { loggedTurn } from "../turn-log";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "DeepSeek Harness";
const INSTALL_HINT = "Install dsh (npm i -g @deepseek-ai/dsh). Requires Node ^22.19 or >=24.";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  // Binary + version is ready. dsh owns its DeepSeek key; a missing key shows as a turn error.
  return { ok: true, error: null, hint: null };
}


export const dshAdapter: HarnessAdapter = {
  id: "dsh",
  label: LABEL,
  osSandbox: false,
  detect(): DetectResult {
    const binary = findHarnessBinary("dsh");
    if (!binary) {
      return {
        id: "dsh",
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
    const version = readHarnessVersion("dsh", binary);
    if (!version) {
      return {
        id: "dsh",
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
      id: "dsh",
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
    return loggedTurn("dsh", input, (log) => openDshTurn(input, log));
  },
  install() {
    return installHarnessRecipe("dsh");
  },
  upgrade() {
    return upgradeHarnessRecipe("dsh");
  },
};
