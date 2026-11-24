#!/usr/bin/env node
// Stdio MCP server that gives Codex, Claude Code and any other MCP client the TaCos task
// surface. It talks to /api/v1 with a personal API key, so the TaCos server stays the only
// writer and the key decides which workspace a call acts for.
//
// TACOS_URL      base URL of the TaCos server (default http://127.0.0.1:3000)
// TACOS_API_KEY  key from TaCos Settings → Agent access
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_URL = "http://127.0.0.1:3000";

const baseUrl = (process.env.TACOS_URL || DEFAULT_URL).replace(/\/+$/, "");
const apiKey = (process.env.TACOS_API_KEY || "").trim();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, message, code = -32603) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function textResult(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Writes can wait on a person in the browser (approvals), and fetch gives up on a silent
// server after five minutes.
function httpJson(method, path, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(`${baseUrl}${path}`);
    } catch {
      reject(new Error(`TACOS_URL is not a valid URL: ${baseUrl}`));
      return;
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const sendRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = sendRequest(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function api(method, path, body) {
  if (!apiKey) {
    throw new Error(
      "TaCos has no API key. Create one in TaCos Settings → Agent access and export it as TACOS_API_KEY."
    );
  }
  const response = await httpJson(method, path, body);
  if (response.status < 200 || response.status >= 300) {
    const detail = response.json?.error || response.text || `TaCos answered ${response.status}`;
    const hint = response.json?.hint ? ` ${response.json.hint}` : "";
    throw new Error(`${detail}${hint}`);
  }
  return response.json;
}

function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function issuePath(id) {
  return `/api/v1/issues/${encodeURIComponent(id)}`;
}

const TASK_FIELDS = {
  title: { type: "string", description: "Short, imperative summary." },
  description: { type: "string", description: "Markdown body." },
  status: { type: "string", description: "todo, in progress, done or canceled (aliases work)." },
  priority: { type: "string", description: "none, low, medium, high or urgent." },
  assignees: {
    type: "array",
    items: { type: "string" },
    description: "Usernames or display names. An empty list clears the assignees.",
  },
  labels: { type: "array", items: { type: "string" }, description: "Label names; missing labels are created." },
  dueDate: { type: "string", description: "YYYY-MM-DD, or an empty string to clear it." },
};

const TOOLS = [
  {
    name: "whoami",
    description:
      "Show the TaCos workspace this key belongs to, plus its members and projects. Call it first when you need a project key or a username.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tasks",
    description: "List TaCos tasks. Defaults to active tasks, newest first.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "A status, or active / all." },
        priority: { type: "string", description: "none, low, medium, high or urgent." },
        assignee: { type: "string", description: "Username, display name, or none for unassigned." },
        q: { type: "string", description: "Free text search over titles and descriptions." },
        label: { type: "string", description: "Label name." },
        project: { type: "string", description: "Project key such as CORE." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "At most 200, default 100." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    description: "Read one task with its comments and activity, by identifier (CORE-12) or id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description: "Create a task. The first project is used when project is omitted.",
    inputSchema: {
      type: "object",
      properties: { ...TASK_FIELDS, project: { type: "string", description: "Project key such as CORE." } },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "Change a task. Send only the fields that should change.",
    inputSchema: {
      type: "object",
      properties: { ...TASK_FIELDS, id: { type: "string", description: "Identifier (CORE-12) or id." } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task. The comment is attributed to the API key that sent it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, body: { type: "string", description: "Markdown." } },
      required: ["id", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_task",
    description: "Move a task to Trash. Trash is restorable; this does not erase it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_labels",
    description: "List the workspace labels.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "create_label",
    description: "Create a workspace label.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        color: { type: "string", description: "Hex colour such as #0d0d0d." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  const input = args && typeof args === "object" ? args : {};
  switch (name) {
    case "whoami":
      return textResult(await api("GET", "/api/v1/me"));
    case "list_tasks":
      return textResult(
        await api(
          "GET",
          `/api/v1/issues${query({
            status: input.status,
            priority: input.priority,
            assignee: input.assignee,
            q: input.q,
            label: input.label,
            project: input.project,
            limit: input.limit,
          })}`
        )
      );
    case "get_task":
      return textResult(await api("GET", issuePath(String(input.id ?? ""))));
    case "create_task": {
      // An empty dueDate means "no due date" on update, but create takes a date or nothing.
      const { dueDate, ...fields } = input;
      return textResult(
        await api("POST", "/api/v1/issues", dueDate ? { ...fields, dueDate } : fields)
      );
    }
    case "update_task": {
      const { id, ...fields } = input;
      if (!id) throw new Error("id is required");
      return textResult(await api("PATCH", issuePath(String(id)), fields));
    }
    case "add_comment": {
      if (!input.id) throw new Error("id is required");
      return textResult(await api("POST", `${issuePath(String(input.id))}/comments`, { body: input.body }));
    }
    case "delete_task": {
      if (!input.id) throw new Error("id is required");
      return textResult(await api("DELETE", issuePath(String(input.id))));
    }
    case "list_labels":
      return textResult(await api("GET", "/api/v1/labels"));
    case "create_label":
      return textResult(await api("POST", "/api/v1/labels", { name: input.name, color: input.color }));
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "tacos", title: "TaCos", version: VERSION },
    });
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    if (!name) {
      reply(id, toolError("No tool name given."));
      return;
    }
    try {
      reply(id, await callTool(name, params?.arguments));
    } catch (err) {
      reply(id, toolError(err instanceof Error ? err.message : String(err)));
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
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      continue;
    }
    handle(message).catch((err) => {
      if (message?.id !== undefined) fail(message.id, err instanceof Error ? err.message : String(err));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
