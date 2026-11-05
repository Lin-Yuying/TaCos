import type { AgentStepEvent } from "@/lib/cli-agents";
import {
  appendAgentStep,
  finishAgentStep,
  removeAgentMessage,
  updateAgentMessage,
} from "@/lib/agent-threads";

type StepFrame = {
  type: "step";
  step: { key: string; kind: AgentStepEvent["kind"]; title: string; detail?: string; status: AgentStepEvent["status"] };
};

type TacosFrame =
  | StepFrame
  | { type: "approval"; request: unknown }
  | { type: "approval_done"; requestId: string; decision: string };

// The turn is already part of TaCos by the time the bytes reach the browser: this tap
// keeps the assistant text and every tool/command step in the database, so a reopened
// conversation shows the same trajectory that scrolled past live.
export function recordTurn(
  upstream: ReadableStream<Uint8Array>,
  turn: { threadId: string; messageId: string; onEnd?: () => void }
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  const stepIds = new Map<string, string>();
  let buffer = "";
  let text = "";
  let queue: Promise<unknown> = Promise.resolve();
  let settled = false;

  const recordStep = async (step: StepFrame["step"]) => {
    // A step's codex item id is stable across started/completed, but not every item has
    // one; falling back to kind+title still keeps running and done on the same row.
    const key = step.key || `${step.kind}|${step.title}`;
    const known = stepIds.get(key);
    if (known) {
      await finishAgentStep(known, step.status, step.detail ?? undefined);
      return;
    }
    const id = await appendAgentStep({
      threadId: turn.threadId,
      messageId: turn.messageId,
      kind: step.kind,
      title: step.title,
      detail: step.detail ?? null,
      status: step.status,
    });
    stepIds.set(key, id);
  };

  const consume = (block: string) => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let frame: { choices?: { delta?: { content?: unknown } }[]; tacos?: TacosFrame };
      try {
        frame = JSON.parse(payload) as typeof frame;
      } catch {
        continue;
      }
      if (frame.tacos?.type === "step") {
        const step = frame.tacos.step;
        queue = queue.then(() => recordStep(step)).catch(() => {});
      }
      const delta = frame.choices?.[0]?.delta?.content;
      if (typeof delta === "string") text += delta;
    }
  };

  const settle = async () => {
    if (settled) return;
    settled = true;
    await queue;
    await (text.trim() ? updateAgentMessage(turn.messageId, text) : removeAgentMessage(turn.messageId));
    turn.onEnd?.();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.trim()) consume(buffer);
        await settle();
        controller.close();
        return;
      }
      controller.enqueue(value);
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        /* the upstream already ended */
      }
      await settle();
    },
  });
}
