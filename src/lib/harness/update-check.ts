/**
 * Live update check for harness CLIs (H-P2-13).
 * Uses npm view for package latest versions. Does not install.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FIRST_CLASS_HARNESS_IDS } from "./registry";
import type { HarnessId } from "./types";

const execFileAsync = promisify(execFile);

const NPM_PACKAGES: Record<HarnessId, string> = {
  codex: "@openai/codex",
  pi: "@earendil-works/pi-coding-agent",
  opencode: "opencode-ai",
  dsh: "@deepseek-ai/dsh",
  codebuddy: "@tencent-ai/codebuddy-code",
};

export type HarnessUpdateInfo = {
  id: HarnessId;
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  error: string | null;
};

function normalizeVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : raw.trim() || null;
}

/** Compare dotted versions. Returns true when latest is newer than current. */
export function isNewerVersion(current: string | null, latest: string | null): boolean {
  const a = normalizeVersion(current);
  const b = normalizeVersion(latest);
  if (!a || !b) return false;
  if (a === b) return false;
  const pa = a.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const pb = b.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const left = Number.isFinite(pa[i]) ? pa[i] : 0;
    const right = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return false;
}

async function npmLatest(pkg: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("npm", ["view", pkg, "version"], {
      encoding: "utf8",
      timeout: 20_000,
      env: process.env,
    });
    return normalizeVersion(stdout.trim());
  } catch {
    return null;
  }
}

export async function checkHarnessUpdate(
  id: HarnessId,
  currentVersion: string | null
): Promise<HarnessUpdateInfo> {
  const latest = await npmLatest(NPM_PACKAGES[id]);
  if (!latest) {
    return {
      id,
      current: normalizeVersion(currentVersion),
      latest: null,
      updateAvailable: false,
      error: "latest_unreadable",
    };
  }
  const current = normalizeVersion(currentVersion);
  return {
    id,
    current,
    latest,
    updateAvailable: isNewerVersion(current, latest),
    error: null,
  };
}

export async function checkAllHarnessUpdates(
  currentById: Partial<Record<HarnessId, string | null>>
): Promise<HarnessUpdateInfo[]> {
  const results = await Promise.all(
    FIRST_CLASS_HARNESS_IDS.map((id) => checkHarnessUpdate(id, currentById[id] ?? null))
  );
  return results;
}
