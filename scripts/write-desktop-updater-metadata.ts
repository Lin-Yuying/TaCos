/**
 * H-DESKTOP-UPDATE-06: write electron-updater channel files for a release artifact.
 *
 * Usage:
 *   npx tsx scripts/write-desktop-updater-metadata.ts --platform win|mac --file <path> [--out <dir>]
 *
 * Windows: writes latest.yml next to the installer (or --out).
 * macOS: writes latest-mac.yml for the zip artifact.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function parseArgs(argv: string[]) {
  const out: { platform?: string; file?: string; outDir?: string; version?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--platform") out.platform = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--out") out.outDir = argv[++i];
    else if (a === "--version") out.version = argv[++i];
  }
  return out;
}

function sha512File(filePath: string): { sha512: string; size: number } {
  const buf = fs.readFileSync(filePath);
  return {
    sha512: crypto.createHash("sha512").update(buf).digest("base64"),
    size: buf.length,
  };
}

function yamlEscape(value: string): string {
  // electron-updater accepts plain scalars; quote when needed.
  if (/[:#{}[\],&*?|>!%@`]/.test(value) || value.includes(" ")) {
    return JSON.stringify(value);
  }
  return value;
}

function writeChannelFile(opts: {
  channelPath: string;
  version: string;
  fileName: string;
  sha512: string;
  size: number;
}) {
  const releaseDate = new Date().toISOString();
  const body = [
    `version: ${yamlEscape(opts.version)}`,
    `files:`,
    `  - url: ${yamlEscape(opts.fileName)}`,
    `    sha512: ${opts.sha512}`,
    `    size: ${opts.size}`,
    `path: ${yamlEscape(opts.fileName)}`,
    `sha512: ${opts.sha512}`,
    `releaseDate: ${yamlEscape(releaseDate)}`,
    ``,
  ].join("\n");
  fs.writeFileSync(opts.channelPath, body, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.platform === "win" || args.platform === "mac", "--platform must be win or mac");
  assert(args.file, "--file is required");
  const filePath = path.resolve(args.file!);
  assert(fs.existsSync(filePath), `artifact not found: ${filePath}`);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as { version: string };
  const version = args.version || pkg.version;
  const { sha512, size } = sha512File(filePath);
  const fileName = path.basename(filePath);
  const outDir = args.outDir ? path.resolve(args.outDir) : path.dirname(filePath);
  fs.mkdirSync(outDir, { recursive: true });

  const channelName = args.platform === "win" ? "latest.yml" : "latest-mac.yml";
  if (args.platform === "mac") {
    assert(fileName.endsWith(".zip"), "mac channel file must describe the zip artifact");
  } else {
    assert(fileName.endsWith(".exe"), "win channel file must describe the exe installer");
  }

  const channelPath = path.join(outDir, channelName);
  writeChannelFile({ channelPath, version, fileName, sha512, size });
  console.log(
    `write-desktop-updater-metadata: wrote ${channelPath} (${fileName}, ${size} bytes)`,
  );
}

try {
  main();
} catch (err) {
  console.error(
    "write-desktop-updater-metadata: fail -",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
