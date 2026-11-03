import { codebuddyAdapter } from "./adapters/codebuddy";
import { codexAdapter } from "./adapters/codex";
import { dshAdapter } from "./adapters/dsh";
import { opencodeAdapter } from "./adapters/opencode";
import { piAdapter } from "./adapters/pi";
import type { DetectResult, HarnessAdapter, HarnessId, InstallResult } from "./types";

const ADAPTERS: HarnessAdapter[] = [
  codexAdapter,
  piAdapter,
  opencodeAdapter,
  dshAdapter,
  codebuddyAdapter,
];

const BY_ID = new Map<HarnessId, HarnessAdapter>(ADAPTERS.map((a) => [a.id, a]));

export function listHarnessAdapters(): HarnessAdapter[] {
  return [...ADAPTERS];
}

export function getHarnessAdapter(id: HarnessId): HarnessAdapter | null {
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
  const adapter = getHarnessAdapter(id);
  if (!adapter?.install) {
    return { ok: false, message: `No install recipe for ${id}.` };
  }
  return adapter.install();
}

export async function runHarnessUpgrade(id: HarnessId): Promise<InstallResult> {
  const adapter = getHarnessAdapter(id);
  if (!adapter?.upgrade) {
    return { ok: false, message: `No upgrade recipe for ${id}.` };
  }
  return adapter.upgrade();
}
