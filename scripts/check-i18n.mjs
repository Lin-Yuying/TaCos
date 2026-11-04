#!/usr/bin/env node
// Lists UI strings passed to t("...") that have no entry in src/lib/i18n/zh.ts, and
// dictionary entries no code uses any more. Exits 1 when a translation is missing.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const dictFile = path.join(root, "src/lib/i18n/zh.ts");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(entry.name) && full !== dictFile)
      out.push(full);
  }
  return out;
}

// A JS string literal in double or single quotes, and the value it spells.
const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'`;
const unquote = (literal) =>
  literal.startsWith("'")
    ? JSON.parse(
        `"${literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`,
      )
    : JSON.parse(literal);

const dict = new Set();
for (const match of fs
  .readFileSync(dictFile, "utf8")
  .matchAll(new RegExp(`^\\s*(${STRING}|\\w+):`, "gm"))) {
  dict.add(/^\w+$/.test(match[1]) ? match[1] : unquote(match[1]));
}

const used = new Map();
// Every string literal in the code. Labels in constant objects, server and helper errors
// and the like reach t() through a variable (t(meta.label), t(result.error)); their
// entries count as used as long as the English text is still in the code somewhere.
const literals = new Set();
for (const file of walk(path.join(root, "src"))) {
  const src = fs.readFileSync(file, "utf8");
  // t("literal"), and each branch of t(cond ? "a" : "b"), where cond may compare
  // against a literal (mode === "work").
  for (const match of src.matchAll(
    new RegExp(
      `\\bt\\(\\s*(?:(?:[^()"',?]|${STRING})+\\?\\s*)?(${STRING})(?:\\s*:\\s*(${STRING}))?`,
      "g",
    ),
  )) {
    for (const literal of [match[1], match[2]].filter(Boolean)) {
      const key = unquote(literal);
      if (!used.has(key)) used.set(key, path.relative(root, file));
    }
  }
  for (const match of src.matchAll(new RegExp(STRING, "g"))) {
    try {
      literals.add(unquote(match[0]));
    } catch {
      // a quote inside a regex or a template literal, not a string
    }
  }
}

const missing = [...used].filter(([key]) => !dict.has(key));
const unused = [...dict].filter((key) => !used.has(key) && !literals.has(key));
for (const [key, file] of missing)
  console.log(`missing  ${file}: ${JSON.stringify(key)}`);
for (const key of unused) console.log(`unused   ${JSON.stringify(key)}`);
console.log(
  `${used.size} strings in code, ${dict.size} in zh.ts, ${missing.length} missing, ${unused.length} unused`,
);
process.exit(missing.length > 0 ? 1 : 0);
