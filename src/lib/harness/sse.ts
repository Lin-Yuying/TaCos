import type { ApprovalDecision, TurnEvent } from "./types";

const ENCODER = new TextEncoder();

function browserDecision(decision: ApprovalDecision): "accept" | "decline" | "accept-turn" {
  if (decision === "allow") return "accept";
  if (decision === "allow_turn") return "accept-turn";
  return "decline";
}

/** Map harness TurnEvent values to the Agent SSE frames the browser already reads. */
export function turnEventsToSse(events: AsyncIterable<TurnEvent>): ReadableStream<Uint8Array> {
  let stopped = false;
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (stopped || closed) return;
        try {
          controller.enqueue(ENCODER.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const delta = (text: string) => {
        write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      };
      const frame = (payload: Record<string, unknown>) => {
        write(`data: ${JSON.stringify({ tacos: payload })}\n\n`);
      };
      const error = (message: string) => {
        write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
        close();
      };
      const done = () => {
        write("data: [DONE]\n\n");
        close();
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        for await (const event of events) {
          if (stopped || closed) break;
          if (event.type === "delta") {
            delta(event.text);
          } else if (event.type === "step") {
            frame({
              type: "step",
              step: {
                key: event.id,
                kind: event.kind ?? "info",
                title: event.title,
                detail: event.detail,
                status: event.status,
              },
            });
          } else if (event.type === "approval") {
            frame({
              type: "approval",
              request: {
                requestId: event.requestId,
                tool: event.tool,
                message: event.message,
                description: event.description ?? null,
                params:
                  event.params === undefined || event.params === null
                    ? null
                    : typeof event.params === "string"
                      ? event.params
                      : JSON.stringify(event.params, null, 2),
              },
            });
          } else if (event.type === "approval_done") {
            frame({
              type: "approval_done",
              requestId: event.requestId,
              decision: browserDecision(event.decision),
            });
          } else if (event.type === "error") {
            error(event.message);
            return;
          } else if (event.type === "done") {
            done();
            return;
          }
        }
        if (!closed) done();
      } catch (err) {
        if (!closed) {
          error(err instanceof Error ? err.message : "The harness turn failed.");
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });
}
