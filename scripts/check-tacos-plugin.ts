/**
 * Pass condition of the Codex/Claude Code plugin: the marketplace entries point at a real plugin,
 * and its stdio MCP server speaks MCP, sends the API key, maps tools to /api/v1, and reports
 * failures as tool errors instead of dying. Uses a stub HTTP server, so no TaCos data is touched.
 *   npx tsx scripts/check-tacos-plugin.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginDir = path.join(root, "plugins", "tacos");
const bridge = path.join(pluginDir, "mcp", "tacos-mcp.mjs");

type Json = Record<string, unknown>;

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

function asJson(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function recordNamed(value: unknown, name: string): Json | undefined {
  return asArray(value)
    .map(asJson)
    .find((entry) => entry.name === name);
}

// --- manifests -------------------------------------------------------------

const codexMarket = asJson(readJson(path.join(root, ".agents", "plugins", "marketplace.json")));
assert(codexMarket.name === "tacos", "codex marketplace is named tacos");
const codexEntry = recordNamed(codexMarket.plugins, "tacos");
const codexSource = asJson(codexEntry?.source);
assert(codexSource.source === "local", "codex marketplace entry is local");
assert(
  fs.existsSync(path.join(root, asString(codexSource.path), ".codex-plugin", "plugin.json")),
  "codex marketplace path has a plugin manifest"
);

const claudeMarket = asJson(readJson(path.join(root, ".claude-plugin", "marketplace.json")));
const claudeEntry = recordNamed(claudeMarket.plugins, "tacos");
assert(claudeEntry?.source === "./plugins/tacos", "claude marketplace points at plugins/tacos");

const manifest = asJson(readJson(path.join(pluginDir, ".codex-plugin", "plugin.json")));
assert(manifest.name === "tacos", "plugin name is tacos");
assert(/^\d+\.\d+\.\d+$/.test(asString(manifest.version)), "plugin version is semver");
assert(fs.existsSync(path.join(pluginDir, asString(manifest.skills))), "skills folder exists");
const manifestInterface = asJson(manifest.interface);
assert(
  fs.existsSync(path.join(pluginDir, asString(manifestInterface.composerIcon))),
  "composer icon exists"
);
const claudeManifest = asJson(readJson(path.join(pluginDir, ".claude-plugin", "plugin.json")));
assert(claudeManifest.name === manifest.name, "claude manifest names the same plugin");

const mcpConfig = asJson(readJson(path.join(pluginDir, ".mcp.json")));
const serverEntry = asJson(asJson(mcpConfig.mcpServers).tacos);
assert(serverEntry.command === "node", "plugin starts the bridge with node");
assert(
  fs.existsSync(path.join(pluginDir, asString(asArray(serverEntry.args)[0]))),
  "plugin MCP entry points at the bridge"
);
const envVars = asArray(serverEntry.env_vars);
assert(
  envVars.includes("TACOS_API_KEY") && envVars.includes("TACOS_URL"),
  "plugin passes TACOS_URL and TACOS_API_KEY through"
);

const skill = fs.readFileSync(path.join(pluginDir, "skills", "tacos", "SKILL.md"), "utf8");
assert(/^---\nname: tacos\ndescription: .+\n---/.test(skill), "skill frontmatter has a name and description");

// --- stub TaCos ------------------------------------------------------------

type Seen = { method: string; url: string; auth: string; body: Json | null };
const seen: Seen[] = [];

const stub = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const url = req.url ?? "";
    const raw = Buffer.concat(chunks).toString("utf8");
    seen.push({
      method: req.method ?? "",
      url,
      auth: String(req.headers.authorization ?? ""),
      body: raw ? asJson(JSON.parse(raw)) : null,
    });
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (url === "/api/v1/issues" && req.method === "POST") {
      return json(201, { identifier: "CORE-2", title: "Created" });
    }
    if (url.startsWith("/api/v1/issues?") || url === "/api/v1/issues") {
      return json(200, [{ identifier: "CORE-1", title: "Stub task", status: "todo" }]);
    }
    if (url.startsWith("/api/v1/issues/CORE-404")) {
      return json(404, { error: 'Issue "CORE-404" not found' });
    }
    if (url === "/api/v1/issues/CORE-1/comments") {
      return json(201, { comment: { id: "c1", body: "hello" }, issue: { identifier: "CORE-1" } });
    }
    if (url.startsWith("/api/v1/me")) {
      return json(200, {
        product: "tacos",
        authenticated: true,
        keyName: "check",
        workspace: { id: "ws-check" },
        members: [{ id: "u1", username: "alex", displayName: "Alex" }],
        projects: [{ id: "p1", key: "CORE", name: "Core" }],
      });
    }
    if (url.startsWith("/api/v1/labels")) {
      return json(200, [{ name: "Agent", color: "#0d0d0d" }]);
    }
    return json(200, { ok: true });
  });
});

// --- MCP client over stdio -------------------------------------------------

type Client = {
  child: ChildProcessWithoutNullStreams;
  request: (message: Json) => Promise<Json>;
};

function startBridge(key: string | null): Client {
  const child = spawn(process.execPath, [bridge], {
    env: {
      ...process.env,
      TACOS_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
      ...(key === null ? {} : { TACOS_API_KEY: key }),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, (value: Json) => void>();
  let buffer = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => process.stderr.write(chunk));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line) continue;
      const message = asJson(JSON.parse(line));
      const resolve = pending.get(Number(message.id));
      if (resolve) {
        pending.delete(Number(message.id));
        resolve(message);
      }
    }
  });
  let nextId = 1;
  return {
    child,
    request(message) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no reply to ${asString(message.method)}`)), 10_000);
        pending.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...message })}\n`);
      });
    },
  };
}

function toolResult(message: Json): Json {
  return asJson(message.result);
}

function toolText(message: Json): string {
  return asString(asJson(asArray(toolResult(message).content)[0]).text);
}

async function main() {
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const client = startBridge("tac_check_key");
  try {
    const init = await client.request({
      method: "initialize",
      params: { protocolVersion: "2024-11-05", clientInfo: { name: "check", version: "0" } },
    });
    const initResult = toolResult(init);
    assert(asJson(initResult.serverInfo).name === "tacos", "initialize names the tacos server");
    assert(initResult.protocolVersion === "2024-11-05", "initialize echoes the protocol version");
    client.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const list = await client.request({ method: "tools/list" });
    const tools = asArray(toolResult(list).tools).map(asJson);
    const names = tools.map((tool) => asString(tool.name)).sort();
    assert(
      names.join(",") ===
        "add_comment,create_label,create_task,delete_task,get_task,list_labels,list_tasks,update_task,whoami",
      `tools/list returns the task tools: ${names.join(",")}`
    );
    assert(
      tools.every((tool) => asJson(tool.inputSchema).type === "object"),
      "every tool has an object input schema"
    );

    const who = await client.request({ method: "tools/call", params: { name: "whoami", arguments: {} } });
    assert(asJson(JSON.parse(toolText(who))).authenticated === true, "whoami returns the stub identity");
    const whoSeen = seen.find((entry) => entry.url.startsWith("/api/v1/me"));
    assert(whoSeen?.auth === "Bearer tac_check_key", "whoami sends the API key as a bearer token");

    const tasks = await client.request({
      method: "tools/call",
      params: { name: "list_tasks", arguments: { status: "active", project: "CORE", limit: 5 } },
    });
    assert(toolText(tasks).includes("CORE-1"), "list_tasks returns the stub task");
    const listSeen = seen.find((entry) => entry.url.startsWith("/api/v1/issues?"));
    assert(
      listSeen?.url.includes("status=active") &&
        listSeen?.url.includes("project=CORE") &&
        listSeen?.url.includes("limit=5"),
      `list_tasks forwards its filters: ${listSeen?.url}`
    );

    const created = await client.request({
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "Created", project: "CORE" } },
    });
    assert(asJson(JSON.parse(toolText(created))).identifier === "CORE-2", "create_task returns the new task");
    const createSeen = seen.find((entry) => entry.method === "POST" && entry.url === "/api/v1/issues");
    assert(
      createSeen?.body?.title === "Created" && createSeen?.body?.project === "CORE",
      "create_task posts the fields"
    );

    const comment = await client.request({
      method: "tools/call",
      params: { name: "add_comment", arguments: { id: "CORE-1", body: "hello" } },
    });
    assert(asJson(JSON.parse(toolText(comment))).comment !== undefined, "add_comment returns the comment");
    const commentSeen = seen.find((entry) => entry.url === "/api/v1/issues/CORE-1/comments");
    assert(commentSeen?.body?.body === "hello", "add_comment posts the body");

    const missing = await client.request({
      method: "tools/call",
      params: { name: "update_task", arguments: { id: "CORE-404", status: "done" } },
    });
    assert(toolResult(missing).isError === true, "an API error becomes a tool error");
    assert(toolText(missing).includes("not found"), "the tool error keeps the server's message");

    const unknown = await client.request({ method: "tools/call", params: { name: "nope", arguments: {} } });
    assert(toolResult(unknown).isError === true, "an unknown tool is a tool error");
  } finally {
    client.child.kill();
  }

  const noKey = startBridge(null);
  try {
    const call = await noKey.request({ method: "tools/call", params: { name: "whoami", arguments: {} } });
    assert(toolResult(call).isError === true, "a missing key is a tool error");
    assert(toolText(call).includes("TACOS_API_KEY"), "the missing-key error names TACOS_API_KEY");
  } finally {
    noKey.child.kill();
    stub.close();
  }

  console.log("check-tacos-plugin: ok");
}

void main();
