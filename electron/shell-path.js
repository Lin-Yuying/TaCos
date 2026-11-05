const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const MARK = "__TACOS_SHELL_ENV__";
const TIMEOUT_MS = 8000;

// The PATH line of `env` printed between two marks; a shell's start files may print around it.
function pathFromOutput(output) {
  const parts = output.split(MARK);
  if (parts.length < 3) return null;
  const line = parts[1].split(/\r?\n/).find((text) => text.startsWith("PATH="));
  return line ? line.slice("PATH=".length) : null;
}

function mergePaths(first, second) {
  const dirs = [...first.split(path.delimiter), ...second.split(path.delimiter)].filter(Boolean);
  return [...new Set(dirs)].join(path.delimiter);
}

function readShellPath(shell) {
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ["-ilc", `printf '${MARK}'; /usr/bin/env; printf '${MARK}'; exit`],
      { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout) => {
        if (error && !stdout.includes(MARK)) reject(error);
        else resolve(pathFromOutput(stdout));
      }
    );
  });
}

// An app opened from Finder or a desktop menu does not read the user's shell start files, so
// an Agent CLI installed through nvm is not on its PATH, and neither is the node that CLI needs.
// Only PATH is taken: the rest of the shell's environment may hold keys.
async function adoptShellPath({ log }) {
  if (process.platform === "win32") return;
  const shell = os.userInfo().shell || process.env.SHELL || "/bin/zsh";
  try {
    const found = await readShellPath(shell);
    if (found) process.env.PATH = mergePaths(found, process.env.PATH || "");
    else log(`shell PATH: ${shell} printed none`);
  } catch (error) {
    log(`shell PATH: ${error instanceof Error ? error.message : String(error)}`);
  }
}

module.exports = { adoptShellPath, mergePaths, pathFromOutput };
