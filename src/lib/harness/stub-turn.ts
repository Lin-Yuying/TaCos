import type { TurnEvent, TurnInput } from "./types";

/** Placeholder openTurn until a later backlog id wires the real CLI stream. */
export async function* notImplementedTurn(id: string, _input: TurnInput): AsyncIterable<TurnEvent> {
  yield {
    type: "error",
    message: `Harness "${id}" turn stream is not wired yet.`,
  };
  yield { type: "done" };
}
