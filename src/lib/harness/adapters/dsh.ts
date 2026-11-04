import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { dshKeyMissing, openDshTurn } from "./dsh-turn";
import { loggedTurn } from "../turn-log";
import { listHarnessModels } from "../models";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "DeepSeek Harness";
const INSTALL_HINT = "Install dsh (npm i -g @deepseek-ai/dsh). Requires Node ^22.19 or >=24.";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  // Only a turn can tell whether dsh has a working key: ready until one says no. The viewer's own
  // key overrules this in readyWithKeys.
  if (dshKeyMissing()) {
    return { ok: false, error: "no_api_key", hint: "Add your DeepSeek key in Settings → Model API." };
  }
  return { ok: true, error: null, hint: null };
}


export const dshAdapter: HarnessAdapter = {
  id: "dsh",
  label: LABEL,
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
    };
  },
  listModels(): Promise<ModelOption[]> {
    return listHarnessModels("dsh");
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
