/**
 * Where one Agent turn spent its time, one JSON line per turn in <log dir>/harness/timing.jsonl.
 * Holds numbers and tool names only, never prompts or results. The road from the server to the
 * page is not here, because the computer running the turn cannot see it.
 */
import fs from "node:fs";
import path from "node:path";
import { harnessLogDir } from "./turn-log";
import type { TurnEvent } from "./types";

export type ToolTiming = { tool: string; ms: number; approvalMs: number; bytes: number };

export type TurnTiming = {
  totalMs: number;
  firstTextMs: number | null;
  doneMs: number | null;
  steps: number;
  tools: { calls: number; ms: number; maxMs: number; bytes: number; listMs: number };
  approvalWaitMs: number;
  // Harness and model together: the time to `done` less tool requests and waiting for a person.
  modelMs: number | null;
  upload: { batches: number; ms: number; maxMs: number; bytes: number; retries: number; afterDoneMs: number | null };
};

export type TurnTimer = ReturnType<typeof turnTimer>;

export function turnTimer(now: () => number = Date.now) {
  const startedAt = now();
  let firstText: number | null = null;
  let done: number | null = null;
  let steps = 0;
  const upload = { batches: 0, ms: 0, maxMs: 0, bytes: 0, retries: 0 };
  const seenSteps = new Set<string>();
  return {
    event(event: TurnEvent) {
      if (event.type === "delta" && firstText === null) firstText = now();
      if (event.type === "step" && !seenSteps.has(event.id)) {
        seenSteps.add(event.id);
        steps += 1;
      }
      if ((event.type === "done" || event.type === "error") && done === null) done = now();
    },
    upload(ms: number, bytes: number) {
      upload.batches += 1;
      upload.ms += ms;
      upload.maxMs = Math.max(upload.maxMs, ms);
      upload.bytes += bytes;
    },
    uploadRetry() {
      upload.retries += 1;
    },
    summary(toolLines: ToolTiming[]): TurnTiming {
      const end = now();
      const calls = toolLines.filter((line) => line.tool !== "tools/list");
      const toolMs = calls.reduce((sum, line) => sum + line.ms, 0);
      const listMs = toolLines.filter((line) => line.tool === "tools/list").reduce((sum, line) => sum + line.ms, 0);
      const approvalWaitMs = toolLines.reduce((sum, line) => sum + line.approvalMs, 0);
      const doneMs = done === null ? null : done - startedAt;
      return {
        totalMs: end - startedAt,
        firstTextMs: firstText === null ? null : firstText - startedAt,
        doneMs,
        steps,
        tools: {
          calls: calls.length,
          ms: toolMs,
          maxMs: calls.reduce((max, line) => Math.max(max, line.ms), 0),
          bytes: calls.reduce((sum, line) => sum + line.bytes, 0),
          listMs,
        },
        approvalWaitMs,
        modelMs: doneMs === null ? null : Math.max(0, doneMs - toolMs - listMs - approvalWaitMs),
        upload: { ...upload, afterDoneMs: done === null ? null : end - done },
      };
    },
  };
}

export function readToolTimings(file: string): ToolTiming[] {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines: ToolTiming[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line) as ToolTiming);
    } catch {
      /* a half-written line from a shim that was killed */
    }
  }
  return lines;
}

/** Sums up the turn, adds it to the timing log and removes the shim's file. Never throws. */
export function writeTurnTiming(
  runId: string,
  kind: string,
  harness: string,
  timer: TurnTimer,
  toolFile: string
): TurnTiming {
  const timing = timer.summary(readToolTimings(toolFile));
  try {
    fs.rmSync(toolFile, { force: true });
    const dir = harnessLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const row = { at: new Date().toISOString(), runId, kind, harness, ...timing };
    fs.appendFileSync(path.join(dir, "timing.jsonl"), `${JSON.stringify(row)}\n`);
  } catch {
    /* timing never gets in the way of a turn */
  }
  return timing;
}
