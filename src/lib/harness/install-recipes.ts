/**
 * Per-harness install / upgrade recipes (H-P2-12).
 * Empirical commands from findings/H-P0-01. Failures return diagnosable messages.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warmHarnessDetectCache,clearHarnessDetectCache, findHarnessBinary, HARNESS_BIN_ENV, readHarnessVersion } from "./detect-bin";
import { clearHarnessModelCache } from "./models";
import type { HarnessId, InstallResult } from "./types";

const execFileAsync = promisify(execFile);

const NPM_PACKAGES: Record<HarnessId, string> = {
  codex: "@openai/codex",
  pi: "@earendil-works/pi-coding-agent",
  opencode: "opencode-ai",
  dsh: "@deepseek-ai/dsh",
  codebuddy: "@tencent-ai/codebuddy-code",
  acp: "",
};

const UPGRADE_CLI: Partial<Record<HarnessId, { bin: string; args: string[] }>> = {
  codex: { bin: "codex", args: ["update"] },
  pi: { bin: "pi", args: ["update", "--self"] },
  opencode: { bin: "opencode", args: ["upgrade"] },
  codebuddy: { bin: "codebuddy", args: ["update"] },
};

function truncate(text: string, max = 800): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function diagnose(err: unknown, context: string): string {
  const anyErr = err as {
    code?: string | number;
    message?: string;
    stdout?: string;
    stderr?: string;
  };
  const stderr = typeof anyErr.stderr === "string" ? anyErr.stderr : "";
  const stdout = typeof anyErr.stdout === "string" ? anyErr.stdout : "";
  const combined = truncate(`${stderr}\n${stdout}\n${anyErr.message ?? ""}`);

  if (anyErr.code === "ENOENT") {
    return `${context} failed: command not found on PATH. Check Node/npm or the harness binary.`;
  }
  if (/EACCES|permission denied/i.test(combined)) {
    return `${context} failed: permission denied. Install into a user-writable npm prefix.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|network|ETIMEDOUT|fetch failed/i.test(combined)) {
    return `${context} failed: network error. Check proxy and connectivity.`;
  }
  if (/engine|unsupported engine|EBADENGINE/i.test(combined)) {
    return `${context} failed: Node engine mismatch. dsh needs Node ^22.19 or >=24. Detail: ${combined}`;
  }
  if (/not signed in|login|auth/i.test(combined)) {
    return `${context} finished with an auth warning. Sign in from Terminal if detect still says not ready. Detail: ${combined}`;
  }
  return `${context} failed. Detail: ${combined || "unknown error"}`;
}

async function runCapture(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<{ ok: true; out: string } | { ok: false; error: unknown }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, out: truncate(`${stdout}\n${stderr}`) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function npmGlobalInstall(pkg: string): Promise<{ ok: true; out: string } | { ok: false; error: unknown }> {
  // Prefer `npm` on PATH (nvm login shell already used by detect).
  return runCapture("npm", ["i", "-g", pkg], 300_000);
}

async function afterDetect(id: HarnessId): Promise<{ binary: string | null; version: string | null }> {
  clearHarnessDetectCache();
  clearHarnessModelCache();
  await warmHarnessDetectCache();
  const binary = findHarnessBinary(id);
  const version = binary ? readHarnessVersion(id, binary) : null;
  return { binary, version };
}

export async function installHarnessRecipe(id: HarnessId): Promise<InstallResult> {
  const pkg = NPM_PACKAGES[id];

  // OpenCode: try official installer first, then npm package.
  if (id === "opencode") {
    const curl = await runCapture(
      "bash",
      ["-lc", "curl -fsSL https://opencode.ai/install | bash"],
      300_000
    );
    if (curl.ok) {
      const { binary, version } = await afterDetect(id);
      if (binary) {
        return {
          ok: true,
          message: `OpenCode installed at ${binary}.`,
          version,
        };
      }
    }
    const npm = await npmGlobalInstall(pkg);
    if (!npm.ok) {
      return { ok: false, message: diagnose(npm.error, "OpenCode install") };
    }
    const { binary, version } = await afterDetect(id);
    if (!binary) {
      return {
        ok: false,
        message:
          "OpenCode install finished, but the binary is not on PATH. Open a new login shell or set TACOS_OPENCODE_BIN.",
        version: null,
      };
    }
    return { ok: true, message: `OpenCode installed at ${binary}.`, version };
  }

  const npm = await npmGlobalInstall(pkg);
  if (!npm.ok) {
    return { ok: false, message: diagnose(npm.error, `${id} install`) };
  }

  const { binary, version } = await afterDetect(id);
  if (!binary) {
    return {
      ok: false,
      message: `${id} install finished, but the binary is not on PATH. Check nvm PATH or set ${HARNESS_BIN_ENV[id]}.`,
      version: null,
    };
  }

  let message = `${id} installed at ${binary}.`;
  if (id === "codex") message += " Run codex login in Terminal if detect says not signed in.";
  if (id === "pi") message += " Run pi and /login if detect says not signed in.";
  if (id === "dsh") message += " Adapter turn path is still incomplete.";

  return { ok: true, message, version };
}

export async function upgradeHarnessRecipe(id: HarnessId): Promise<InstallResult> {
  const existing = findHarnessBinary(id);
  const cli = UPGRADE_CLI[id];

  if (existing && cli) {
    const result = await runCapture(existing, cli.args, 300_000);
    if (result.ok) {
      const { binary, version } = await afterDetect(id);
      return {
        ok: true,
        message: `${id} upgrade finished${version ? ` (version ${version})` : ""}.`,
        version,
      };
    }
    // Fall through to npm when CLI upgrade is missing or fails.
  }

  const pkg = `${NPM_PACKAGES[id]}@latest`;
  const npm = await npmGlobalInstall(pkg);
  if (!npm.ok) {
    return { ok: false, message: diagnose(npm.error, `${id} upgrade`) };
  }
  const { binary, version } = await afterDetect(id);
  if (!binary) {
    return {
      ok: false,
      message: `${id} upgrade finished, but the binary is not on PATH.`,
      version: null,
    };
  }
  return {
    ok: true,
    message: `${id} upgraded at ${binary}${version ? ` (version ${version})` : ""}.`,
    version,
  };
}
