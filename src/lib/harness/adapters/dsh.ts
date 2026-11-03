import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import { notImplementedTurn } from "../stub-turn";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "DeepSeek Harness";
const INSTALL_HINT = "Install dsh (npm i -g @deepseek-ai/dsh). Requires Node ^22.19 or >=24.";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  // dsh is often missing. Ready needs a later ACP/headless proof (H-P4).
  return {
    ok: false,
    error: "adapter_incomplete",
    hint: "Install dsh (npm i -g @deepseek-ai/dsh), then complete the ACP adapter.",
  };
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
  listModels(): ModelOption[] {
    return [];
  },
  openTurn(input: TurnInput) {
    return notImplementedTurn("dsh", input);
  },
  install() {
    return installHarnessRecipe("dsh");
  },
  upgrade() {
    return upgradeHarnessRecipe("dsh");
  },
};
