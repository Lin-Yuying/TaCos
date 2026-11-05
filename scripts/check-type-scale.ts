// Every font size comes from the seven steps in globals.css, so a new screen cannot drift.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const STEPS = new Set(["11", "12.5", "14", "16", "18", "23", "29"]);
const bad: string[] = [];

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (/\.(tsx?|css|html)$/.test(name)) scan(file);
  }
}

function scan(file: string) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/text-\[[0-9.]+(px|rem)\]/g)) bad.push(`${file}: ${match[0]}`);
  for (const match of text.matchAll(/font-size:\s*([0-9.]+)px/g)) {
    if (!STEPS.has(match[1])) bad.push(`${file}: ${match[0]}`);
  }
}

walk("src");
walk("electron");
if (bad.length > 0) {
  console.error(`check-type-scale: sizes outside the scale\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("check-type-scale: ok");
