import type { TurnEvent } from "./types";

/** A finished thinking block as a step: the first line names it, the whole text opens below. */
export function thinkingStep(id: string, text: string): Extract<TurnEvent, { type: "step" }> | null {
  const body = text.trim();
  if (!body) return null;
  const title = body.split("\n")[0].replace(/\*\*/g, "").slice(0, 200);
  return { type: "step", id, kind: "thinking", title, detail: body, status: "done" };
}
