// U-12: one place that answers "which version is this?".
// The running version comes from package.json, which Next bundles into the server, so a
// packaged standalone payload has no extra file to copy. The previous server version is
// the sibling `<app root>.old/package.json` that deploy/install.sh leaves behind.
import fs from "node:fs";
import path from "node:path";
import pkg from "../../../package.json";
import { isServerMode } from "@/lib/server-mode";

/** Decision: v1 ships the stable channel only. */
export const UPDATE_CHANNEL = "stable" as const;

export const ROLLBACK_COMMAND = "sudo /opt/tacos/deploy/rollback.sh";

export function appVersion(): string {
  const override = process.env.TACOS_APP_VERSION?.trim();
  return override || pkg.version;
}

/** Where the running server lives. The installer sets TACOS_APP_ROOT to /opt/tacos/app. */
export function appRoot(): string {
  const configured = process.env.TACOS_APP_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return isServerMode() ? "/opt/tacos/app" : process.cwd();
}

export function previousAppRoot(): string {
  return `${appRoot()}.old`;
}

function readVersionFile(root: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

export function rollbackState(): {
  available: boolean;
  previousVersion: string | null;
  appRoot: string;
  previousAppRoot: string;
  command: string;
} {
  const previous = previousAppRoot();
  const available = fs.existsSync(previous);
  return {
    available,
    previousVersion: available ? readVersionFile(previous) : null,
    appRoot: appRoot(),
    previousAppRoot: previous,
    command: ROLLBACK_COMMAND,
  };
}
