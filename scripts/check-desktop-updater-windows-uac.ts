/**
 * H-DESKTOP-UPDATE-08: Windows per-user NSIS + asInvoker + two-stage SignPath.
 */
import fs from "node:fs";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main() {
  const builder = JSON.parse(read("electron/builder.base.json")) as {
    win?: { requestedExecutionLevel?: string };
    nsis?: {
      perMachine?: boolean;
      allowElevation?: boolean;
      oneClick?: boolean;
    };
  };
  assert(
    builder.win?.requestedExecutionLevel === "asInvoker",
    "win.requestedExecutionLevel must be asInvoker",
  );
  assert(builder.nsis?.perMachine === false, "nsis.perMachine must be false (per-user)");
  assert(builder.nsis?.allowElevation === true, "nsis.allowElevation must stay true");
  assert(builder.nsis?.oneClick === false, "nsis.oneClick must stay false");

  const wf = read(".github/workflows/windows-release.yml");
  assert(wf.includes("--dir"), "CI must package a win-unpacked directory first");
  assert(wf.includes("--prepackaged"), "CI must build the installer from prepackaged dir");
  assert(
    wf.includes("SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG"),
    "CI must reference the app executable SignPath configuration",
  );
  assert(wf.includes("signed-app"), "CI must collect a signed app executable");
  assert(wf.includes("perMachine"), "CI summary should mention perMachine / UAC");

  const docs = read("docs/windows-signing.md");
  assert(docs.includes("App updates and UAC"), "docs must explain updates and UAC");
  assert(docs.includes("perMachine"), "docs must mention perMachine");
  assert(docs.includes("asInvoker"), "docs must mention asInvoker");
  assert(
    docs.includes("two-stage path automatically") || docs.includes("two-stage"),
    "docs must describe the wired two-stage SignPath path",
  );

  console.log("check-desktop-updater-windows-uac: pass");
}

try {
  main();
} catch (err) {
  console.error(
    "check-desktop-updater-windows-uac: fail -",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
