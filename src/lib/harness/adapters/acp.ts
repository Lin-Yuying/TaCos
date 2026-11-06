import { findHarnessBinary, readHarnessVersion } from "../detect-bin";
import { installHarnessRecipe, upgradeHarnessRecipe } from "../install-recipes";
import { loggedTurn } from "../turn-log";
import { openAcpTurn } from "@/lib/agent-acp";
import type { DetectResult, HarnessAdapter, TurnInput } from "../types";

const LABEL = "ACP agent";
const HINT = "Set TACOS_ACP_BIN to an ACP-compatible agent command (JSON-RPC over stdio).";

// #79: the generic adapter. Any agent that speaks ACP works without new TaCos code.
export const acpAdapter: HarnessAdapter = {
  id: "acp",
  label: LABEL,
  detect(): DetectResult {
    const binary = findHarnessBinary("acp");
    if (!binary) {
      return {
        id: "acp",
        label: LABEL,
        installed: false,
        binary: null,
        version: null,
        ready: false,
        error: "missing_binary",
        hint: HINT,
      };
    }
    return {
      id: "acp",
      label: LABEL,
      installed: true,
      binary,
      version: readHarnessVersion("acp", binary),
      ready: true,
      error: null,
      hint: null,
    };
  },
  async listModels() {
    return [];
  },
  openTurn(input: TurnInput) {
    return loggedTurn("acp", input, (log) => openAcpTurn(input, log));
  },
  install() {
    return installHarnessRecipe("acp");
  },
  upgrade() {
    return upgradeHarnessRecipe("acp");
  },
};
