import { findHarnessBinary, readHarnessVersion } from "../detect-bin";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";
import { openOpencodeTurn } from "./opencode-turn";
import { loggedTurn } from "../turn-log";
import { listHarnessModels } from "../models";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";

const LABEL = "OpenCode";
const INSTALL_HINT = "Install OpenCode (curl -fsSL https://opencode.ai/install | bash).";

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  label: LABEL,
  detect(): DetectResult {
    const binary = findHarnessBinary("opencode");
    if (!binary) {
      return {
        id: "opencode",
        label: LABEL,
        installed: false,
        binary: null,
        version: null,
        ready: false,
        error: "missing_binary",
        hint: INSTALL_HINT,
      };
    }
    const version = readHarnessVersion("opencode", binary);
    if (!version) {
      return {
        id: "opencode",
        label: LABEL,
        installed: true,
        binary,
        version: null,
        ready: false,
        error: "version_unreadable",
        hint: INSTALL_HINT,
      };
    }
    return {
      id: "opencode",
      label: LABEL,
      installed: true,
      binary,
      version,
      // Needs no login: without one OpenCode still has its free models.
      ready: true,
      error: null,
      hint: null,
    };
  },
  listModels(): Promise<ModelOption[]> {
    return listHarnessModels("opencode");
  },
  openTurn(input: TurnInput) {
    return loggedTurn("opencode", input, (log) => openOpencodeTurn(input, log));
  },
  install() {
    return installHarnessRecipe("opencode");
  },
  upgrade() {
    return upgradeHarnessRecipe("opencode");
  },
};
