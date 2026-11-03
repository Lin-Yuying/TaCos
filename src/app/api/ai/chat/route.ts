import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/db/client";
import { requireWorkspace } from "@/lib/auth";
import {
  agentContext,
  agentMessages,
  agentRuntime,
  editMessages,
  flattenMessages,
  openChatStream,
} from "@/lib/ai";
import { AGENT_HARNESS_IDS, AI_EDIT_ACTIONS, type AgentHarnessId, type AiChatAction, type AiEngine } from "@/lib/ai-constants";
import { AGENT_TOOLS } from "@/lib/agent-tools";
import {
  issueAgentToolGrant,
  revokeAgentToolGrant,
  waitForAgentApproval,
} from "@/lib/agent-sessions";
import {
  appendAgentMessage,
  appendAgentStep,
  finishAgentStep,
  loadThreadForTurn,
  removeAgentMessage,
  setThreadEngine,
  updateAgentMessage,
} from "@/lib/agent-threads";
import {
  codexDefaults,
  listCodexSkills,
  openCliStream,
  requireCli,
  skillsInText,
  type AgentStepEvent,
} from "@/lib/cli-agents";
import { getHarnessAdapter, turnEventsToSse } from "@/lib/harness";
import type { ApprovalDecision as HarnessApprovalDecision } from "@/lib/harness";
import { TacosError } from "@/lib/issues";

const EDIT_ACTIONS = new Set<string>([
  ...AI_EDIT_ACTIONS.map((action) => action.id),
  "continue",
  "custom",
  "agent",
]);

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// The stdio MCP shim that gives Agent turns their TaCos tools. It ships beside the server so
// a standalone build can spawn it without a checkout on disk.
function shimPath(): string {
  const candidates = [
    path.join(process.cwd(), "scripts", "agent-mcp.mjs"),
    path.join(process.cwd(), "agent-mcp.mjs"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new TacosError("The Agent tool bridge is missing from this build", 500);
  return found;
}

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
function recordTurn(
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

// Streams the provider's OpenAI-compatible SSE straight through, so the preview can
// render tokens as they arrive. The provider key never reaches the browser.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      workspaceId?: string;
      action?: string;
      engine?: string;
      threadId?: string;
      text?: string;
      instruction?: string;
      context?: string;
    };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!workspaceId) throw new TacosError("Workspace is required", 400);
    const access = await requireWorkspace(workspaceId);

    const action = (body.action ?? "") as AiChatAction;
    if (!EDIT_ACTIONS.has(action)) throw new TacosError("Unknown AI action", 400);
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : undefined;

    const runtime = await agentRuntime(workspaceId);
    const requested = typeof body.engine === "string" ? body.engine : "";
    const harnessRequested = (AGENT_HARNESS_IDS as readonly string[]).includes(requested);
    const engine: AiEngine | AgentHarnessId =
      requested === "api" || harnessRequested
        ? (requested as AiEngine | AgentHarnessId)
        : runtime.engine;

    if (engine !== "api") {
      if (!runtime.enabled) {
        throw new TacosError(
          "AI is turned off for this workspace",
          400,
          "An admin can enable it in Settings."
        );
      }
      // Local CLIs sign in under the OS account that runs this server.
      if (engine === "codex" || engine === "pi") {
        requireCli(engine);
      } else {
        const adapter = getHarnessAdapter(engine);
        const detect = adapter?.detect();
        if (!adapter || !detect?.ready) {
          throw new TacosError(
            `${adapter?.label ?? engine} is not ready on this server`,
            400,
            detect?.hint ?? "Install or enable the harness in Settings → Harness."
          );
        }
      }
    }

    if (action === "agent") {
      const threadId = typeof body.threadId === "string" ? body.threadId : "";
      if (!threadId) {
        throw new TacosError("Pick a project and open a conversation first", 400);
      }
      if (engine === "api") {
        throw new TacosError(
          "Agent turns need a local CLI harness",
          400,
          "Pick a harness in the composer. API keys stay under Settings for inline edits."
        );
      }
      // History comes from the thread, not from the browser: whatever scrolled past in
      // this conversation is what the model gets, including turns from other sessions.
      // Harness on the request is a turn pref. A mismatch updates last-used and keeps the session.
      const thread = await loadThreadForTurn(workspaceId, access.user.id, threadId);
      if (thread.engine !== engine) await setThreadEngine(threadId, engine);

      const message = text.trim();
      await appendAgentMessage({ threadId, role: "user", content: message });
      const assistantId = await appendAgentMessage({ threadId, role: "assistant", content: "" });

      const messages = agentMessages({
        message,
        history: thread.messages,
        context: await agentContext({
          workspaceId,
          userId: access.user.id,
          workspaceName: access.workspace.name,
          userName: access.user.displayName,
          // A conversation started with "Don't work in a project" gets the whole
          // workspace instead of one project's slice.
          ...(thread.projectId
            ? { project: { id: thread.projectId, name: thread.projectName, key: thread.projectKey } }
            : {}),
        }),
      });

      const turn = { threadId, messageId: assistantId };

      const grant = issueAgentToolGrant({
        threadId,
        workspaceId,
        projectId: thread.projectId,
        projectKey: thread.projectKey,
        userId: access.user.id,
        approval: thread.approval,
        autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
        neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
      });
      // Only Codex has skills; "@name" tokens are matched against the skills this machine
      // really has, so ordinary prose containing an @ sign is left alone.
      const skills =
        engine === "codex" && message.includes("@") ? skillsInText(message, await listCodexSkills()) : [];
      const origin = new URL(request.url).origin;
      const cwd = path.join(DATA_DIR, "agent", workspaceId, thread.projectId || "general");
      const prompt = flattenMessages(messages);
      const isTurnApproved = () =>
        Boolean(grant && (grant.autoApproveTurn || thread.approval !== "ask"));

      // Codex Agent turns go through the harness adapter (chat + MCP + elicitation keys).
      if (engine === "codex") {
        const defaults = codexDefaults();
        const adapter = getHarnessAdapter("codex");
        if (!adapter) {
          throw new TacosError("Codex harness is not registered", 500);
        }
        const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
          value === "accept" ? "allow" : "deny";
        const events = adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          model: thread.model || defaults.model || null,
          effort: thread.effort || defaults.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          ...(grant
            ? {
                mcp: {
                  command: process.execPath,
                  args: [shimPath()],
                  env: {
                    TACOS_AGENT_URL: origin,
                    TACOS_AGENT_TOKEN: grant.token,
                    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
                  },
                },
              }
            : { mcp: null }),
        });
        const stream = turnEventsToSse(events);
        return new Response(
          recordTurn(stream, { ...turn, onEnd: grant ? () => revokeAgentToolGrant(grant.token) : undefined }),
          { headers: STREAM_HEADERS }
        );
      }

      // Pi Agent turns go through the harness adapter (MCP + TaCos-mediated cards).
      if (engine === "pi") {
        const adapter = getHarnessAdapter("pi");
        if (!adapter) {
          throw new TacosError("Pi harness is not registered", 500);
        }
        const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
          value === "accept" ? "allow" : "deny";
        const events = adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          model: thread.model || null,
          effort: thread.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          ...(grant
            ? {
                mcp: {
                  command: process.execPath,
                  args: [shimPath()],
                  env: {
                    TACOS_AGENT_URL: origin,
                    TACOS_AGENT_TOKEN: grant.token,
                    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
                  },
                },
              }
            : { mcp: null }),
        });
        const stream = turnEventsToSse(events);
        return new Response(
          recordTurn(stream, { ...turn, onEnd: grant ? () => revokeAgentToolGrant(grant.token) : undefined }),
          { headers: STREAM_HEADERS }
        );
      }

      // OpenCode Agent turns go through the harness adapter (MCP + TaCos-mediated cards).
      if (engine === "opencode") {
        const adapter = getHarnessAdapter("opencode");
        if (!adapter) {
          throw new TacosError("OpenCode harness is not registered", 500);
        }
        const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
          value === "accept" ? "allow" : "deny";
        const events = adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          model: thread.model || null,
          effort: thread.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          ...(grant
            ? {
                mcp: {
                  command: process.execPath,
                  args: [shimPath()],
                  env: {
                    TACOS_AGENT_URL: origin,
                    TACOS_AGENT_TOKEN: grant.token,
                    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
                  },
                },
              }
            : { mcp: null }),
        });
        const stream = turnEventsToSse(events);
        return new Response(
          recordTurn(stream, { ...turn, onEnd: grant ? () => revokeAgentToolGrant(grant.token) : undefined }),
          { headers: STREAM_HEADERS }
        );
      }

      // WorkBuddy / codebuddy Agent turns (MCP + TaCos-mediated cards).
      if (engine === "codebuddy") {
        const adapter = getHarnessAdapter("codebuddy");
        if (!adapter) {
          throw new TacosError("WorkBuddy harness is not registered", 500);
        }
        const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
          value === "accept" ? "allow" : "deny";
        const events = adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          model: thread.model || null,
          effort: thread.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          ...(grant
            ? {
                mcp: {
                  command: process.execPath,
                  args: [shimPath()],
                  env: {
                    TACOS_AGENT_URL: origin,
                    TACOS_AGENT_TOKEN: grant.token,
                    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
                  },
                },
              }
            : { mcp: null }),
        });
        const stream = turnEventsToSse(events);
        return new Response(
          recordTurn(stream, { ...turn, onEnd: grant ? () => revokeAgentToolGrant(grant.token) : undefined }),
          { headers: STREAM_HEADERS }
        );
      }

      // DeepSeek Harness (dsh) Agent turns (MCP + TaCos-mediated cards).
      if (engine === "dsh") {
        const adapter = getHarnessAdapter("dsh");
        if (!adapter) {
          throw new TacosError("DeepSeek Harness is not registered", 500);
        }
        const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
          value === "accept" ? "allow" : "deny";
        const events = adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          model: thread.model || null,
          effort: thread.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          ...(grant
            ? {
                mcp: {
                  command: process.execPath,
                  args: [shimPath()],
                  env: {
                    TACOS_AGENT_URL: origin,
                    TACOS_AGENT_TOKEN: grant.token,
                    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
                  },
                },
              }
            : { mcp: null }),
        });
        const stream = turnEventsToSse(events);
        return new Response(
          recordTurn(stream, { ...turn, onEnd: grant ? () => revokeAgentToolGrant(grant.token) : undefined }),
          { headers: STREAM_HEADERS }
        );
      }

      throw new TacosError(
        `Agent turns for ${engine} are not wired yet`,
        400,
        "Pick a wired harness in the composer until the remaining adapters land."
      );
    }

    if (!text.trim() && action !== "continue" && action !== "custom") {
      throw new TacosError("Select some text first", 400);
    }
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (action === "custom" && !instruction) throw new TacosError("Describe what to change", 400);

    const messages = editMessages({
      action,
      text,
      instruction: instruction || undefined,
      context,
    });
    if (engine === "api") {
      const stream = await openChatStream(workspaceId, messages, request.signal);
      return new Response(stream, { headers: STREAM_HEADERS });
    }
    // The inline editor can borrow the Codex/Pi login: no tools, no thread, one prompt
    // out and the replacement text back.
    if (engine !== "codex" && engine !== "pi") {
      throw new TacosError(
        "Inline edits need Codex, Pi, or an API key",
        400,
        "Other harnesses are Agent-only for now."
      );
    }
    const stream = openCliStream(engine, flattenMessages(messages), {
      proxy: runtime.proxy,
      signal: request.signal,
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  } catch (err) {
    const status = err instanceof TacosError ? err.status : 500;
    const message = err instanceof Error ? err.message : "AI request failed";
    const hint = err instanceof TacosError ? err.hint : undefined;
    return Response.json({ error: message, ...(hint ? { hint } : {}) }, { status });
  }
}
