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
  claimSharedChatTurn,
  loadThreadForTurn,
  releaseSharedChatTurn,
  setThreadEngine,
} from "@/lib/agent-threads";
import { openHandoffOnThread } from "@/lib/agent-handoff";
import { recordTurn } from "@/lib/agent-turn-record";
import {
  codexDefaults,
  listCodexSkills,
  openCliStream,
  requireCli,
  skillsInText,
  type AgentStepEvent,
} from "@/lib/cli-agents";
import { getHarnessAdapter, resolveTurnModel, turnEventsToSse } from "@/lib/harness";
import { harnessKeysFor, harnessesWithKeys, modelAccessFor } from "@/lib/model-keys";
import { readyWithKeys } from "@/lib/harness/gate";
import type { ApprovalDecision as HarnessApprovalDecision } from "@/lib/harness";
import { TacosError } from "@/lib/issues";
import {
  buildLocalAgentTurnAttachments,
  buildRemoteAgentTurnAttachments,
  parseWireAttachments,
  turnInputAttachments,
  turnPayloadAttachments,
} from "@/lib/agent-composer-attachments";
import { requireRunnerOnline, startRun } from "@/lib/runner/hub";
import { isServerMode } from "@/lib/server-mode";

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
      attachments?: unknown;
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

    if (engine !== "api" && isServerMode()) {
      const capabilities = await requireRunnerOnline(access.user.id);
      const found = capabilities.harnesses.find((detect) => detect.id === engine);
      const detect = found && readyWithKeys(found, capabilities.keyed);
      if (!detect?.ready) {
        throw new TacosError(
          `${detect?.label ?? engine} is not ready on your computer`,
          400,
          detect?.hint ?? "Install it on your computer, then try again."
        );
      }
    } else if (engine !== "api") {
      // A harness needs its own subscription, signed in under the OS account that runs this
      // server, or the viewer's own API.
      const keyed = await harnessesWithKeys(access.user.id);
      if (engine === "codex") {
        if (!keyed.includes("codex")) requireCli(engine);
      } else {
        const adapter = getHarnessAdapter(engine);
        const detect = adapter && readyWithKeys(adapter.detect(), keyed);
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
      if (await openHandoffOnThread(threadId)) {
        throw new TacosError("Your Agent is working on this task in this conversation", 409, "Wait for it to finish, or cancel it in the task.");
      }
      if (thread.engine !== engine) await setThreadEngine(threadId, engine);

      const message = text.trim();
      const wires = parseWireAttachments(body.attachments);
      if (!message && wires.length === 0) {
        throw new TacosError("Type a message or attach a file", 400);
      }
      const storedMessage = message || wires.map((wire) => wire.name).join(", ");
      const actorId = access.user.id;
      await claimSharedChatTurn(threadId, actorId);
      try {
      await appendAgentMessage({ threadId, role: "user", content: storedMessage, authorId: actorId });
      const assistantId = await appendAgentMessage({ threadId, role: "assistant", content: "" });

      const messages = agentMessages({
        message: storedMessage,
        history: thread.messages,
        context: await agentContext({
          workspaceId,
          userId: access.user.id,
          workspaceName: access.workspace.name,
          workspaceKey: access.workspace.key,
          userName: access.user.displayName,
          focusIssueId: thread.focusIssueId,
          // A conversation started with "Don't work in a project" gets the whole
          // workspace instead of one project's slice.
          ...(thread.projectId
            ? { project: { id: thread.projectId, name: thread.projectName, key: thread.projectKey } }
            : {}),
        }),
      });

      const turn = { threadId, messageId: assistantId };
      const flatPrompt = flattenMessages(messages);
      const finishSharedTurn = () => void releaseSharedChatTurn(threadId, actorId);
      const endTurn = (also?: () => void) => () => {
        also?.();
        finishSharedTurn();
      };

      // On a server the turn runs on this person's own computer, with their keys and logins.
      if (isServerMode()) {
        const remoteAttachments = buildRemoteAgentTurnAttachments(flatPrompt, wires);
        const events = await startRun({
          userId: access.user.id,
          workspaceId,
          threadId,
          payload: {
            kind: "turn",
            harness: engine,
            threadId,
            projectId: thread.projectId,
            prompt: remoteAttachments.prompt,
            message: storedMessage,
            model: thread.model,
            effort: thread.effort,
            approval: thread.approval,
            autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
            proxy: runtime.proxy,
            ...turnPayloadAttachments(remoteAttachments.payloadAttachments),
          },
          signal: request.signal,
        });
        return new Response(recordTurn(turnEventsToSse(events), { ...turn, onEnd: endTurn() }), {
          headers: STREAM_HEADERS,
        });
      }

      const grant = issueAgentToolGrant({
        threadId,
        workspaceId,
        projectId: thread.projectId,
        projectKey: thread.projectKey,
        userId: actorId,
        approval: thread.approval,
        autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
        neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
      });
      // Only Codex has skills; "@name" tokens are matched against the skills this machine
      // really has, so ordinary prose containing an @ sign is left alone.
      const skills =
        engine === "codex" && storedMessage.includes("@") ? skillsInText(storedMessage, await listCodexSkills()) : [];
      const origin = new URL(request.url).origin;
      const cwd = path.join(DATA_DIR, "agent", workspaceId, thread.projectId || "general");
      // A missing cwd makes spawn report ENOENT for the binary, on every harness's first turn here.
      fs.mkdirSync(cwd, { recursive: true });
      const localAttachments = buildLocalAgentTurnAttachments(cwd, flatPrompt, wires);
      const prompt = localAttachments.prompt;
      const composerAttachments = turnInputAttachments(localAttachments.refs);
      const isTurnApproved = () =>
        Boolean(grant && (grant.autoApproveTurn || thread.approval !== "ask"));

      // The viewer's own APIs, for this turn only.
      const keys = await harnessKeysFor(access.user.id, engine);
      const turnModel = await resolveTurnModel(engine, thread.model, thread.effort, await modelAccessFor(access.user.id));

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
          ...composerAttachments,
          model: turnModel.model || defaults.model || null,
          effort: turnModel.effort || defaults.effort || null,
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
          keys,
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
          recordTurn(stream, { ...turn, onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined) }),
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
          ...composerAttachments,
          model: turnModel.model,
          effort: turnModel.effort,
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
          keys,
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
          recordTurn(stream, { ...turn, onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined) }),
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
          ...composerAttachments,
          model: turnModel.model,
          effort: turnModel.effort,
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
          keys,
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
          recordTurn(stream, { ...turn, onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined) }),
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
          ...composerAttachments,
          model: turnModel.model,
          effort: turnModel.effort,
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
          keys,
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
          recordTurn(stream, { ...turn, onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined) }),
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
          ...composerAttachments,
          model: turnModel.model,
          effort: turnModel.effort,
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
          keys,
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
          recordTurn(stream, { ...turn, onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined) }),
          { headers: STREAM_HEADERS }
        );
      }

      throw new TacosError(
        `Agent turns for ${engine} are not wired yet`,
        400,
        "Pick a wired harness in the composer until the remaining adapters land."
      );
      } catch (err) {
        await releaseSharedChatTurn(threadId, actorId);
        throw err;
      }
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
      const stream = await openChatStream(workspaceId, access.user.id, messages, request.signal);
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
    if (isServerMode()) {
      const events = await startRun({
        userId: access.user.id,
        workspaceId,
        payload: { kind: "edit", engine, messages, prompt: flattenMessages(messages), proxy: runtime.proxy },
        signal: request.signal,
      });
      return new Response(turnEventsToSse(events), { headers: STREAM_HEADERS });
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
