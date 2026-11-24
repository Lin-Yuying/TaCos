import { readdirSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";

function findFiles(dir, predicate) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(entry.parentPath || dir, entry.name));
}

function environmentFile(name) {
  return /^\.env(?:\.|$)/.test(name);
}

function databaseFile(name) {
  return /\.db(?:-wal|-shm)?$/i.test(name);
}

export function sanitizeServerPayload(outDir) {
  rmSync(path.join(outDir, "data"), { recursive: true, force: true });
  for (const file of findFiles(outDir, environmentFile)) unlinkSync(file);
  const leaked = findFiles(outDir, (name) => environmentFile(name) || databaseFile(name));
  if (leaked.length > 0) {
    throw new Error(`refusing to ship a database or environment file: ${leaked.join(", ")}`);
  }
}
