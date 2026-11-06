import { acpAdapter } from "./adapters/acp";
import { codebuddyAdapter } from "./adapters/codebuddy";
import { codexAdapter } from "./adapters/codex";
import { dshAdapter } from "./adapters/dsh";
import { opencodeAdapter } from "./adapters/opencode";
import { piAdapter } from "./adapters/pi";
import type { DetectResult, HarnessAdapter, HarnessId, InstallResult } from "./types";
import { isServerMode } from "../server-mode";

const ADAPTERS: HarnessAdapter[] = [
  codexAdapter,
  piAdapter,
  opencodeAdapter,
  dshAdapter,
  codebuddyAdapter,
];

// #79: ACP is an opt-in extra, not one of the five built-in harnesses. It only reaches the
// composer when TACOS_ACP_BIN is set, so listHarnessAdapters/listHarnessDetect stay the five.
const EXTRA_ADAPTERS: HarnessAdapter[] = [acpAdapter];
const BY_ID = new Map<HarnessId, HarnessAdapter>([...ADAPTERS, ...EXTRA_ADAPTERS].map((a) => [a.id, a]));

export function listHarnessAdapters(): HarnessAdapter[] {
  return [...ADAPTERS];
}

export function getHarnessAdapter(id: HarnessId): HarnessAdapter | null {
  if (isServerMode()) return null;
  return BY_ID.get(id) ?? null;
}

export function requireHarnessAdapter(id: HarnessId): HarnessAdapter {
  const adapter = BY_ID.get(id);
  if (!adapter) {
    throw new Error(`Unknown harness id: ${id}`);
  }
  return adapter;
}

export function listHarnessDetect(): DetectResult[] {
  if (isServerMode()) {
    return ADAPTERS.map((adapter) => ({
      id: adapter.id,
      label: adapter.label,
      installed: false,
      binary: null,
      version: null,
      ready: false,
      error: null,
      hint: "Open TaCos on your own computer: Agent runs there.",
    }));
  }
  return ADAPTERS.map((adapter) => adapter.detect());
}

export const FIRST_CLASS_HARNESS_IDS: HarnessId[] = [
  "codex",
  "pi",
  "opencode",
  "dsh",
  "codebuddy",
];


export async function runHarnessInstall(id: HarnessId): Promise<InstallResult> {
  if (isServerMode()) return { ok: false, message: "This server does not run harnesses." };
  const adapter = getHarnessAdapter(id);
  if (!adapter?.install) {
    return { ok: false, message: `No install recipe for ${id}.` };
  }
  return adapter.install();
}

export async function runHarnessUpgrade(id: HarnessId): Promise<InstallResult> {
  if (isServerMode()) return { ok: false, message: "This server does not run harnesses." };
  const adapter = getHarnessAdapter(id);
  if (!adapter?.upgrade) {
    return { ok: false, message: `No upgrade recipe for ${id}.` };
  }
  return adapter.upgrade();
}
