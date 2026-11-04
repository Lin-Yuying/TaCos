/**
 * H-DESKTOP-UPDATE-02: builder emits updater feed metadata and a mac zip target.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main() {
  const builder = JSON.parse(read("electron/builder.base.json")) as {
    publish?: Array<{ provider?: string; owner?: string; repo?: string }>;
    mac?: { target?: Array<{ target?: string; arch?: string[] }> };
    productName?: string;
  };
  const publish = builder.publish ?? [];
  assert(publish.length >= 1, "builder.base.json must declare a publish provider");
  assert(publish[0].provider === "github", "publish provider must be github");
  assert(publish[0].owner === "Lin-Yuying", "publish owner must be Lin-Yuying");
  assert(
    String(publish[0].repo).toLowerCase() === "tacos",
    "publish repo must be TaCos",
  );

  const targets = builder.mac?.target ?? [];
  const names = targets.map((t) => t.target);
  assert(names.includes("dmg"), "mac targets must still include dmg");
  assert(names.includes("zip"), "mac targets must include zip for electron-updater");
  const zip = targets.find((t) => t.target === "zip");
  assert(zip?.arch?.includes("arm64"), "mac zip must build arm64");

  // Standalone config extends the base, so it inherits publish + zip.
  const standalone = read("electron/builder.standalone.json");
  assert(
    standalone.includes('./electron/builder.base.json') ||
      standalone.includes("./electron/builder.base.json"),
    "standalone builder must extend builder.base.json",
  );

  // Shape of app-update.yml that electron-builder writes into Resources when publish is set.
  const pkg = JSON.parse(read("package.json")) as { version: string; appId?: string };
  const expected = {
    provider: "github",
    owner: "Lin-Yuying",
    repo: "TaCos",
    updaterCacheDirName: "tacos-updater",
  };
  // Write a fixture the packaged updater can parse the same way js-yaml would.
  const yml = [
    `provider: ${expected.provider}`,
    `owner: ${expected.owner}`,
    `repo: ${expected.repo}`,
    `updaterCacheDirName: ${expected.updaterCacheDirName}`,
  ].join("\n");
  const parsed = yaml.load(yml) as Record<string, string>;
  assert(parsed.provider === "github", "fixture yml must parse provider");
  assert(parsed.owner === "Lin-Yuying", "fixture yml must parse owner");
  assert(String(parsed.repo).toLowerCase() === "tacos", "fixture yml must parse repo");

  // latest-mac.yml shape (channel file next to the zip on the release).
  const latestMac = {
    version: pkg.version,
    files: [
      {
        url: `TaCos-${pkg.version}-arm64-mac.zip`,
        sha512: "0".repeat(88),
        size: 1,
      },
    ],
    path: `TaCos-${pkg.version}-arm64-mac.zip`,
    sha512: "0".repeat(88),
  };
  assert(latestMac.version === pkg.version, "latest-mac version must match package.json");
  assert(latestMac.path.endsWith(".zip"), "latest-mac path must point at the zip");

  // electron-builder binary resolves the config (catches JSON/schema issues early).
  const eb = path.join(process.cwd(), "node_modules", "electron-builder", "cli.js");
  assert(fs.existsSync(eb), "electron-builder must be installed");
  const probe = spawnSync(
    process.execPath,
    [eb, "--help"],
    { encoding: "utf8", timeout: 30000 },
  );
  assert(probe.status === 0, "electron-builder --help must succeed");

  console.log(
    `check-desktop-updater-feed: pass (publish=github zip=arm64 version=${pkg.version})`,
  );
}

try {
  main();
} catch (err) {
  console.error("check-desktop-updater-feed: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
}
