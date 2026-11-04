/**
 * H-P5-27 E2E: harness errors are user-visible and name a log path.
 * Live: a fake harness turn fails; the error event names a real log file
 * that holds stderr and the event trail.
 * Run: npx tsx scripts/check-errors-log-paths.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TurnEvent, TurnInput } from "../src/lib/harness/types";
import { harnessLogDir, loggedTurn } from "../src/lib/harness/turn-log";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const root = process.cwd();

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-logs-"));
  process.env.TACOS_LOG_DIR = dir;
  assert(harnessLogDir() === path.join(dir, "harness"), "TACOS_LOG_DIR must set the log dir");

  const input = { sessionId: "e2e-h-p5-27", cwd: dir } as unknown as TurnInput;
  const events: TurnEvent[] = [];
  for await (const event of loggedTurn("dsh", input, async function* (log) {
    log.write("fake stderr: boom\n");
    yield { type: "delta", text: "hi" } as TurnEvent;
    yield { type: "error", message: "DeepSeek Harness exited with code 1." } as TurnEvent;
    yield { type: "done" } as TurnEvent;
  })) {
    events.push(event);
  }
  const error = events.find((e) => e.type === "error") as { message: string } | undefined;
  assert(error, "error event must reach the user");
  const match = /Log: (\S+\.log)/.exec(error!.message);
  assert(match, `error must name a log path: ${error!.message}`);
  const file = match![1];
  assert(file.startsWith(path.join(dir, "harness")), "log is under the harness log dir");
  const text = fs.readFileSync(file, "utf8");
  assert(text.includes("fake stderr: boom"), "log holds stderr");
  assert(text.includes('"type":"error"'), "log holds the event trail");

  // Every adapter tees stderr and goes through loggedTurn.
  for (const id of ["codex", "pi", "opencode", "codebuddy", "dsh"]) {
    const adapter = fs.readFileSync(path.join(root, `src/lib/harness/adapters/${id}.ts`), "utf8");
    assert(adapter.includes("loggedTurn("), `${id} adapter must use loggedTurn`);
    const turn = fs.readFileSync(path.join(root, `src/lib/harness/adapters/${id}-turn.ts`), "utf8");
    assert(turn.includes("log?.write(chunk)"), `${id}-turn must tee stderr to the log`);
  }
  console.log(`check-errors-log-paths: pass (log=${file})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `Error: ${err.message}` : err);
  process.exit(1);
});
