#!/usr/bin/env node
// Stdio MCP server that exposes TaCos agent tools to a local Codex session.
//
// Codex spawns this file; this file does not touch the database. Every call is forwarded
// to the running TaCos server with a per-turn bearer token, so the server stays the only
// writer and the token decides which project — and which person — a tool call acts for.
//
// TACOS_AGENT_URL    base URL of the TaCos server, e.g. http://127.0.0.1:3000
// TACOS_AGENT_TOKEN  short-lived token issued for this turn
// TACOS_TIMING_FILE  optional file that gets one JSON line per request, for the turn's timing log
import { appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = (process.env.TACOS_AGENT_URL || "").replace(/\/+$/, "");
const token = process.env.TACOS_AGENT_TOKEN || "";
const timingFile = process.env.TACOS_TIMING_FILE || "";
const PROTOCOL_VERSION = "2024-11-05";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, message, code = -32603) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callServer(path, body) {
  if (!baseUrl || !token) {
    throw new Error("TaCos did not hand this session a tool grant.");
  }
  const startedAt = Date.now();
  const response = await request(`${baseUrl}/api/agent/tools${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  noteTiming(body?.name ?? "tools/list", Date.now() - startedAt, response);
  let payload = null;
  try {
    payload = JSON.parse(response.text);
  } catch {
    /* the status below says what went wrong */
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(payload?.error || `TaCos answered ${response.status}`);
  }
  return payload;
}

function noteTiming(tool, ms, response) {
  if (!timingFile) return;
  const approvalMs = Number(response.approvalMs) || 0;
  try {
    const line = { tool, ms: Math.max(0, ms - approvalMs), approvalMs, bytes: Buffer.byteLength(response.text) };
    appendFileSync(timingFile, `${JSON.stringify(line)}\n`);
  } catch {
    /* timing never gets in the way of a tool call */
  }
}

// A write can wait a long time for the person's answer, and fetch gives up on a silent server
// after five minutes.
function request(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const send = url.startsWith("https:") ? httpsRequest : httpRequest;
    const req = send(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, approvalMs: res.headers["x-tacos-approval-ms"], text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "tacos", version: "1.0.0" },
    });
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    const payload = await callServer("", null);
    reply(id, { tools: payload?.tools ?? [] });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    if (!name) {
      reply(id, { content: [{ type: "text", text: "No tool name given." }], isError: true });
      return;
    }
    try {
      const result = await callServer("", { name, arguments: params?.arguments ?? {} });
      reply(id, result);
    } catch (err) {
      reply(id, {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      });
    }
    return;
  }
  if (id === undefined) return; // a notification, e.g. notifications/initialized
  fail(id, `Unsupported method ${method}`, -32601);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\n");
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    Promise.resolve(handle(message)).catch((err) => {
      if (message?.id !== undefined) fail(message.id, err instanceof Error ? err.message : String(err));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
