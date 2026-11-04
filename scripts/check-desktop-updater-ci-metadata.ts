/**
 * H-DESKTOP-UPDATE-06: desktop release CI attaches updater channel files.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main() {
  assert(
    fs.existsSync(path.join(process.cwd(), "scripts/write-desktop-updater-metadata.ts")),
    "write-desktop-updater-metadata.ts must exist",
  );

  const wf = read(".github/workflows/windows-release.yml");
  assert(wf.includes("latest.yml"), "Windows release CI must mention latest.yml");
  assert(wf.includes("latest-mac.yml"), "macOS release CI must mention latest-mac.yml");
  assert(
    wf.includes("write-desktop-updater-metadata"),
    "CI must run write-desktop-updater-metadata",
  );
  assert(
    wf.includes(".zip") || wf.includes("*.zip"),
    "CI must upload the mac zip for electron-updater",
  );

  // Writer smoke: tiny fake artifacts → channel files.
  const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-updater-meta-"));
  try {
    const exe = path.join(tmp, "TaCos-Local-Setup-2.0.0.exe");
    const zip = path.join(tmp, "TaCos-2.0.0-arm64-mac.zip");
    fs.writeFileSync(exe, "fake-exe");
    fs.writeFileSync(zip, "fake-zip");

    const run = (args: string[]) => {
      const r = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/write-desktop-updater-metadata.ts", ...args],
        { encoding: "utf8", cwd: process.cwd() },
      );
      // Prefer npx tsx if node --import fails
      if (r.status !== 0) {
        const r2 = spawnSync(
          "npx",
          ["tsx", "scripts/write-desktop-updater-metadata.ts", ...args],
          { encoding: "utf8", cwd: process.cwd() },
        );
        assert(r2.status === 0, `writer failed: ${r2.stderr || r2.stdout || r.stderr}`);
        return r2.stdout;
      }
      return r.stdout;
    };

    run(["--platform", "win", "--file", exe, "--out", tmp, "--version", "2.0.0"]);
    run(["--platform", "mac", "--file", zip, "--out", tmp, "--version", "2.0.0"]);

    const latest = read(path.relative(process.cwd(), path.join(tmp, "latest.yml")));
    const latestMac = read(path.relative(process.cwd(), path.join(tmp, "latest-mac.yml")));
    assert(latest.includes("version: 2.0.0"), "latest.yml must include version");
    assert(latest.includes("TaCos-Local-Setup-2.0.0.exe"), "latest.yml must name the exe");
    assert(latest.includes("sha512:"), "latest.yml must include sha512");
    assert(latestMac.includes("version: 2.0.0"), "latest-mac.yml must include version");
    assert(
      latestMac.includes("TaCos-2.0.0-arm64-mac.zip"),
      "latest-mac.yml must name the zip",
    );
    assert(latestMac.includes("sha512:"), "latest-mac.yml must include sha512");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("check-desktop-updater-ci-metadata: pass");
}

try {
  main();
} catch (err) {
  console.error(
    "check-desktop-updater-ci-metadata: fail -",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
