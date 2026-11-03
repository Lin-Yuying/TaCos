import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import { notImplementedTurn } from "../stub-turn";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "WorkBuddy";
const INSTALL_HINT = "Install WorkBuddy CLI (npm i -g @tencent-ai/codebuddy-code).";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  // WorkBuddy / codebuddy: binary + version is enough for detect foundation.
  return { ok: true, error: null, hint: null };
}


export const codebuddyAdapter: HarnessAdapter = {
  id: "codebuddy",
  label: LABEL,
  detect(): DetectResult {
    const binary = findHarnessBinary("codebuddy");
    if (!binary) {
      return {
        id: "codebuddy",
        label: LABEL,
        installed: false,
        binary: null,
        version: null,
        ready: false,
        error: "missing_binary",
        hint: INSTALL_HINT,
      };
    }
    const version = readHarnessVersion("codebuddy", binary);
    if (!version) {
      return {
        id: "codebuddy",
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
      id: "codebuddy",
      label: LABEL,
      installed: true,
      binary,
      version,
      ready: ready.ok,
      error: ready.ok ? null : ready.error,
      hint: ready.ok ? null : ready.hint,
    };
  },
  listModels(): ModelOption[] {
    return [];
  },
  openTurn(input: TurnInput) {
    return notImplementedTurn("codebuddy", input);
  },
  install() {
    return installHarnessRecipe("codebuddy");
  },
  upgrade() {
    return upgradeHarnessRecipe("codebuddy");
  },
};
