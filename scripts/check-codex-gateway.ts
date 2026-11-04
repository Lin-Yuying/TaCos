/**
 * Codex on a person's own API goes through a per-turn loopback server: translation both ways,
 * pass-through for APIs with /responses, the key stays out of Codex, and strangers are refused.
 * Run: npx tsx scripts/check-codex-gateway.ts
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ResponsesStream, startCodexGateway, toChatRequest } from "../src/lib/harness/codex-gateway";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function checkRequest() {
  const { chat, custom } = toChatRequest({
    model: "m",
    instructions: "sys",
    stream: true,
    reasoning: { effort: "high" },
    tool_choice: "auto",
    parallel_tool_calls: false,
    tools: [
      { type: "function", name: "shell", parameters: { type: "object" } },
      { type: "custom", name: "apply_patch", format: { definition: "G" } },
      { type: "web_search" },
    ],
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "reasoning", summary: [{ type: "summary_text", text: "think" }] },
      { type: "function_call", call_id: "c1", name: "shell", arguments: '{"cmd":"ls"}' },
      { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: "*** Begin" },
      { type: "function_call_output", call_id: "c1", output: "a.txt" },
      { type: "custom_tool_call_output", call_id: "c2", output: "ok" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
    ],
  });
  assert(custom.has("apply_patch"), "apply_patch is a free-form tool");
  const messages = chat.messages as Array<{
    role: string;
    content: unknown;
    reasoning_content?: string;
    tool_call_id?: string;
    tool_calls: Array<{ function: { arguments: string } }>;
  }>;
  assert(messages.length === 6, `expected 6 messages, got ${messages.length}`);
  assert(messages[0].role === "system" && messages[0].content === "sys\n\ndev", "system message");
  const calls = messages[2];
  assert(calls.role === "assistant" && calls.tool_calls.length === 2 && calls.reasoning_content === "think", "assistant calls");
  assert(calls.tool_calls[1].function.arguments === '{"input":"*** Begin"}', "free-form call arguments");
  assert(messages[3].role === "tool" && messages[3].tool_call_id === "c1" && messages[3].content === "a.txt", "tool message");
  assert((chat.tools as unknown[]).length === 2, "hosted tools are skipped");
  assert(chat.reasoning_effort === "high" && chat.tool_choice === "auto" && chat.parallel_tool_calls === false, "options");
}

function checkGroupedTools() {
  const { chat, grouped } = toChatRequest({
    model: "m",
    stream: true,
    tools: [
      {
        type: "namespace",
        name: "mcp__tacos",
        tools: [{ type: "function", name: "add_comment", parameters: { type: "object" } }],
      },
    ],
    input: [
      { type: "function_call", call_id: "c1", namespace: "mcp__tacos", name: "add_comment", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
    ],
  });
  const tools = chat.tools as Array<{ function: { name: string } }>;
  assert(tools.length === 1 && tools[0].function.name === "mcp__tacos__add_comment", "a grouped tool reaches the model");
  const history = chat.messages as Array<{ tool_calls?: Array<{ function: { name: string } }> }>;
  assert(history[0].tool_calls?.[0].function.name === "mcp__tacos__add_comment", "an earlier call keeps the same name");

  let out = "";
  const stream = new ResponsesStream((chunk) => (out += chunk), "m", new Set(), grouped);
  stream.take({
    choices: [{ delta: { tool_calls: [{ index: 0, id: "c2", function: { name: "mcp__tacos__add_comment", arguments: "{}" } }] } }],
  });
  stream.completed();
  const done = out
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .find((event) => event.type === "response.output_item.done").item;
  assert(done.name === "add_comment" && done.namespace === "mcp__tacos", "the call goes back to its group");
}

function checkStream() {
  let out = "";
  const stream = new ResponsesStream((chunk) => (out += chunk), "m", new Set(["apply_patch"]));
  stream.created();
  for (const chunk of [
    { choices: [{ delta: { reasoning_content: "想" } }] },
    { choices: [{ delta: { content: "你" } }] },
    { choices: [{ delta: { content: "好" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "shell", arguments: '{"c' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'md":1}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "apply_patch", arguments: '{"input":"P"}' } }] } }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ]) {
    stream.take(chunk);
  }
  stream.completed();
  const events = out
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const done = events.filter((event) => event.type === "response.output_item.done").map((event) => event.item);
  assert(done.length === 4, `expected 4 finished items, got ${done.length}`);
  assert(done[0].type === "reasoning" && done[1].type === "message", "item order");
  assert(done[1].content[0].text === "你好", "reply text");
  assert(done[2].type === "function_call" && done[2].arguments === '{"cmd":1}' && done[2].call_id === "call_a", "function call");
  assert(done[3].type === "custom_tool_call" && done[3].input === "P", "free-form call");
  const last = events[events.length - 1];
  assert(last.type === "response.completed" && last.response.usage.input_tokens === 10, "completed with usage");
}

async function checkServer() {
  const seen: Array<{ url: string; auth: string }> = [];
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization ?? "" });
      if (req.url === "/both/responses") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("event: response.completed\ndata: {}\n\n");
      } else if (req.url === "/chat/responses") {
        res.writeHead(404);
        res.end();
      } else if (req.url === "/bad/chat/completions") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":{"message":"bad key"}}');
      } else if (req.url === "/bad/responses") {
        res.writeHead(404);
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      }
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const own = (path: string) => ({
    endpoint: { id: "endpoint-x", label: "x", baseUrl: `${root}${path}`, envVar: "X", models: ["m"] },
    model: "m",
    key: "real-key",
  });
  const body = JSON.stringify({ model: "m", stream: true, input: "hi" });
  const call = (gateway: { baseUrl: string; key: string }, headers: Record<string, string> = {}) =>
    fetch(`${gateway.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${gateway.key}`, ...headers },
      body,
    });

  const chat = await startCodexGateway(own("/chat"), "");
  assert(chat.key !== "real-key", "Codex must not get the person's key");
  assert((await call({ ...chat, key: "wrong" })).status === 401, "a wrong key is refused");
  assert((await call(chat, { origin: "https://example.com" })).status === 403, "a browser page is refused");
  const translated = await (await call(chat)).text();
  assert(translated.includes("response.completed") && translated.includes('"delta":"OK"'), "chat reply is translated");
  assert(seen[0].url === "/chat/responses" && seen[1].url === "/chat/chat/completions", "tries /responses first");
  assert(seen.every((request) => request.auth === "Bearer real-key"), "the API gets the person's key");
  const count = seen.length;
  await (await call(chat)).text();
  assert(seen.length === count + 1 && seen[count].url === "/chat/chat/completions", "remembers a chat-only API");
  chat.close();
  let closed = false;
  await call(chat).catch(() => (closed = true));
  assert(closed, "the server ends with the turn");

  const both = await startCodexGateway(own("/both"), "");
  const passed = await (await call(both)).text();
  assert(passed === "event: response.completed\ndata: {}\n\n", "an API with /responses is passed through");
  both.close();

  const bad = await startCodexGateway(own("/bad"), "");
  const rejected = await call(bad);
  assert(rejected.status === 401 && (await rejected.text()).includes("bad key"), "the API's refusal reaches Codex");
  bad.close();

  // A proxy on the way out: requests tunnel through it, except to this machine.
  const tunnels: string[] = [];
  const proxy = http.createServer();
  proxy.on("connect", (req, socket) => {
    tunnels.push(req.url ?? "");
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const local = await startCodexGateway(own("/both"), proxyUrl);
  assert((await call(local)).status === 200, "this machine is reached directly");
  local.close();
  assert(tunnels.length === 0, "no tunnel for this machine");
  const away = await startCodexGateway(
    { ...own(""), endpoint: { ...own("").endpoint, baseUrl: "https://api.example.invalid/v1" } },
    proxyUrl
  );
  assert((await call(away)).status === 502, "a dead tunnel is reported");
  away.close();
  assert(tunnels[0] === "api.example.invalid:443", `tunnel target ${tunnels[0]}`);
  proxy.close();
  upstream.close();
}

checkRequest();
checkGroupedTools();
checkStream();
checkServer()
  .then(() => {
    console.log("check-codex-gateway: pass");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
