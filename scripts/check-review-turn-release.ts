/**
 * Review finding 3 (team-2.3): the shared-chat lock and the per-turn MCP grant are
 * released from onEnd, so recordTurn must settle on every exit path. A failed DB
 * write or an upstream error must never leave them held.
 *   node --import tsx scripts/check-review-turn-release.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-review-turn-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const encoder = new TextEncoder();

const threadId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

async function main() {
  // Fresh process: getDb() runs the DDL/bootstrap first, so updateAgentMessage /
  // removeAgentMessage have their tables by the time recordTurn settles.
  const { getDb } = await import("../src/db/client");
  getDb();
  const { recordTurn } = await import("../src/lib/agent-turn-record");

  // 1. The upstream read() rejects: the failure must still reach settle()/onEnd.
  {
    let ended = 0;
    const onEnd = () => { ended += 1; };
    const upstream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("upstream exploded");
      },
    });
    const recorded = recordTurn(upstream, { threadId, messageId, onEnd });
    let caught: unknown;
    try {
      await drain(recorded);
    } catch (err) {
      caught = err;
    }
    assert(caught instanceof Error && caught.message === "upstream exploded", "the upstream error reaches the consumer");
    assert(ended === 1, `upstream read() error: onEnd fired ${ended} times, expected 1`);
  }

  // 2a. Clean end, empty stream.
  {
    let ended = 0;
    const onEnd = () => { ended += 1; };
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    await drain(recordTurn(upstream, { threadId, messageId, onEnd }));
    assert(ended === 1, `empty stream: onEnd fired ${ended} times, expected 1`);
  }

  // 2b. Clean end with text and a [DONE] SSE frame.
  {
    let ended = 0;
    const onEnd = () => { ended += 1; };
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    await drain(recordTurn(upstream, { threadId, messageId, onEnd }));
    assert(ended === 1, `SSE stream with [DONE]: onEnd fired ${ended} times, expected 1`);
  }

  // 3. cancel() path: the upstream stays open with no chunks, so only cancel()
  //    can drive settle(). The idempotency flag keeps onEnd at exactly one call.
  {
    let ended = 0;
    let upstreamCancelled = false;
    const onEnd = () => { ended += 1; };
    const upstream = new ReadableStream<Uint8Array>({
      start(_controller) {
        // deliberately no chunk and no close
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    const recorded = recordTurn(upstream, { threadId, messageId, onEnd });
    const reader = recorded.getReader();
    await reader.cancel();
    assert(upstreamCancelled, "cancel() reaches the upstream reader");
    assert(ended === 1, `cancel(): onEnd fired ${ended} times, expected 1`);
  }

  console.log("check-review-turn-release: pass");
}

main().catch((err) => {
  console.error("check-review-turn-release: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
