/**
 * H-P5-27: per-turn harness logs.
 * Each Agent turn writes harness stderr and the TaCos event trail to one file.
 * Error events that reach the user name that file, so the person can open it.
 * Default dir: ~/.tacos/logs/harness. Set TACOS_LOG_DIR to change the root.
 */
import { createLogStream } from "../../../electron/log-stream.mjs";
import os from "node:os";
import path from "node:path";
import type { HarnessId, TurnEvent, TurnInput } from "./types";

export type TurnLog = {
  path: string;
  write(chunk: string): Promise<void>;
  close(): Promise<void>;
};

export function harnessLogDir(): string {
  const root = process.env.TACOS_LOG_DIR?.trim() || path.join(os.homedir(), ".tacos", "logs");
  return path.join(root, "harness");
}

function safe(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 48) || "turn";
}

export function openTurnLog(harness: HarnessId, sessionId: string): TurnLog {
  const dir = harnessLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${harness}-${safe(sessionId)}-${stamp}.log`);
  const stream=createLogStream(file);
  let failed=false;
  stream.on("error",error=>{failed=true;console.error("Could not write harness log:",error.message);});
  const write=(chunk:string)=>new Promise<void>(resolve=>{if(failed||stream.writableEnded||stream.destroyed)return resolve();stream.write(chunk,()=>resolve());});
  void write(`# TaCos ${harness} turn ${sessionId} ${new Date().toISOString()}\n`);
  return {path:file,write,close(){return new Promise<void>(resolve=>{if(failed||stream.closed)return resolve();stream.end(resolve);stream.once("error",()=>resolve());});}};

}

export function withLogPath(message: string, logPath: string): string {
  return message.includes(logPath) ? message : `${message} Log: ${logPath}`;
}

/** Wrap a harness turn: log stderr + events; add the log path to user-visible errors. */
export async function* loggedTurn(
  harness: HarnessId,
  input: TurnInput,
  run: (log: TurnLog) => AsyncIterable<TurnEvent>
): AsyncGenerator<TurnEvent> {
  const log = openTurnLog(harness, input.sessionId);
  try {
    for await (const event of run(log)) {
      if (event.type !== "delta") await log.write(`[event] ${JSON.stringify(event)}\n`);
      if (event.type === "error") {
        yield { ...event, message: withLogPath(event.message, log.path) };
        continue;
      }
      yield event;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.write(`[throw] ${message}\n`);
    yield { type: "error", message: withLogPath(`${harness} turn failed: ${message}`, log.path) };
    yield { type: "done" };
  } finally {await log.close();}
}
