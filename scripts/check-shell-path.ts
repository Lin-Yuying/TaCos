// An app opened from Finder has no nvm on its PATH. The desktop shell takes PATH, and nothing
// else, from the user's shell, and a start file that prints or hangs does not break it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-shell-path-"));
const probe = path.join(dir, "probe.cjs");
fs.writeFileSync(
  probe,
  `const { adoptShellPath } = require(${JSON.stringify(path.resolve("electron/shell-path.js"))});
   const logs = [];
   adoptShellPath({ log: (l) => logs.push(l) }).then(() => {
     console.log(JSON.stringify({ path: process.env.PATH, logs, secret: process.env.SHELL_SECRET ?? null }));
   });`
);
const home = path.join(dir, "home");
fs.mkdirSync(home);
const bin = path.join(home, "tool-bin");
fs.writeFileSync(
  path.join(home, ".zshrc"),
  `echo noise from start file\nexport SHELL_SECRET=abc\nexport PATH="${bin}:$PATH"\n`
);

if (process.platform !== "win32") {
  const zsh = "/bin/zsh";
  if (fs.existsSync(zsh) && os.userInfo().shell?.endsWith("zsh")) {
    const output = execFileSync(process.execPath, [probe], {
      encoding: "utf8",
      env: { HOME: home, ZDOTDIR: home, PATH: "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
    });
    const result = JSON.parse(output.trim().split("\n").at(-1)!);
    assert.ok(result.path.split(":").includes(bin), `shell PATH missing: ${result.path}`);
    assert.ok(result.path.split(":").includes("/usr/bin"), "the old PATH stays");
    assert.equal(result.secret, null, "only PATH is taken from the shell");
    assert.deepEqual(result.logs, []);
  }
}

const { mergePaths, pathFromOutput } = createRequire(import.meta.url)("../electron/shell-path.js");
assert.equal(pathFromOutput("noise__TACOS_SHELL_ENV__A=1\nPATH=/a:/b\nZ=2\n__TACOS_SHELL_ENV__"), "/a:/b");
assert.equal(pathFromOutput("no marks"), null);
assert.equal(mergePaths("/a:/b", "/b:/c"), "/a:/b:/c");

fs.rmSync(dir, { recursive: true, force: true });
console.log("check-shell-path: pass");
