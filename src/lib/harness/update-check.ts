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

// Semver order: 1.2.0-rc.5 is older than 1.2.0, and rc.10 is newer than rc.5.
function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const bothNumbers = /^\d+$/.test(left[i]) && /^\d+$/.test(right[i]);
    const order = bothNumbers ? Number(left[i]) - Number(right[i]) : left[i].localeCompare(right[i]);
    if (order !== 0) return order;
  }
  return 0;
}

/** Compare dotted versions. Returns true when latest is newer than current. */
export function isNewerVersion(current: string | null, latest: string | null): boolean {
  const a = normalizeVersion(current);
  const b = normalizeVersion(latest);
  if (!a || !b) return false;
  if (a === b) return false;
  const [coreA, preA = ""] = a.split("+")[0].split(/-(.*)/);
  const [coreB, preB = ""] = b.split("+")[0].split(/-(.*)/);
  const pa = coreA.split(".").map((part) => Number.parseInt(part, 10));
  const pb = coreB.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const left = Number.isFinite(pa[i]) ? pa[i] : 0;
    const right = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (right > left) return true;
    if (right < left) return false;
  }
  return comparePrerelease(preA, preB) < 0;
}

// The Settings page checks on every open; only the button goes back to npm each time.
const LATEST_CACHE_MS = 60 * 60_000;
const latestCache = new Map<string, { at: number; latest: string }>();

async function npmLatest(pkg: string, force: boolean): Promise<string | null> {
  const hit = latestCache.get(pkg);
  if (!force && hit && Date.now() - hit.at < LATEST_CACHE_MS) return hit.latest;
  try {
    const { stdout } = await execFileAsync("npm", ["view", pkg, "version"], {
      encoding: "utf8",
      timeout: 20_000,
      env: process.env,
    });
    const latest = normalizeVersion(stdout.trim());
    if (latest) latestCache.set(pkg, { at: Date.now(), latest });
    return latest;
  } catch {
    return null;
  }
}

export async function checkHarnessUpdate(
  id: HarnessId,
  currentVersion: string | null,
  force = false
): Promise<HarnessUpdateInfo> {
  // Nothing to upgrade, so not worth asking npm or reporting a failure about.
  if (!currentVersion) return { id, current: null, latest: null, updateAvailable: false, error: null };
  const latest = await npmLatest(NPM_PACKAGES[id], force);
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
  currentById: Partial<Record<HarnessId, string | null>>,
  force = false
): Promise<HarnessUpdateInfo[]> {
  const results = await Promise.all(
    FIRST_CLASS_HARNESS_IDS.map((id) => checkHarnessUpdate(id, currentById[id] ?? null, force))
  );
  return results;
}
