import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import { notImplementedTurn } from "../stub-turn";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";

const LABEL = "OpenCode";
const INSTALL_HINT = "Install OpenCode (curl -fsSL https://opencode.ai/install | bash).";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  // OpenCode readiness is binary + version for this foundation id.
  // Provider keys stay on the host CLI config for later adapter work.
  return { ok: true, error: null, hint: null };
}


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
    const ready = isReady(binary);
    return {
      id: "opencode",
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
    return notImplementedTurn("opencode", input);
  },
};
