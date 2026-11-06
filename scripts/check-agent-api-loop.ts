/**
 * #79 built-in API agent: streaming, a tool call with the approval card, retry/backoff,
 * the internal iteration guard and context compaction, against a fake OpenAI-compatible
 * server. Run: npx tsx scripts/check-agent-api-loop.ts
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-api-loop-"));
process.env.TACOS_SEED_DEMO = "0";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

const requests: { stream: boolean; messages: unknown[] }[] = [];
let mode: "text" | "tool" | "retry" | "guard" = "tool";
let attempts = 0;

const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
    stream?: boolean;
    messages?: unknown[];
  };
  requests.push({ stream: Boolean(body.stream), messages: body.messages ?? [] });
  const messages = (body.messages ?? []) as { role?: string; content?: string }[];

  if (req.url?.includes("/fallback-fail/")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "wrong endpoint" } }));
    return;
  }
  if (body.stream === false) {
    // Compaction summary request.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Summary: the user asked for API work." } }] }));
    return;
  }

  if (mode === "retry") {
    attempts += 1;
    if (attempts < 3) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "slow down" } }));
      return;
    }
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (chunk: unknown) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  const usage = {
    prompt_tokens: 12,
    completion_tokens: 4,
    total_tokens: 16,
    prompt_tokens_details: { cached_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 2 },
  };

  if (mode === "guard") {
    // Always asks for a read tool; no approval is needed, so the loop keeps going.
    send({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call-${requests.length}`,
                function: { name: "list_tasks", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });
    send({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage });
    res.end("data: [DONE]\n\n");
    return;
  }

  const toolDone = messages.some((message) => message.role === "tool");
  if (mode === "tool" && !toolDone) {
    send({ choices: [{ delta: { content: "Let me comment. " } }] });
    send({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: {
                  name: "add_comment",
                  arguments: JSON.stringify({ workspace: "API", id: "API-1", body: "hello from the API agent" }),
                },
              },
            ],
          },
        },
      ],
    });
    send({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage });
    res.end("data: [DONE]\n\n");
    return;
  }
  send({ choices: [{ delta: { content: "Done." } }] });
  send({ choices: [{ delta: {}, finish_reason: "stop" }], usage });
  res.end("data: [DONE]\n\n");
});

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const { getDb } = await import("../src/db/client");
  const { comments, issueAssignees, issues, projectMembers, projects, users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { issueAgentToolGrant, answerAgentApproval } = await import("../src/lib/agent-sessions");
  const { runApiAgentTurn } = await import("../src/lib/agent-api-loop");
  const { prepareApiHistory } = await import("../src/lib/agent-context");
  const { getContextState } = await import("../src/lib/agent-threads");
  const { recordAgentUsage, usageForThread } = await import("../src/lib/agent-usage");

  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(users).values({ id: "u1", username: "u1", displayName: "Uma", passwordHash: "x", createdAt: now } as never);
  await db.insert(workspaces).values({ id: "w1", name: "API", key: "API", createdBy: "u1", createdAt: now, membersSeeAllTasks: 1 } as never);
  await db.insert(workspaceMembers).values({ workspaceId: "w1", userId: "u1", role: "admin", createdAt: now } as never);
  await db.insert(projects).values({ id: "p1", workspaceId: "w1", key: "API", name: "One", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  await db.insert(projectMembers).values({ projectId: "p1", userId: "u1", createdAt: now } as never);
  await db.insert(issues).values({ id: "i1", workspaceId: "w1", projectId: "p1", number: 1, identifier: "API-1", title: "Task", description: "", createdBy: "u1", createdAt: now, updatedAt: now } as never);
  await db.insert(issueAssignees).values({ issueId: "i1", userId: "u1", createdAt: now } as never);

  const fakeThread = async (id: string) => {
    await db.insert(await import("../src/db/schema").then((m) => m.agentThreads)).values({
      id,
      workspaceId: "w1",
      projectId: "p1",
      title: id,
      engine: "api",
      model: "fake-model",
      approval: "ask",
      visibility: "private",
      createdBy: "u1",
      createdAt: now,
      updatedAt: now,
    } as never);
  };
  await fakeThread("t1");

  const endpoint = {
    id: "fake",
    label: "Fake",
    baseUrl,
    apiKey: "secret",
    models: ["fake-model"],
    editModel: "fake-model",
  };
  const grant = issueAgentToolGrant({
    threadId: "t1",
    workspaceId: "w1",
    projectId: "p1",
    projectKey: "API",
    userId: "u1",
    approval: "ask",
    autoApproveTools: [],
    neverAutoApproveTools: ["delete_task"],
  });

  mode = "tool";
  const events: { type: string; text?: string; usage?: unknown; requestId?: string; status?: string; message?: string }[] = [];
  let answered = false;
  for await (const event of runApiAgentTurn({
    workspaceId: "w1",
    userId: "u1",
    threadId: "t1",
    endpoints: [endpoint],
    model: "fake-model",
    grant,
    messages: [
      { role: "system", content: "You are the API agent." },
      { role: "user", content: "Comment on API-1." },
    ],
  })) {
    events.push(event as never);
    if (event.type === "approval" && !answered) {
      answered = true;
      assert(answerAgentApproval(event.requestId, "accept"), "approval card answers");
    }
  }
  assert(answered, "a write asked for approval");
  assert(events.some((event) => event.type === "delta" && event.text === "Let me comment. "), "streams text");
  assert(events.some((event) => event.type === "step" && event.status === "done"), "tool step done");
  assert(events.some((event) => event.type === "usage"), "usage event emitted");
  const written = await db.select().from(comments).where(and(eq(comments.issueId, "i1")));
  assert(written.some((row) => row.body.includes("hello from the API agent")), "tool wrote the comment");
  assert(requests.length >= 2, "the loop sent the tool result back");

  // Retry/backoff on 429.
  mode = "retry";
  attempts = 0;
  let retried = false;
  for await (const event of runApiAgentTurn({
    workspaceId: "w1",
    userId: "u1",
    threadId: "t1",
    endpoints: [endpoint],
    model: "fake-model",
    grant,
    messages: [{ role: "user", content: "Say hi." }],
  })) {
    if (event.type === "delta") retried = true;
  }
  assert(attempts >= 3, "retried after 429");
  assert(retried, "the retried request streamed text");

  // The iteration guard is internal and bounded.
  mode = "guard";
  process.env.TACOS_API_AGENT_MAX_ITERATIONS = "3";
  let guardError = "";
  for await (const event of runApiAgentTurn({
    workspaceId: "w1",
    userId: "u1",
    threadId: "t1",
    endpoints: [endpoint],
    model: "fake-model",
    grant,
    messages: [{ role: "user", content: "loop" }],
  })) {
    if (event.type === "error") guardError = event.message;
  }
  assert(/step guard/.test(guardError), `iteration guard fired: ${guardError}`);

  // Compaction persists a summary and the boundary, and the next turn starts after it.
  const { agentMessages } = await import("../src/db/schema");
  for (let index = 0; index < 42; index++) {
    await db.insert(agentMessages).values({
      id: `m${index}`,
      threadId: "t1",
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index} `.repeat(30),
      createdAt: new Date(Date.parse(now) + index * 1000).toISOString(),
    } as never);
  }
  const prepared = await prepareApiHistory({
    workspaceId: "w1",
    userId: "u1",
    threadId: "t1",
    endpoints: [endpoint],
    model: "fake-model",
  });
  assert(prepared.compacted > 0, "older history was compacted");
  const state = await getContextState("t1");
  assert(state.summary.includes("Summary"), "the summary is stored");
  assert(state.through, "the boundary message is stored");
  assert(prepared.history.length <= 20, "recent history stays small");

  await recordAgentUsage({
    workspaceId: "w1",
    userId: "u1",
    engine: "api",
    model: "fake-model",
    source: "api",
    usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, reasoningTokens: 1 },
    threadId: "t1",
    agentId: "a1",
  });
  const totals = await usageForThread("t1");
  assert(totals.totalTokens === 15 && totals.cachedTokens === 2 && totals.reasoningTokens === 1, "usage ledger totals");

  // A rejected endpoint falls back to the next one.
  mode = "text";
  let fallbackText = "";
  for await (const event of runApiAgentTurn({
    workspaceId: "w1",
    userId: "u1",
    threadId: "t1",
    endpoints: [{ ...endpoint, id: "bad", baseUrl: baseUrl.replace("/v1", "/fallback-fail") }, endpoint],
    model: "fake-model",
    grant,
    messages: [{ role: "user", content: "Say hi." }],
  })) {
    if (event.type === "delta") fallbackText += event.text;
  }
  assert(fallbackText.includes("Done."), "a failing endpoint falls back to the next");

  server.close();
  console.log("check-agent-api-loop: pass");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  server.close();
  process.exit(1);
});
