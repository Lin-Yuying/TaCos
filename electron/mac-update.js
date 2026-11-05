const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// The Mac build has no Developer ID, and the system's updater refuses to install an app
// without one. So on the Mac TaCos fetches the release's own zip and swaps its bundle:
// the file has to match the hash the release lists, and the app inside has to be TaCos at
// the version offered, with an intact signature, before anything is replaced.

const RELEASE_BASE = "https://github.com/Lin-Yuying/TaCos/releases/download";
const APP_ID = "app.tacos.desktop";
const STALL_MS = 60_000;

// Waits for this process to end, puts the new bundle in place, restores the old one if
// that fails, and opens whichever one is there. If this process never ends, nothing changes.
const SWAP_SCRIPT = `
pid=$1 new=$2 target=$3 pending=$4
shift 4
tries=0
while kill -0 "$pid" 2>/dev/null; do
  tries=$((tries + 1))
  [ "$tries" -gt 240 ] && exit 1
  sleep 0.25
done
old="$target.updating-old"
rm -rf "$old"
if ! mv "$target" "$old"; then
  open -n "$target" --args "$@"
  exit 1
fi
if mv "$new" "$target"; then
  rm -rf "$old" "$pending"
else
  rm -rf "$target"
  mv "$old" "$target"
fi
xattr -dr com.apple.quarantine "$target" 2>/dev/null
open -n "$target" --args "$@"
`;

function bundleOf(exePath) {
  const at = exePath.indexOf(".app/");
  return at >= 0 ? exePath.slice(0, at + 4) : null;
}

// Running from the disk image, or from where macOS isolates a downloaded app, there is
// nothing lasting to replace. Neither can a person without write access replace it.
function canReplace(bundle) {
  if (!bundle || bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/")) return false;
  try {
    fs.accessSync(bundle, fs.constants.W_OK);
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function zipFor(files, arch) {
  return (files || []).find((file) => {
    const name = String(file.url || "");
    return name.endsWith(".zip") && /arm64/.test(name) === (arch === "arm64");
  });
}

async function sha512Of(file) {
  const hash = crypto.createHash("sha512");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("base64");
}

async function fetchZip({ net, url, dest, total, onProgress }) {
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(), STALL_MS);
  try {
    const response = await net.fetch(url, { signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
    let got = 0;
    const counted = Readable.fromWeb(response.body);
    counted.on("data", (chunk) => {
      got += chunk.length;
      clearTimeout(stall);
      stall = setTimeout(() => abort.abort(), STALL_MS);
      if (total) onProgress(Math.min(100, (got / total) * 100));
    });
    await pipeline(counted, fs.createWriteStream(dest));
  } finally {
    clearTimeout(stall);
  }
}

function plistValue(appPath, key) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appPath, "Contents/Info.plist")], {
    encoding: "utf8",
  }).trim();
}

/** Downloads and checks version `info.version`. Returns where the checked app and its folder are. */
async function prepare({ net, userData, info, arch, log, onProgress }) {
  const file = zipFor(info.files, arch);
  if (!file || !file.sha512) throw new Error(`The release has no zip for ${arch}`);
  const pending = path.join(userData, "pending-update");
  const dir = path.join(pending, info.version);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(pending)) {
    if (name !== info.version) fs.rmSync(path.join(pending, name), { recursive: true, force: true });
  }

  const zip = path.join(dir, path.basename(file.url));
  const have = fs.existsSync(zip) && (await sha512Of(zip)) === file.sha512;
  if (!have) {
    const url = `${RELEASE_BASE}/v${info.version}/${file.url}`;
    log(`app update fetch ${url}`);
    await fetchZip({ net, url, dest: zip, total: file.size, onProgress });
    if ((await sha512Of(zip)) !== file.sha512) {
      fs.rmSync(zip, { force: true });
      throw new Error("The downloaded file does not match the hash the release lists");
    }
  }

  const unpacked = path.join(dir, "unpacked");
  fs.rmSync(unpacked, { recursive: true, force: true });
  fs.mkdirSync(unpacked);
  execFileSync("/usr/bin/ditto", ["-xk", zip, unpacked]);
  const name = fs.readdirSync(unpacked).find((entry) => entry.endsWith(".app"));
  if (!name) throw new Error("The downloaded zip holds no app");
  const appPath = path.join(unpacked, name);
  const id = plistValue(appPath, "CFBundleIdentifier");
  const version = plistValue(appPath, "CFBundleShortVersionString");
  if (id !== APP_ID || version !== info.version) {
    throw new Error(`The downloaded app is ${id} ${version}, not ${APP_ID} ${info.version}`);
  }
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });
  log(`app update ${info.version} checked and ready`);
  return { appPath, dir };
}

/** Starts the swap. The caller then quits; the swap waits for that. */
function startSwap({ appPath, dir, target, args }) {
  const child = spawn("/bin/sh", ["-c", SWAP_SCRIPT, "sh", String(process.pid), appPath, target, dir, ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

module.exports = { bundleOf, canReplace, zipFor, prepare, startSwap, SWAP_SCRIPT };
