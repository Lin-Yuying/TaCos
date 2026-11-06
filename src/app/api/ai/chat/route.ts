import fs from "node:fs";
import os from "node:os";
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
  getHarnessSession,
  loadThreadForTurn,
  releaseSharedChatTurn,
  saveHarnessSession,
  setThreadEngine,
} from "@/lib/agent-threads";
import { openHandoffOnThread } from "@/lib/agent-handoff";
import { recordTurn } from "@/lib/agent-turn-record";
import { runApiAgentTurn } from "@/lib/agent-api-loop";
import { prepareApiHistory } from "@/lib/agent-context";
import { recordAgentUsage } from "@/lib/agent-usage";
import type { ApiChatMessage } from "@/lib/agent-api-client";
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
import { orderAgentApiEndpoints, resolveAgentApiEndpoints } from "@/lib/agent-api-config";
import { readyWithKeys } from "@/lib/harness/gate";
import type { ApprovalDecision as HarnessApprovalDecision, TurnEvent as HarnessTurnEvent } from "@/lib/harness";
import { TacosError } from "@/lib/issues";
import { bindTurnAttachments, copyTurnFiles, parseAttachmentIds } from "@/lib/agent-attachments";
import { messageWithAttachments } from "@/lib/agent-attachments.shared";
import { attachTurnFiles } from "@/lib/harness/turn-files";
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

    // #79: when the desktop runner is away, a viewer with a model API still gets an
    // answer from the built-in loop. Without one, the old "open your computer" refusal stays.
    let runnerOffline = false;
    if (engine !== "api" && isServerMode()) {
      let capabilities: Awaited<ReturnType<typeof requireRunnerOnline>> | null = null;
      try {
        capabilities = await requireRunnerOnline(access.user.id);
      } catch (err) {
        const endpoints = await resolveAgentApiEndpoints(access.user.id);
        if (endpoints.length === 0) throw err;
        runnerOffline = true;
      }
      if (capabilities) {
        const found = capabilities.harnesses.find((detect) => detect.id === engine);
        const detect = found && readyWithKeys(found, capabilities.keyed);
        if (!detect?.ready) {
          throw new TacosError(
            `${detect?.label ?? engine} is not ready on your computer`,
            400,
            detect?.hint ?? "Install it on your computer, then try again."
          );
        }
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
      // History comes from the thread, not from the browser: whatever scrolled past in
      // this conversation is what the model gets, including turns from other sessions.
      // Harness on the request is a turn pref. A mismatch updates last-used and keeps the session.
      const thread = await loadThreadForTurn(workspaceId, access.user.id, threadId);
      if (await openHandoffOnThread(threadId)) {
        throw new TacosError("Your Agent is working on this task in this conversation", 409, "Wait for it to finish, or cancel it in the task.");
      }
      if (thread.engine !== engine) await setThreadEngine(threadId, engine);

      const message = text.trim();
      const attachmentIds = parseAttachmentIds(body.attachments);
      if (!message && attachmentIds.length === 0) {
        throw new TacosError("Type a message or attach a file", 400);
      }
      const actorId = access.user.id;
      await claimSharedChatTurn(threadId, actorId);
      try {
      const turnFiles = await bindTurnAttachments(workspaceId, actorId, threadId, attachmentIds);
      const storedMessage = messageWithAttachments(message, turnFiles);
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
      const fileDir = path.join(os.tmpdir(), `tacos-attached-${assistantId}`);
      const finishSharedTurn = () => {
        fs.rmSync(fileDir, { recursive: true, force: true });
        void releaseSharedChatTurn(threadId, actorId);
      };
      const endTurn = (also?: () => void) => () => {
        also?.();
        finishSharedTurn();
      };
      const startedAt = Date.now();
      const usageFor = (source: "runner" | "api", engineId: string, modelId: string) => (usage: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        reasoningTokens: number;
      }) =>
        void recordAgentUsage({
          workspaceId,
          userId: actorId,
          engine: engineId,
          model: modelId,
          source,
          usage,
          threadId,
          messageId: assistantId,
          issueId: thread.focusIssueId,
          durationMs: Date.now() - startedAt,
        });
      const saveSession = (engineId: string) => (sessionId: string) =>
        void saveHarnessSession(threadId, engineId, sessionId);
      const nativeSession = engine === "api" ? null : await getHarnessSession(threadId, engine);

      // #79: the built-in API agent owns the loop in this process. It still runs through
      // the same per-turn grant and approval cards as a harness. A harness selected while
      // the desktop runner is away falls through here too.
      if (engine === "api" || runnerOffline) {
        const endpoints = orderAgentApiEndpoints(await resolveAgentApiEndpoints(actorId), thread.model);
        if (endpoints.length === 0) {
          throw new TacosError(
            "The API agent needs a model API",
            400,
            isServerMode()
              ? "This server has no API agent endpoint. Set TACOS_API_AGENT_BASE_URL and TACOS_API_AGENT_KEY."
              : "Add your API key in Settings → Model API."
          );
        }
        const prepared = await prepareApiHistory({
          workspaceId,
          userId: actorId,
          threadId,
          endpoints,
          model: thread.model,
          signal: request.signal,
        });
        const system = messages.find((entry) => entry.role === "system")?.content ?? "";
        const apiMessages: ApiChatMessage[] = [{ role: "system", content: system }];
        if (prepared.summary) {
          apiMessages.push({
            role: "system",
            content: `Earlier conversation summary (already completed; use it for context):\n${prepared.summary}`,
          });
        }
        apiMessages.push(
          ...prepared.history.filter(
            (entry): entry is { role: "user" | "assistant"; content: string } =>
              entry.role === "user" || entry.role === "assistant"
          )
        );
        if (apiMessages.at(-1)?.role !== "user") apiMessages.push({ role: "user", content: storedMessage });
        const apiGrant = issueAgentToolGrant({
          threadId,
          workspaceId,
          projectId: thread.projectId,
          projectKey: thread.projectKey,
          userId: actorId,
          approval: thread.approval,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
        });
        const events = runApiAgentTurn({
          workspaceId,
          userId: actorId,
          threadId,
          endpoints,
          model: thread.model || endpoints[0].editModel,
          messages: apiMessages,
          grant: apiGrant,
          signal: request.signal,
          prelude: runnerOffline
            ? [
                {
                  type: "step",
                  id: `runner-fallback-${assistantId}`,
                  kind: "info",
                  title: "Your computer is offline. This turn ran on the built-in API agent.",
                  status: "done",
                },
                ...(prepared.compacted
                  ? [
                      {
                        type: "step" as const,
                        id: `context-compaction-${assistantId}`,
                        kind: "info" as const,
                        title: `Context compacted: ${prepared.compacted} earlier messages summarized`,
                        status: "done" as const,
                      },
                    ]
                  : []),
              ]
            : prepared.compacted
            ? [
                {
                  type: "step",
                  id: `context-compaction-${assistantId}`,
                  kind: "info",
                  title: `Context compacted: ${prepared.compacted} earlier messages summarized`,
                  status: "done",
                },
              ]
            : prepared.warning
              ? [{ type: "step", id: `context-warning-${assistantId}`, kind: "info", title: prepared.warning, status: "error" }]
              : [],
        });
        return new Response(
          recordTurn(turnEventsToSse(events), {
            ...turn,
            onUsage: usageFor("api", "api", thread.model || endpoints[0].editModel),
            onEnd: endTurn(() => revokeAgentToolGrant(apiGrant.token)),
          }),
          { headers: STREAM_HEADERS }
        );
      }

      // On a server the turn runs on this person's own computer, with their keys and logins.
      if (isServerMode()) {
        const events = await startRun({
          userId: access.user.id,
          workspaceId,
          threadId,
          payload: {
            kind: "turn",
            harness: engine,
            threadId,
            projectId: thread.projectId,
            prompt: flatPrompt,
            message: storedMessage,
            model: thread.model,
            effort: thread.effort,
            approval: thread.approval,
            autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
            proxy: runtime.proxy,
            nativeSessionId: nativeSession,
            ...(turnFiles.length ? { attachments: turnFiles.map(({ id, name }) => ({ id, name })) } : {}),
          },
          signal: request.signal,
        });
        return new Response(
          recordTurn(turnEventsToSse(events), {
            ...turn,
            onUsage: usageFor("runner", engine, thread.model),
            onEnd: endTurn(),
          }),
          { headers: STREAM_HEADERS }
        );
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
      const { prompt, images } = attachTurnFiles(engine, flatPrompt, copyTurnFiles(turnFiles, fileDir));
      const isTurnApproved = () =>
        Boolean(grant && (grant.autoApproveTurn || thread.approval !== "ask"));

      // The viewer's own APIs, for this turn only.
      const keys = await harnessKeysFor(access.user.id, engine);
      const turnModel = await resolveTurnModel(engine, thread.model, thread.effort, await modelAccessFor(access.user.id));

      // Every local harness uses one adapter body. The explicit engine branches are what
      // makes a missing adapter name its own engine, and each passes the delete-tool guard.
      const mapDecision = (value: "accept" | "decline"): HarnessApprovalDecision =>
        value === "accept" ? "allow" : "deny";
      const runHarness = (
        adapter: ReturnType<typeof getHarnessAdapter>,
        extra: { neverAutoApproveTools: string[] }
      ) => {
        if (!adapter) throw new TacosError(`${engine} harness is not registered`, 500);
        const defaults = engine === "codex" ? codexDefaults() : { model: "", effort: "" };
        return adapter.openTurn({
          sessionId: threadId,
          cwd,
          prompt,
          images,
          model: turnModel.model || defaults.model || null,
          effort: turnModel.effort || defaults.effort || null,
          approval: thread.approval,
          skills: skills.length > 0 ? skills : undefined,
          autoApproveTools: AGENT_TOOLS.filter((tool) => !tool.write).map((tool) => tool.name),
          neverAutoApproveTools: extra.neverAutoApproveTools,
          isTurnApproved,
          waitForApproval: async (approvalRequest) =>
            mapDecision(
              await waitForAgentApproval(approvalRequest.requestId, { signal: request.signal })
            ),
          signal: request.signal,
          proxy: runtime.proxy,
          keys,
          nativeSessionId: nativeSession,
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
      };
      const respondHarness = (events: AsyncIterable<HarnessTurnEvent>) =>
        new Response(
          recordTurn(turnEventsToSse(events), {
            ...turn,
            onUsage: usageFor("runner", engine, thread.model),
            onSession: saveSession(engine),
            onEnd: endTurn(grant ? () => revokeAgentToolGrant(grant.token) : undefined),
          }),
          { headers: STREAM_HEADERS }
        );
      if (engine === "codex") {
        return respondHarness(
          runHarness(getHarnessAdapter("codex"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      if (engine === "pi") {
        return respondHarness(
          runHarness(getHarnessAdapter("pi"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      if (engine === "opencode") {
        return respondHarness(
          runHarness(getHarnessAdapter("opencode"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      if (engine === "codebuddy") {
        return respondHarness(
          runHarness(getHarnessAdapter("codebuddy"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      if (engine === "dsh") {
        return respondHarness(
          runHarness(getHarnessAdapter("dsh"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      if (engine === "acp") {
        return respondHarness(
          runHarness(getHarnessAdapter("acp"), {
            neverAutoApproveTools: AGENT_TOOLS.filter((tool) => tool.delete).map((tool) => tool.name),
          })
        );
      }
      throw new TacosError(`Agent turns for ${engine} are not wired yet`, 400);
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
