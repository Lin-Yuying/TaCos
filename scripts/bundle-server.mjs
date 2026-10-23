// Assembles the Next standalone server into a self-contained folder the desktop app can
// ship inside its bundle: payload/server.js runs Tacos with no Node install on the target
// machine.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const nextDir = path.join(root, ".next");
const standaloneDir = path.join(nextDir, "standalone");
// The payload sits one level below the folder electron-builder copies: that tool drops a
// directory named node_modules when it is the root of the copy, and the server needs its
// own node_modules to run.
const payloadDir = path.join(root, "dist", "server", "payload");
const outDir = payloadDir;

if (!existsSync(path.join(standaloneDir, "server.js"))) {
  console.error(
    "[bundle-server] .next/standalone/server.js is missing — run `npm run build` first."
  );
  process.exit(1);
}

function findFiles(dir, predicate) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(entry.parentPath || dir, entry.name));
}

function argValue(name) {
  const hit = process.argv.find((it) => it.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

// The npm tarball for better-sqlite3 carries a prebuild for every supported platform, so
// a Windows payload can be assembled on a Mac without a compiler or a Windows host.
function installPrebuild(bindingDir, target) {
  const version = JSON.parse(
    readFileSync(path.join(bindingDir, "package.json"), "utf8")
  ).version;
  const cache = path.join(root, "vendor", "better-sqlite3", version);
  const cached = path.join(cache, "package", "prebuilds", `${target}.node`);
  if (!existsSync(cached)) {
    mkdirSync(cache, { recursive: true });
    const tarball = path.join(cache, `better-sqlite3-${version}.tgz`);
    execFileSync("npm", ["pack", `better-sqlite3@${version}`, "--pack-destination", cache], {
      stdio: "ignore",
    });
    execFileSync("tar", ["-xzf", tarball, "-C", cache, "package/prebuilds"]);
  }
  mkdirSync(path.join(bindingDir, "prebuilds"), { recursive: true });
  copyFileSync(cached, path.join(bindingDir, "prebuilds", `${target}.node`));
  console.log(`[bundle-server] added ${target} binding from better-sqlite3@${version}`);
}

rmSync(path.join(root, "dist", "server"), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Next links serverExternalPackages into .next/node_modules with an absolute path into the
// build machine. Replace every symlink with a real copy so the bundle is self-contained.
function dereference(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = realpathSync(full);
      rmSync(full);
      cpSync(target, full, { recursive: true });
      dereference(full);
    } else if (entry.isDirectory()) {
      dereference(full);
    }
  }
}

// Standalone traces the server files but not the client assets or static public files.
cpSync(standaloneDir, outDir, { recursive: true });
dereference(outDir);
cpSync(path.join(nextDir, "static"), path.join(outDir, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  cpSync(path.join(root, "public"), path.join(outDir, "public"), { recursive: true });
}

// File tracing can still pick up the checkout's live database. A shipped copy would hand
// the installer someone else's accounts, so drop it and refuse to finish if any survives.
rmSync(path.join(outDir, "data"), { recursive: true, force: true });
const leaked = findFiles(outDir, (name) => name.endsWith(".db") || name.endsWith(".db-wal"));
if (leaked.length > 0) {
  console.error(`[bundle-server] refusing to ship a database: ${leaked.join(", ")}`);
  process.exit(1);
}

// better-sqlite3 stays external (next.config serverExternalPackages), so make sure the
// native binding for the *target* platform is in the traced node_modules. The npm tarball
// ships every platform's prebuild, so a Windows installer can be built from a Mac.
const target = argValue("--target") || `${process.platform}-${process.arch}`;
if (!/^[a-z0-9]+-(x64|arm64)$/.test(target)) {
  console.error(`[bundle-server] bad --target "${target}" (expected platform-arch).`);
  process.exit(1);
}
// The server requires the hashed alias under .next/node_modules, so both copies need the
// binding for the target platform.
const tracedModules = path.join(outDir, ".next", "node_modules");
const bindings = [
  path.join(outDir, "node_modules", "better-sqlite3"),
  ...(existsSync(tracedModules)
    ? readdirSync(tracedModules, { withFileTypes: true })
        .filter((entry) => entry.name.startsWith("better-sqlite3"))
        .map((entry) => path.join(tracedModules, entry.name))
    : []),
];
for (const binding of bindings) {
  if (!existsSync(path.join(binding, "package.json"))) continue;
  const prebuilds = path.join(binding, "prebuilds");
  mkdirSync(prebuilds, { recursive: true });
  if (!existsSync(path.join(prebuilds, `${target}.node`))) {
    installPrebuild(binding, target);
  }
  for (const file of readdirSync(prebuilds)) {
    if (file !== `${target}.node`) rmSync(path.join(prebuilds, file));
  }
  if (!existsSync(path.join(prebuilds, `${target}.node`))) {
    console.error(`[bundle-server] no ${target} binding for ${binding}.`);
    process.exit(1);
  }
}

const bytes = readdirSync(outDir, { recursive: true })
  .map(String)
  .reduce((total, rel) => {
    const full = path.join(outDir, rel);
    try {
      return statSync(full).isFile() ? total + statSync(full).size : total;
    } catch {
      return total;
    }
  }, 0);

console.log(
  `[bundle-server] ${path.relative(root, outDir)} ready for ${target} — ${(bytes / 1024 / 1024).toFixed(1)} MB`
);
