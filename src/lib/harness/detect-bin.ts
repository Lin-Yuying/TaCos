import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessId } from "./types";

const HOME = os.homedir();
const CACHE_MS = 30_000;

type Cached<T> = { at: number; value: T };
const binaryCache = new Map<string, Cached<string | null>>();
const versionCache = new Map<string, Cached<string | null>>();

export const HARNESS_BIN_ENV: Record<HarnessId, string> = {
  codex: "TACOS_CODEX_BIN",
  pi: "TACOS_PI_BIN",
  opencode: "TACOS_OPENCODE_BIN",
  dsh: "TACOS_DSH_BIN",
  codebuddy: "TACOS_CODEBUDDY_BIN",
};

export const HARNESS_CANDIDATES: Record<HarnessId, string[]> = {
  codex: [
    path.join(HOME, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(HOME, ".npm-global/bin/codex"),
  ],
  pi: [
    path.join(HOME, ".local/bin/pi"),
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    path.join(HOME, ".npm-global/bin/pi"),
  ],
  opencode: [
    path.join(HOME, ".opencode/bin/opencode"),
    path.join(HOME, ".local/bin/opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode",
  ],
  dsh: [
    path.join(HOME, ".local/bin/dsh"),
    "/opt/homebrew/bin/dsh",
    "/usr/local/bin/dsh",
    path.join(HOME, ".npm-global/bin/dsh"),
  ],
  codebuddy: [
    path.join(HOME, ".local/bin/codebuddy"),
    path.join(HOME, ".local/bin/cbc"),
    "/opt/homebrew/bin/codebuddy",
    "/usr/local/bin/codebuddy",
  ],
};

/** Primary CLI name for PATH lookup. codebuddy also accepts `cbc`. */
export const HARNESS_SHELL_NAMES: Record<HarnessId, string[]> = {
  codex: ["codex"],
  pi: ["pi"],
  opencode: ["opencode"],
  dsh: ["dsh"],
  codebuddy: ["codebuddy", "cbc"],
};

export const HARNESS_VERSION_ARGS: Record<HarnessId, string[]> = {
  codex: ["--version"],
  pi: ["--version"],
  opencode: ["--version"],
  dsh: ["-V"],
  codebuddy: ["--version"],
};

export function executable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fromShell(name: string): string | null {
  const command = process.platform === "win32" ? "where" : "command -v";
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/c", `${command} ${name}`] : ["-lc", `${command} ${name}`];
  try {
    const out = execFileSync(shell, args, {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")[0]
      .trim();
    return out && executable(out) ? out : null;
  } catch {
    return null;
  }
}

export function findHarnessBinary(id: HarnessId): string | null {
  const cached = binaryCache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const override = process.env[HARNESS_BIN_ENV[id]]?.trim();
  let found: string | null = null;
  if (override && executable(override)) found = override;

  for (const candidate of HARNESS_CANDIDATES[id]) {
    if (found) break;
    if (executable(candidate)) found = candidate;
  }

  if (!found) {
    for (const name of HARNESS_SHELL_NAMES[id]) {
      found = fromShell(name);
      if (found) break;
    }
  }

  binaryCache.set(id, { at: Date.now(), value: found });
  return found;
}

export function readHarnessVersion(id: HarnessId, binary: string): string | null {
  const key = `${id}:${binary}`;
  const cached = versionCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  let version: string | null = null;
  try {
    const out = execFileSync(binary, HARNESS_VERSION_ARGS[id], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
      .trim()
      .split("\n")[0]
      .trim();
    version = out || null;
  } catch {
    version = null;
  }

  versionCache.set(key, { at: Date.now(), value: version });
  return version;
}

export function clearHarnessDetectCache(): void {
  binaryCache.clear();
  versionCache.clear();
}

export function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
