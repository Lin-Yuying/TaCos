/**
 * The Mac's own update path: picks the right zip, refuses what it cannot replace, and the
 * swap restores the old app when the new one cannot go in.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mac = require("../electron/mac-update.js") as {
  bundleOf: (exe: string) => string | null;
  canReplace: (bundle: string | null) => boolean;
  zipFor: (files: { url: string }[], arch: string) => { url: string } | undefined;
  SWAP_SCRIPT: string;
};

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const files = [
  { url: "TaCos-9.0.0-arm64-mac.zip" },
  { url: "TaCos-9.0.0-mac.zip" },
  { url: "TaCos-Local-9.0.0-arm64.dmg" },
];
assert(mac.zipFor(files, "arm64")?.url === "TaCos-9.0.0-arm64-mac.zip", "arm64 must take the arm64 zip");
assert(mac.zipFor(files, "x64")?.url === "TaCos-9.0.0-mac.zip", "x64 must not take the arm64 zip");
assert(!mac.zipFor(files.slice(0, 1), "x64"), "no zip for this machine must be reported as none");
assert(mac.bundleOf("/Applications/TaCos.app/Contents/MacOS/TaCos") === "/Applications/TaCos.app", "bundle path");

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tacos-swap-"));
try {
  assert(!mac.canReplace(null), "no bundle cannot be replaced");
  assert(!mac.canReplace("/Volumes/TaCos/TaCos.app"), "the disk image cannot be replaced");
  assert(!mac.canReplace(`${root}/AppTranslocation/x/TaCos.app`), "a translocated app cannot be replaced");

  // `open` is a stand-in, so this check launches nothing.
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$*" >> "${root}/opened"\n`, { mode: 0o755 });
  const swap = (name: string, withNew: boolean) => {
    const target = path.join(root, `${name}.app`);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "which"), "old");
    const pending = path.join(root, `${name}-pending`);
    const next = path.join(pending, "new.app");
    fs.mkdirSync(pending);
    if (withNew) {
      fs.mkdirSync(next);
      fs.writeFileSync(path.join(next, "which"), "new");
    }
    // A pid that is already gone stands for the app having quit.
    const child = execFileSync(
      "/bin/sh",
      ["-c", "/bin/sh -c 'exit 0' & wait $!; echo $!"],
      { encoding: "utf8" },
    ).trim();
    execFileSync("/bin/sh", ["-c", mac.SWAP_SCRIPT, "sh", child, next, target, pending, "--flag"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: "pipe",
    });
    return { target, pending };
  };

  const good = swap("good", true);
  assert(fs.readFileSync(path.join(good.target, "which"), "utf8") === "new", "the new app must be in place");
  assert(!fs.existsSync(`${good.target}.updating-old`), "the old app must be gone");
  assert(!fs.existsSync(good.pending), "the download folder must be gone");

  const bad = swap("bad", false);
  assert(fs.readFileSync(path.join(bad.target, "which"), "utf8") === "old", "a failed swap must restore the old app");
  assert(!fs.existsSync(`${bad.target}.updating-old`), "a failed swap must leave no second copy");

  const opened = fs.readFileSync(path.join(root, "opened"), "utf8").trim().split("\n");
  assert(opened.length === 2 && opened.every((line) => line.endsWith("--args --flag")), "both must reopen with the same arguments");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("check-desktop-self-update: pass");
