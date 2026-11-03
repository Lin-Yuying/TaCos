import os from "node:os";
import path from "node:path";
import { findHarnessBinary, readHarnessVersion, readJsonFile } from "../detect-bin";
import { notImplementedTurn } from "../stub-turn";
import type { DetectResult, HarnessAdapter, ModelOption, TurnInput } from "../types";

const LABEL = "Codex";
const INSTALL_HINT = "Install the Codex CLI (npm i -g @openai/codex), then run codex login in Terminal.";

function isReady(_binary: string): { ok: boolean; error: string | null; hint: string | null } {
  const auth = readJsonFile(path.join(os.homedir(), ".codex", "auth.json"));
  const tokens = auth?.tokens as Record<string, unknown> | undefined;
  const signedIn = typeof tokens?.access_token === "string" && Boolean(tokens.access_token);
  if (!signedIn) {
    return {
      ok: false,
      error: "not_signed_in",
      hint: "Run codex login in Terminal and sign in with your ChatGPT account.",
    };
  }
  return { ok: true, error: null, hint: null };
}


export const codexAdapter: HarnessAdapter = {
  id: "codex",
  label: LABEL,
  detect(): DetectResult {
    const binary = findHarnessBinary("codex");
    if (!binary) {
      return {
        id: "codex",
        label: LABEL,
        installed: false,
        binary: null,
        version: null,
        ready: false,
        error: "missing_binary",
        hint: INSTALL_HINT,
      };
    }
    const version = readHarnessVersion("codex", binary);
    if (!version) {
      return {
        id: "codex",
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
      id: "codex",
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
    return notImplementedTurn("codex", input);
  },
};
