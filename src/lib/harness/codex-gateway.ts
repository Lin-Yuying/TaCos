/**
 * A person's own API for one Codex turn. Codex only speaks the Responses API and many APIs only
 * offer Chat Completions, so Codex talks to this loopback server and the server talks to the API:
 * an API with /responses is passed through, any other gets the request and the stream translated.
 *
 * The server lives as long as the turn. Codex gets a random key for it, never the person's key,
 * so the agent's tools cannot read that key from their environment.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ProxyAgent, fetch as proxiedFetch } from "undici";
import { upstreamProxy } from "@/lib/cli-agents";
import type { OwnEndpoint } from "./own-endpoint";

type Json = Record<string, unknown>;
type ChatCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage = {
  role: string;
  content: unknown;
  reasoning_content?: string;
  tool_calls?: ChatCall[];
  tool_call_id?: string;
};

const MAX_BODY_BYTES = 64 * 1024 * 1024;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Responses content is a string or a list of parts. */
function contentParts(content: unknown): { text: string; images: unknown[] } {
  if (typeof content === "string") return { text: content, images: [] };
  let text = "";
  const images: unknown[] = [];
  for (const raw of asArray(content)) {
    const part = asObject(raw);
    if (["input_text", "output_text", "text", "summary_text", "refusal"].includes(asString(part.type))) {
      text += asString(part.text);
    } else if (part.type === "input_image" && part.image_url) {
      images.push(part.image_url);
    }
  }
  return { text, images };
}

/** Chat Completions has no tool groups, so a tool in a group gets the group's name in front. */
function flatName(item: Json): string {
  const namespace = asString(item.namespace);
  return namespace ? `${namespace}__${asString(item.name)}` : asString(item.name);
}

export type GroupedTool = { namespace: string; name: string };

/**
 * A Responses request as a Chat Completions request, plus what the reply needs to undo the
 * translation: the names of the free-form tools and where each grouped tool came from.
 */
export function toChatRequest(request: Json): { chat: Json; custom: Set<string>; grouped: Map<string, GroupedTool> } {
  const input = typeof request.input === "string"
    ? [{ type: "message", role: "user", content: request.input }]
    : asArray(request.input);
  const system: string[] = [];
  if (asString(request.instructions).trim()) system.push(asString(request.instructions));
  const messages: ChatMessage[] = [];
  let reasoning = "";

  const addCall = (id: string, name: string, args: string) => {
    let last = messages[messages.length - 1];
    if (last?.role !== "assistant") {
      last = { role: "assistant", content: null };
      messages.push(last);
    }
    if (reasoning) {
      last.reasoning_content = `${last.reasoning_content ?? ""}${reasoning}`;
      reasoning = "";
    }
    (last.tool_calls ??= []).push({ id, type: "function", function: { name, arguments: args } });
  };

  for (const raw of input) {
    const item = asObject(raw);
    const type = asString(item.type) || (item.role ? "message" : "");
    const callId = asString(item.call_id);
    if (type === "message") {
      const { text, images } = contentParts(item.content);
      if (item.role === "system" || item.role === "developer") {
        if (text.trim()) system.push(text);
      } else if (item.role === "assistant") {
        messages.push({ role: "assistant", content: text, ...(reasoning ? { reasoning_content: reasoning } : {}) });
        reasoning = "";
      } else if (images.length === 0) {
        messages.push({ role: "user", content: text });
      } else {
        messages.push({
          role: "user",
          content: [
            ...(text ? [{ type: "text", text }] : []),
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: typeof image === "string" ? image : asObject(image).url },
            })),
          ],
        });
      }
    } else if (type === "function_call") {
      addCall(callId, flatName(item), asString(item.arguments));
    } else if (type === "custom_tool_call") {
      addCall(callId, flatName(item), JSON.stringify({ input: asString(item.input) }));
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      messages.push({ role: "tool", tool_call_id: callId, content: contentParts(item.output).text });
    } else if (type === "reasoning") {
      for (const part of asArray(item.summary)) reasoning += asString(asObject(part).text);
    }
  }
  if (system.length > 0) messages.unshift({ role: "system", content: system.join("\n\n") });

  const custom = new Set<string>();
  const grouped = new Map<string, GroupedTool>();
  const tools: Json[] = [];
  const addTool = (tool: Json, name: string) => {
    if (tool.type === "function") {
      tools.push({
        type: "function",
        function: {
          name,
          description: asString(tool.description),
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      });
    } else if (tool.type === "custom") {
      custom.add(name);
      const grammar = asString(asObject(tool.format).definition);
      tools.push({
        type: "function",
        function: {
          name,
          description: `${asString(tool.description)}${grammar ? `\n\nThe input must follow this grammar:\n${grammar}` : ""}`,
          parameters: {
            type: "object",
            properties: { input: { type: "string", description: "The tool's raw input" } },
            required: ["input"],
          },
        },
      });
    }
    // Hosted tools (web_search, local_shell) have no Chat Completions form.
  };
  for (const raw of asArray(request.tools)) {
    const tool = asObject(raw);
    const name = asString(tool.name);
    if (!name) continue;
    if (tool.type !== "namespace") {
      addTool(tool, name);
      continue;
    }
    // TaCos's own tools arrive this way, as the group mcp__tacos.
    for (const rawInner of asArray(tool.tools)) {
      const inner = asObject(rawInner);
      const innerName = asString(inner.name);
      if (!innerName) continue;
      const flat = flatName({ namespace: name, name: innerName });
      grouped.set(flat, { namespace: name, name: innerName });
      addTool(inner, flat);
    }
  }

  const chat: Json = {
    model: request.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools.length > 0) {
    chat.tools = tools;
    if (typeof request.tool_choice === "string") chat.tool_choice = request.tool_choice;
    if (typeof request.parallel_tool_calls === "boolean") chat.parallel_tool_calls = request.parallel_tool_calls;
  }
  const effort = asString(asObject(request.reasoning).effort);
  if (effort) chat.reasoning_effort = effort;
  if (typeof request.max_output_tokens === "number") chat.max_tokens = request.max_output_tokens;
  if (typeof request.temperature === "number") chat.temperature = request.temperature;
  if (typeof request.top_p === "number") chat.top_p = request.top_p;
  return { chat, custom, grouped };
}

function randomId(): string {
  return randomBytes(12).toString("hex");
}

/** Turns Chat Completions chunks into the Responses events Codex reads. */
export class ResponsesStream {
  private readonly id = `resp_${randomId()}`;
  private readonly at = Math.floor(Date.now() / 1000);
  private sequence = 0;
  private nextIndex = 0;
  private open: "message" | "reasoning" | null = null;
  private openId = "";
  private openIndex = 0;
  private text = "";
  private calls = new Map<number, { id: string; name: string; args: string }>();
  private output: unknown[] = [];
  private usage: Json | null = null;

  constructor(
    private readonly write: (chunk: string) => void,
    private readonly model: string,
    private readonly custom: Set<string>,
    private readonly grouped: Map<string, GroupedTool> = new Map()
  ) {}

  private emit(type: string, fields: Json) {
    const data = JSON.stringify({ ...fields, type, sequence_number: this.sequence++ });
    this.write(`event: ${type}\ndata: ${data}\n\n`);
  }

  private response(status: string): Json {
    return {
      id: this.id,
      object: "response",
      created_at: this.at,
      model: this.model,
      status,
      output: this.output,
      ...(this.usage ? { usage: this.usage } : {}),
    };
  }

  created() {
    this.emit("response.created", { response: this.response("in_progress") });
  }

  private begin(kind: "message" | "reasoning") {
    if (this.open === kind) return;
    this.end();
    this.open = kind;
    this.openIndex = this.nextIndex++;
    this.text = "";
    const place = () => ({ item_id: this.openId, output_index: this.openIndex });
    if (kind === "message") {
      this.openId = `msg_${randomId()}`;
      this.emit("response.output_item.added", {
        output_index: this.openIndex,
        item: { type: "message", id: this.openId, role: "assistant", status: "in_progress", content: [] },
      });
      this.emit("response.content_part.added", {
        ...place(),
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      });
    } else {
      this.openId = `rs_${randomId()}`;
      this.emit("response.output_item.added", {
        output_index: this.openIndex,
        item: { type: "reasoning", id: this.openId, summary: [] },
      });
      this.emit("response.reasoning_summary_part.added", {
        ...place(),
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      });
    }
  }

  private delta(kind: "message" | "reasoning", delta: string) {
    if (!delta) return;
    this.begin(kind);
    this.text += delta;
    const place = { item_id: this.openId, output_index: this.openIndex };
    if (kind === "message") this.emit("response.output_text.delta", { ...place, content_index: 0, delta });
    else this.emit("response.reasoning_summary_text.delta", { ...place, summary_index: 0, delta });
  }

  private end() {
    if (!this.open) return;
    const place = { item_id: this.openId, output_index: this.openIndex };
    let item: Json;
    if (this.open === "message") {
      const part = { type: "output_text", text: this.text, annotations: [] };
      this.emit("response.output_text.done", { ...place, content_index: 0, text: this.text });
      this.emit("response.content_part.done", { ...place, content_index: 0, part });
      item = { type: "message", id: this.openId, role: "assistant", status: "completed", content: [part] };
    } else {
      const part = { type: "summary_text", text: this.text };
      this.emit("response.reasoning_summary_text.done", { ...place, summary_index: 0, text: this.text });
      this.emit("response.reasoning_summary_part.done", { ...place, summary_index: 0, part });
      item = { type: "reasoning", id: this.openId, summary: [part] };
    }
    this.emit("response.output_item.done", { output_index: this.openIndex, item });
    this.output.push(item);
    this.open = null;
  }

  private flushCalls() {
    if (this.calls.size === 0) return;
    this.end();
    for (const [, call] of [...this.calls].sort(([a], [b]) => a - b)) {
      const id = call.id || `call_${randomId()}`;
      const group = this.grouped.get(call.name);
      const origin = group ?? { name: call.name };
      let item: Json;
      if (this.custom.has(call.name)) {
        let input = call.args;
        try {
          input = asString(asObject(JSON.parse(call.args)).input);
        } catch {
          // A model that ignored the wrapper sent the raw input.
        }
        item = { type: "custom_tool_call", id: `ctc_${randomId()}`, call_id: id, ...origin, input, status: "completed" };
      } else {
        const args = call.args.trim() ? call.args : "{}";
        item = { type: "function_call", id: `fc_${randomId()}`, call_id: id, ...origin, arguments: args, status: "completed" };
      }
      const index = this.nextIndex++;
      this.emit("response.output_item.added", { output_index: index, item: { ...item, status: "in_progress" } });
      this.emit("response.output_item.done", { output_index: index, item });
      this.output.push(item);
    }
    this.calls.clear();
  }

  /** One chunk, or a whole non-streamed reply. Throws what an upstream error chunk says. */
  take(chunk: Json) {
    const error = asObject(chunk.error);
    if (chunk.error) throw new Error(asString(error.message) || "The API reported an error.");
    for (const rawChoice of asArray(chunk.choices)) {
      const choice = asObject(rawChoice);
      const message = asObject(choice.delta ?? choice.message);
      this.delta("reasoning", asString(message.reasoning_content) + asString(message.reasoning));
      this.delta("message", asString(message.content));
      asArray(message.tool_calls).forEach((rawCall, position) => {
        const call = asObject(rawCall);
        const fn = asObject(call.function);
        const key = typeof call.index === "number" ? call.index : position;
        const current = this.calls.get(key) ?? { id: "", name: "", args: "" };
        current.id = asString(call.id) || current.id;
        current.name = asString(fn.name) || current.name;
        current.args += asString(fn.arguments);
        this.calls.set(key, current);
      });
    }
    if (chunk.usage) {
      const usage = asObject(chunk.usage);
      const input = Number(usage.prompt_tokens ?? 0);
      const output = Number(usage.completion_tokens ?? 0);
      this.usage = {
        input_tokens: input,
        output_tokens: output,
        total_tokens: Number(usage.total_tokens ?? 0) || input + output,
        input_tokens_details: { cached_tokens: Number(asObject(usage.prompt_tokens_details).cached_tokens ?? 0) },
        output_tokens_details: { reasoning_tokens: Number(asObject(usage.completion_tokens_details).reasoning_tokens ?? 0) },
      };
    }
  }

  completed() {
    this.end();
    this.flushCalls();
    this.emit("response.completed", { response: this.response("completed") });
  }

  failed(message: string) {
    this.end();
    this.emit("response.failed", {
      response: { ...this.response("failed"), error: { code: "upstream_error", message } },
    });
  }
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message } }));
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on("end", () => resolve(size <= MAX_BODY_BYTES ? Buffer.concat(chunks) : null));
    req.on("error", reject);
  });
}

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function* lines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    yield* parts;
  }
  if (buffer) yield buffer;
}

function drain(res:http.ServerResponse):Promise<void>{
 if(!res.writableNeedDrain)return Promise.resolve();
 return new Promise((resolve,reject)=>{const cleanup=()=>{res.off("drain",ready);res.off("close",closed);res.off("error",failed);};const ready=()=>{cleanup();resolve();};const closed=()=>{cleanup();reject(new Error("Connection closed"));};const failed=(error:Error)=>{cleanup();reject(error);};res.once("drain",ready);res.once("close",closed);res.once("error",failed);if(res.destroyed)closed();});
}

async function translateStream(
  upstream: Awaited<ReturnType<typeof proxiedFetch>>,
  res: http.ServerResponse,
  stream: ResponsesStream
) {
  stream.created();
  try {
    if ((upstream.headers.get("content-type") ?? "").includes("event-stream")) {
      for await (const line of lines(upstream.body as unknown as AsyncIterable<Uint8Array>)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") break;
        let chunk: Json;
        try {
          chunk = asObject(JSON.parse(data));
        } catch {
          continue;
        }
        stream.take(chunk);await drain(res);
      }
    } else {
      stream.take(asObject(await upstream.json()));
    }
    stream.completed();
  } catch (err) {
    stream.failed(err instanceof Error ? err.message : "The API's reply could not be read.");
  }
  res.end();
}

function isLoopback(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
}

// APIs seen answering /responses with "not here". Saves a wasted request on every model call.
const chatOnly = new Set<string>();

export type CodexGateway = { baseUrl: string; key: string; close: () => void };

export async function startCodexGateway(own: OwnEndpoint, proxy: string | undefined): Promise<CodexGateway> {
  const base = own.endpoint.baseUrl.replace(/\/+$/, "");
  const key = `tacos-${randomBytes(24).toString("hex")}`;
  const proxyUrl = isLoopback(base) ? "" : upstreamProxy(proxy ?? "");
  // A SOCKS proxy is something Codex itself can use but this request cannot: it goes direct.
  const agent = /^https?:/.test(proxyUrl) ? new ProxyAgent(proxyUrl) : undefined;

  const post = (path: string, body: Buffer | string, signal: AbortSignal) =>
    proxiedFetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
        authorization: `Bearer ${own.key}`,
      },
      body,
      signal,
      dispatcher: agent,
    });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse, host: string) => {
    if (req.headers.origin || req.headers.host !== host) return sendError(res, 403, "Not allowed.");
    if (!sameKey(req.headers.authorization ?? "", `Bearer ${key}`)) return sendError(res, 401, "Bad key.");
    if (req.method !== "POST" || req.url?.split("?")[0] !== "/v1/responses") return sendError(res, 404, "Not found.");
    const body = await readBody(req);
    if (!body) return sendError(res, 413, "Request too large.");

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    if (!chatOnly.has(base)) {
      const direct = await post("/responses", body, abort.signal);
      if (direct.status !== 404 && direct.status !== 405) {
        res.writeHead(direct.status, { "content-type": direct.headers.get("content-type") ?? "application/json" });
        for await (const chunk of direct.body as unknown as AsyncIterable<Uint8Array>){res.write(chunk);await drain(res);}
        res.end();
        return;
      }
      await direct.body?.cancel();
    }

    let request: Json;
    try {
      request = asObject(JSON.parse(body.toString("utf8")));
    } catch {
      return sendError(res, 400, "The request is not JSON.");
    }
    if (!request.stream) return sendError(res, 400, "Only streamed requests can be translated.");
    const { chat, custom, grouped } = toChatRequest(request);
    const upstream = await post("/chat/completions", JSON.stringify(chat), abort.signal);
    if (upstream.status >= 400) {
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(await upstream.text());
      return;
    }
    chatOnly.add(base);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    await translateStream(upstream, res, new ResponsesStream((chunk) => res.write(chunk), asString(request.model), custom, grouped));
  };

  const server = http.createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    handle(req, res, `127.0.0.1:${port}`).catch((err) => {
      if (res.headersSent) res.destroy();
      else sendError(res, 502, `Could not reach the API: ${err instanceof Error ? err.message : "unknown error"}`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    key,
    close: () => {
      server.close();
      server.closeAllConnections();
      void agent?.close();
    },
  };
}
