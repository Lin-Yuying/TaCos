import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "@/db/client";
import { TacosError } from "./issues";
import { isManagedSkillPath } from "./skill-files";
import type { AgentSkill, CliEngine, CliEngineStatus, CodexModel } from "./ai-constants";

// Local agent CLIs reuse the login that already exists on this machine, so the
// browser never sees a provider key. They are spawned per chat turn and killed
// when the turn ends or the browser disconnects.

const ENCODER = new TextEncoder();
const TIMEOUT_MS = 180_000;
const HOME = os.homedir();

const LABELS: Record<CliEngine, string> = { codex: "Codex", pi: "Pi" };

const BIN_ENV: Record<CliEngine, string> = { codex: "TACOS_CODEX_BIN", pi: "TACOS_PI_BIN" };

const CANDIDATES: Record<CliEngine, string[]> = {
  codex: [
    path.join(HOME, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(HOME, ".npm-global/bin/codex"),
  ],
  pi: [
    path.join(HOME, ".local/bin/pi"),
    "/opt/homebrew/bin/pi",
    "/usr/local/bin/pi",
    "/opt/anaconda3/bin/pi",
  ],
};

const INSTALL_HINT: Record<CliEngine, string> = {
  codex: "Install the Codex CLI (npm i -g @openai/codex), then run codex login in Terminal.",
  pi: "Install Pi (curl -fsSL https://pi.dev/install.sh | sh), then run pi and /login.",
};

const LOGIN_HINT: Record<CliEngine, string> = {
  codex: "Run codex login in Terminal and sign in with your ChatGPT account.",
  pi: "Run pi in Terminal, then /login to connect a subscription.",
};

type Cached<T> = { at: number; value: T };
const binaryCache = new Map<CliEngine, Cached<string | null>>();
const statusCache = new Map<CliEngine, Cached<CliEngineStatus>>();
const CACHE_MS = 30_000;

function executable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fromShell(name: string): string | null {
  const command = process.platform === "win32" ? "where" : "command -v";
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/c", `${command} ${name}`] : ["-lc", `${command} ${name}`];
  try {
    const out = execFileSync(shell, args, {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")[0]
      .trim();
    return out && executable(out) ? out : null;
  } catch {
    return null;
  }
}

function findBinary(engine: CliEngine): string | null {
  const cached = binaryCache.get(engine);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const override = process.env[BIN_ENV[engine]]?.trim();
  let found: string | null = null;
  if (override && executable(override)) found = override;
  for (const candidate of CANDIDATES[engine]) {
    if (found) break;
    if (executable(candidate)) found = candidate;
  }
  if (!found) found = fromShell(engine);
  binaryCache.set(engine, { at: Date.now(), value: found });
  return found;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function codexStatus(): CliEngineStatus {
  const binary = findBinary("codex");
  const base: CliEngineStatus = {
    engine: "codex",
    label: LABELS.codex,
    installed: Boolean(binary),
    signedIn: false,
    binary,
    account: null,
    model: null,
    hint: binary ? LOGIN_HINT.codex : INSTALL_HINT.codex,
  };
  if (!binary) return base;
  const auth = readJson(path.join(HOME, ".codex", "auth.json"));
  const tokens = auth?.tokens as Record<string, unknown> | undefined;
  if (typeof tokens?.access_token === "string" && tokens.access_token) {
    base.signedIn = true;
    base.account = auth?.auth_mode === "apikey" ? "API key" : "ChatGPT";
  }
  try {
    const config = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8");
    base.model = config.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    /* no user config: Codex picks its default model */
  }
  if (base.signedIn) base.hint = null;
  return base;
}

function piStatus(): CliEngineStatus {
  const binary = findBinary("pi");
  const base: CliEngineStatus = {
    engine: "pi",
    label: LABELS.pi,
    installed: Boolean(binary),
    signedIn: false,
    binary,
    account: null,
    model: null,
    hint: binary ? LOGIN_HINT.pi : INSTALL_HINT.pi,
  };
  if (!binary) return base;
  const auth = readJson(path.join(HOME, ".pi", "agent", "auth.json"));
  const providers = auth
    ? Object.entries(auth)
        .filter(([, value]) => value && typeof value === "object")
        .map(([key]) => key)
    : [];
  if (providers.length > 0) {
    base.signedIn = true;
    base.account = providers.join(", ");
    base.hint = null;
  }
  return base;
}

export function cliStatus(engine: CliEngine): CliEngineStatus {
  const cached = statusCache.get(engine);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = engine === "codex" ? codexStatus() : piStatus();
  statusCache.set(engine, { at: Date.now(), value });
  return value;
}

export function listCliStatuses(): CliEngineStatus[] {
  return [cliStatus("codex"), cliStatus("pi")];
}

// --- Codex model catalog ---------------------------------------------------

// Codex ships its model list next to its config; reading that file is the only way to
// offer exactly the models this machine can actually run.
export const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

let modelCache: Cached<CodexModel[]> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function listCodexModels(): CodexModel[] {
  if (modelCache && Date.now() - modelCache.at < CACHE_MS) return modelCache.value;
  const cache = readJson(path.join(HOME, ".codex", "models_cache.json"));
  const raw = Array.isArray(cache?.models) ? (cache.models as unknown[]) : [];
  const models: CodexModel[] = [];
  for (const entry of raw) {
    const model = asRecord(entry);
    const slug = typeof model?.slug === "string" ? model.slug : "";
    // "hide" entries are Codex's internal helpers (auto-review, reserve); they are not
    // models a person can pick.
    if (!slug || model?.visibility === "hide") continue;
    const levels = Array.isArray(model?.supported_reasoning_levels)
      ? (model.supported_reasoning_levels as unknown[])
          .map((level) => asRecord(level))
          .filter((level): level is Record<string, unknown> => Boolean(level))
          .map((level) => (typeof level.effort === "string" ? level.effort : ""))
          .filter(Boolean)
      : [];
    models.push({
      slug,
      label: typeof model?.display_name === "string" && model.display_name ? model.display_name : slug,
      description: typeof model?.description === "string" ? model.description : "",
      defaultEffort: typeof model?.default_reasoning_level === "string" ? model.default_reasoning_level : "medium",
      efforts: levels.map((effort) => ({ id: effort, label: EFFORT_LABELS[effort] ?? effort })),
      priority: typeof model?.priority === "number" ? model.priority : 99,
      fast: Array.isArray(model?.service_tiers) && model.service_tiers.length > 0,
    });
  }
  models.sort((a, b) => a.priority - b.priority);
  modelCache = { at: Date.now(), value: models };
  return models;
}

// What `codex` would use if nobody passed a model: the user's config, else the catalogue's
// top entry. The composer shows this instead of inventing a default.
export function codexDefaults(): { model: string; effort: string } {
  let model = "";
  let effort = "";
  try {
    const config = fs.readFileSync(path.join(HOME, ".codex", "config.toml"), "utf8");
    model = config.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
    effort = config.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  } catch {
    /* no user config */
  }
  const models = listCodexModels();
  const picked = models.find((entry) => entry.slug === model) ?? models[0];
  return {
    model: picked?.slug ?? model,
    effort: effort || picked?.defaultEffort || "",
  };
}

// --- Codex skills ----------------------------------------------------------

const SKILLS_CACHE_MS = 5 * 60_000;
let skillCache: Cached<AgentSkill[]> | null = null;

// Codex already knows which skills this machine has (user folders, `~/.agents/skills`,
// enabled plugin marketplaces). Asking its app-server instead of re-implementing the
// discovery keeps the @ menu and turn/start agreeing on the exact names and paths.
export async function listCodexSkills(): Promise<AgentSkill[]> {
  if (skillCache && Date.now() - skillCache.at < SKILLS_CACHE_MS) return skillCache.value;
  const binary = findBinary("codex");
  if (!binary) return [];
  const skills = await readSkills(binary).catch(() => [] as AgentSkill[]);
  // A failed scan must not pin an empty menu for five minutes.
  if (skills.length > 0 || !skillCache) skillCache = { at: Date.now(), value: skills };
  return skills;
}

// Adding or deleting a skill folder must show up in the next page render instead of five
// minutes later.
export function clearSkillCache(): void {
  skillCache = null;
}

function readSkills(binary: string): Promise<AgentSkill[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(binary, ["app-server", "-c", "notify=[]", "-c", "plugins={}"], {
      cwd: agentCwd(),
      env: cliEnv(""),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const finish = (skills: AgentSkill[] | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill();
      if (error) reject(error);
      else resolve(skills ?? []);
    };
    const timer = setTimeout(() => finish(null, new Error("Codex did not list its skills in time")), 15_000);
    const send = (payload: unknown) => proc.stdin.write(`${JSON.stringify(payload)}\n`);
    let buffer = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        let message: {
          id?: number;
          error?: unknown;
          result?: { data?: { skills?: unknown[] }[] };
        };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "skills/list", params: { cwds: [agentCwd()] } });
        } else if (message.id === 2) {
          if (message.error) return finish(null, new Error(errorText(message.error)));
          const skills: AgentSkill[] = [];
          for (const entry of message.result?.data ?? []) {
            for (const raw of entry?.skills ?? []) {
              const skill = asRecord(raw);
              if (!skill || skill.enabled !== true) continue;
              if (typeof skill.name !== "string" || typeof skill.path !== "string") continue;
              const scope = skill.scope;
              skills.push({
                name: skill.name,
                path: skill.path,
                description: typeof skill.description === "string" ? skill.description : "",
                scope: scope === "repo" || scope === "system" || scope === "admin" ? scope : "user",
                managed: isManagedSkillPath(skill.path),
              });
            }
          }
          return finish(skills);
        }
      }
    });
    proc.on("error", (err) => finish(null, err));
    proc.on("exit", (code) => finish(null, new Error(`codex exited with code ${code ?? "unknown"}`)));
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "tacos", title: "TaCos", version: "0.1.0" } },
    });
  });
}

// The person writes "@documents" and the turn gets that skill attached; the text itself
// is left alone so the transcript still reads exactly like what was typed.
const SKILL_MENTION = /(?:^|[^\w/@])@([A-Za-z0-9_.:-]+)/g;

export function skillsInText(text: string, skills: AgentSkill[]): AgentSkill[] {
  const picked: AgentSkill[] = [];
  for (const match of text.matchAll(SKILL_MENTION)) {
    const token = match[1].toLowerCase();
    const found =
      skills.find((skill) => skill.name.toLowerCase() === token) ??
      skills.find((skill) => skill.name.toLowerCase().split(":").pop() === token);
    if (found && !picked.some((skill) => skill.path === found.path)) picked.push(found);
  }
  return picked;
}

export function requireCli(engine: CliEngine): CliEngineStatus {
  const status = cliStatus(engine);
  if (!status.installed) {
    throw new TacosError(`${status.label} is not installed on this server`, 400, status.hint ?? undefined);
  }
  if (!status.signedIn) {
    throw new TacosError(`${status.label} is not signed in on this server`, 400, status.hint ?? undefined);
  }
  return status;
}

export function normalizeProxy(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 200) throw new TacosError("Proxy address is too long");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new TacosError("Proxy must look like http://127.0.0.1:7890");
  }
  if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) {
    throw new TacosError("Proxy must use http, https or socks5");
  }
  return withScheme.replace(/\/+$/, "");
}

const PROXY_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
let systemProxyCache: Cached<string> | null = null;

// macOS stores the proxy in system settings, but the CLIs only read environment
// variables: without this, a machine that reaches ChatGPT through Clash just sees
// "Reconnecting..." because every socket is reset.
function systemProxy(): string {
  if (process.platform !== "darwin") return "";
  if (systemProxyCache && Date.now() - systemProxyCache.at < CACHE_MS) return systemProxyCache.value;
  let value = "";
  try {
    const out = execFileSync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const entries = new Map<string, string>();
    for (const line of out.split("\n")) {
      const match = /^\s*([A-Za-z]+)\s*:\s*(\S+)\s*$/.exec(line);
      if (match) entries.set(match[1], match[2]);
    }
    const pick = (enable: string, host: string, port: string, scheme: string) =>
      entries.get(enable) === "1" && entries.get(host) && entries.get(port)
        ? `${scheme}://${entries.get(host)}:${entries.get(port)}`
        : "";
    value =
      pick("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http") ||
      pick("HTTPEnable", "HTTPProxy", "HTTPPort", "http") ||
      pick("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5");
  } catch {
    value = "";
  }
  systemProxyCache = { at: Date.now(), value };
  return value;
}

/** The proxy for a request this server makes on a harness's behalf: same order as cliEnv. */
export function upstreamProxy(proxy: string): string {
  const inherited = PROXY_KEYS.map((key) => (process.env[key] ?? "").trim()).find(Boolean);
  return proxy.trim() || inherited || systemProxy();
}

// The Codex and Pi CLIs need the proxy that the desktop app itself may not use,
// because they talk to their provider directly.
function cliEnv(proxy: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const inherited = PROXY_KEYS.some((key) => (env[key] ?? "").trim());
  const chosen = proxy || (inherited ? "" : systemProxy());
  if (chosen) {
    for (const key of PROXY_KEYS) env[key] = chosen;
    env.NO_PROXY = "localhost,127.0.0.1,::1";
    env.no_proxy = env.NO_PROXY;
  }
  return env;
}

function agentCwd(): string {
  const dir = path.join(DATA_DIR, "agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class SseChannel {
  private closed = false;

  constructor(private readonly controller: ReadableStreamDefaultController<Uint8Array>) {}

  get isClosed(): boolean {
    return this.closed;
  }

  delta(text: string): void {
    this.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  }

  // Structured frames the Agent tab understands: trajectory steps and permission cards.
  frame(payload: Record<string, unknown>): void {
    this.write(`data: ${JSON.stringify({ tacos: payload })}\n\n`);
  }

  error(message: string): void {
    this.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
    this.close();
  }

  done(): void {
    this.write("data: [DONE]\n\n");
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      /* already closed by the browser */
    }
  }

  private write(chunk: string): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(ENCODER.encode(chunk));
    } catch {
      this.closed = true;
    }
  }
}

export type CliPrompt = { system: string; body: string };

export type AgentStepEvent = {
  key: string;
  kind: "command" | "file" | "tool" | "info" | "thinking";
  title: string;
  detail?: string;
  status: "running" | "done" | "error" | "denied";
};

export type AgentApprovalRequest = {
  requestId: string;
  tool: string;
  message: string;
  description: string | null;
  params: string | null;
};

// What turns a plain CLI answer into an Agent turn: which project folder Codex works
// in, whether it may change things, the TaCos MCP server it can call, and the two
// callbacks that carry the trajectory and permission cards back to the browser.
export type AgentRun = {
  cwd: string;
  // Empty means "leave Codex on whatever its config says".
  model?: string;
  effort?: string;
  approval?: "ask" | "auto" | "full";
  // Skills the person explicitly @-mentioned; Codex loads them for this turn only.
  skills?: { name: string; path: string }[];
  mcp?: { command: string; args: string[]; env: Record<string, string> };
  // Read-only tools the agent may use without a card; every write is still asked.
  autoApprove?: string[];
  // Delete tools always wait for a card, even when approval is Full (H-P3-19).
  neverAutoApprove?: string[];
  // True once the person chose "Allow for this turn" on an earlier card.
  isTurnApproved?: () => boolean;
  onStep?: (step: AgentStepEvent) => void;
  onApproval?: (request: AgentApprovalRequest) => Promise<"accept" | "decline">;
};

type RunOptions = { proxy: string; signal?: AbortSignal; agent?: AgentRun };

type CodexItem = {
  id?: string;
  type?: string;
  status?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  query?: string;
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

// Codex reads MCP servers from config; app-server accepts the same keys as -c overrides,
// which is how the per-turn TaCos server and its short-lived token reach the child process.
function mcpConfigArgs(mcp: NonNullable<AgentRun["mcp"]>): string[] {
  const overrides = [
    `mcp_servers.tacos.command=${tomlString(mcp.command)}`,
    `mcp_servers.tacos.args=${tomlArray(mcp.args)}`,
  ];
  for (const [key, value] of Object.entries(mcp.env)) {
    overrides.push(`mcp_servers.tacos.env.${key}=${tomlString(value)}`);
  }
  return overrides.flatMap((override) => ["-c", override]);
}

function stepStatus(status: string | undefined, completed: boolean): AgentStepEvent["status"] {
  if (status === "failed") return "error";
  if (status === "declined") return "denied";
  if (status === "completed") return "done";
  return completed ? "done" : "running";
}

function stepFromItem(item: CodexItem, completed: boolean): AgentStepEvent | null {
  const key = item.id ?? "";
  if (item.type === "commandExecution") {
    return {
      key,
      kind: "command",
      title: item.command ?? "Command",
      detail: JSON.stringify({
        cwd: item.cwd ?? null,
        exitCode: item.exitCode ?? null,
        output: (item.aggregatedOutput ?? "").slice(-4000),
      }),
      status: stepStatus(item.status, completed),
    };
  }
  if (item.type === "fileChange") {
    const paths = (item.changes ?? []).map((change) => change.path ?? "").filter(Boolean);
    return {
      key,
      kind: "file",
      title: paths.length > 0 ? paths.join(", ") : "File change",
      detail: JSON.stringify({ changes: item.changes ?? [] }),
      status: stepStatus(item.status, completed),
    };
  }
  if (item.type === "mcpToolCall") {
    // Codex reports a refused permission prompt as a failed tool call, but the trajectory
    // reads better when it says the user said no.
    const refused =
      item.status === "failed" && /\brejected\b|\bdenied\b|\bdeclined\b/i.test(errorText(item.error));
    return {
      key,
      kind: "tool",
      title: `${item.server ?? "mcp"}.${item.tool ?? "tool"}`,
      detail: JSON.stringify({
        arguments: item.arguments ?? null,
        result: item.result ?? null,
        error: item.error ?? null,
      }),
      status: refused ? "denied" : stepStatus(item.status, completed),
    };
  }
  if (item.type === "webSearch") {
    return { key, kind: "info", title: `Search: ${item.query ?? ""}`, status: "done" };
  }
  return null;
}


function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  return "The agent reported an error.";
}

function stderrTail(stderr: string, fallback: string): string {
  const tail = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ");
  return tail || fallback;
}

// Codex says "Reconnecting..." when its stream drops; on its own that tells the user
// nothing about why.
function connectionHint(message: string): string {
  if (!/Reconnecting|disconnected|reset by peer|timed out/i.test(message)) return message;
  return `${message} — Codex could not reach its provider from this server. Check the network, or set a proxy under Settings → Harness.`;
}

// Work turns legitimately run longer than a question: a tool loop with several writes
// takes a while, and cutting it at three minutes loses work that already happened.
const WORK_TIMEOUT_MS = 300_000;

function codexStream(binary: string, prompt: CliPrompt, options: RunOptions): ReadableStream<Uint8Array> {
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stop = () => {};

  const agent = options.agent;
  const work = true; // Unified Agent always mounts TaCos tools (H-P1-06).
  const cwd = agent?.cwd ?? agentCwd();
  fs.mkdirSync(cwd, { recursive: true });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sse = new SseChannel(controller);
      let text = "";
      let stderr = "";
      let lastError = "";
      let finished = false;

      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (error) sse.error(connectionHint(error));
        else if (!text.trim()) {
          sse.error(lastError ? connectionHint(lastError) : "Codex returned an empty reply.");
        } else sse.done();
        stop = () => {};
        child?.kill();
      };

      timer = setTimeout(
        () =>
          finish(
            work
              ? "This work turn took longer than five minutes and was stopped."
              : "Codex took longer than three minutes. Try a shorter question."
          ),
        work ? WORK_TIMEOUT_MS : TIMEOUT_MS
      );

      const args = ["app-server", "-c", "notify=[]", "-c", "plugins={}"];
      // The turn runs the model the composer shows, not whatever the CLI config happens
      // to hold — the chip would otherwise be a lie.
      if (agent?.model) args.push("-c", `model=${tomlString(agent.model)}`);
      if (agent?.effort) args.push("-c", `model_reasoning_effort=${tomlString(agent.effort)}`);
      // Chat mounts no TaCos tools; Work mounts them and asks the browser before each write.
      if (agent?.mcp) args.push(...mcpConfigArgs(agent.mcp));
      else args.push("-c", "mcp_servers={}");

      let proc: ChildProcess;
      try {
        proc = spawn(binary, args, { cwd, env: cliEnv(options.proxy), stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        finish(err instanceof Error ? err.message : "Could not start Codex.");
        return;
      }
      child = proc;
      if (!proc.stdout || !proc.stderr) {
        finish("Codex did not provide a stream.");
        return;
      }
      stop = () => {
        finished = true;
        if (timer) clearTimeout(timer);
        proc.kill();
        sse.close();
      };

      const send = (message: unknown) => {
        try {
          if (proc.stdin?.writable) proc.stdin.write(`${JSON.stringify(message)}\n`);
        } catch {
          /* the process exited before it could accept the message */
        }
      };

      const emitStep = (item: CodexItem, completed: boolean) => {
        const update = stepFromItem(item, completed);
        if (!update) return;
        sse.frame({ type: "step", step: update });
        agent?.onStep?.(update);
      };

      // Codex asks the client before running an MCP tool. Reads inside the bound project
      // are pre-approved; anything that writes becomes a card the user has to answer.
      const answer = (id: number | string, method: string, params: Record<string, unknown>) => {
        if (method !== "mcpServer/elicitation/request") {
          // Shell and patch escalations stay closed: Work grants TaCos tools, not the shell.
          send({ jsonrpc: "2.0", id, result: { decision: "denied" } });
          return;
        }
        const meta = (params._meta ?? {}) as Record<string, unknown>;
        if (meta.codex_approval_kind !== "mcp_tool_call" || !agent?.onApproval) {
          send({ jsonrpc: "2.0", id, result: { action: "decline" } });
          return;
        }
        const message = String(params.message ?? "Allow this tool call?");
        const toolName = message.match(/run tool "([^"]+)"/)?.[1] ?? "call";
        if (
          !agent.neverAutoApprove?.includes(toolName) &&
          (agent.autoApprove?.includes(toolName) || agent.isTurnApproved?.())
        ) {
          send({ jsonrpc: "2.0", id, result: { action: "accept", content: {} } });
          return;
        }
        const request: AgentApprovalRequest = {
          // Thread-prefixed so two open conversations cannot answer each other's cards.
          requestId: `${String(params.threadId ?? "thread")}:${String(id)}`,
          tool: `${String(params.serverName ?? "mcp")}.${toolName}`,
          message,
          description: typeof meta.tool_description === "string" ? meta.tool_description : null,
          params: meta.tool_params ? JSON.stringify(meta.tool_params, null, 2) : null,
        };
        sse.frame({ type: "approval", request });
        void agent.onApproval(request).then((decision) => {
          if (finished) return;
          send({
            jsonrpc: "2.0",
            id,
            result: decision === "accept" ? { action: "accept", content: {} } : { action: "decline" },
          });
          sse.frame({ type: "approval_done", requestId: request.requestId, decision });
        });
      };

      let buffer = "";
      const handle = (line: string) => {
        let message: {
          id?: number | string | null;
          method?: string;
          result?: Record<string, unknown>;
          params?: Record<string, unknown>;
          error?: unknown;
        };
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        const method = message.method;
        const params = (message.params ?? {}) as Record<string, unknown>;

        // Server→client request (has id) or notification (no id). Both used to be ignored,
        // which is why approvals hung until Codex gave up.
        if (method) {
          if (message.id !== undefined && message.id !== null) {
            answer(message.id, method, params);
            return;
          }
          if (method === "item/started" || method === "item/completed") {
            emitStep((params.item ?? {}) as CodexItem, method === "item/completed");
            return;
          }
          if (method === "item/agentMessage/delta") {
            const delta = params.delta;
            if (typeof delta === "string" && delta) {
              text += delta;
              sse.delta(delta);
            }
            return;
          }
          if (method === "mcpServer/startupStatus/updated") {
            if (params.name === "tacos" && params.status === "failed") {
              const reason = String(params.error ?? params.failureReason ?? "unknown error");
              sse.frame({
                type: "step",
                step: {
                  key: "tacos-mcp",
                  kind: "info",
                  title: `TaCos tools could not start: ${reason}`,
                  status: "error",
                },
              });
            }
            return;
          }
          if (method === "turn/completed") {
            const turn = params.turn as {
              status?: string;
              error?: unknown;
              items?: { type?: string; text?: string }[];
            } | undefined;
            if (turn?.status === "failed") return finish(errorText(turn.error));
            if (!text.trim()) {
              const fallback = turn?.items?.find((item) => item.type === "agent_message")?.text;
              if (typeof fallback === "string" && fallback) {
                text = fallback;
                sse.delta(fallback);
              }
            }
            return finish();
          }
          if (method === "error") {
            const detail = params as { error?: unknown; willRetry?: boolean };
            lastError = errorText(detail.error);
            // Codex retries a dropped stream on its own and normally recovers, so a
            // retryable error must not end the turn — it used to surface as the answer.
            if (!detail.willRetry) return finish(lastError);
            return;
          }
          return;
        }

        if (message.id === 1) {
          if (message.error) return finish(errorText(message.error));
          send({ jsonrpc: "2.0", method: "initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "thread/start",
            params: {
              cwd,
              // Full opens the machine sandbox. MCP still uses on-request so delete tools can ask (H-P3-19).
              sandbox: work && agent?.approval === "full" ? "danger-full-access" : work ? "workspace-write" : "read-only",
              approvalPolicy: work ? "on-request" : "never",
              ephemeral: true,
              baseInstructions: prompt.system,
            },
          });
          return;
        }
        if (message.id === 2) {
          if (message.error) return finish(errorText(message.error));
          const threadId = (message.result?.thread as { id?: string } | undefined)?.id;
          if (!threadId) return finish("Codex did not open a conversation.");
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "turn/start",
            params: {
              threadId,
              input: [
                { type: "text", text: prompt.body },
                ...(agent?.skills ?? []).map((skill) => ({
                  type: "skill",
                  name: skill.name,
                  path: skill.path,
                })),
              ],
            },
          });
          return;
        }
        if (message.id === 3 && message.error) return finish(errorText(message.error));
      };

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) handle(line);
          if (finished) return;
          index = buffer.indexOf("\n");
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4_000);
      });
      proc.on("error", (err) => finish(`Could not start Codex: ${err.message}`));
      proc.on("exit", (code) => {
        if (!finished) finish(stderrTail(stderr, `Codex exited with code ${code ?? "unknown"}.`));
      });

      options.signal?.addEventListener("abort", stop, { once: true });
      if (options.signal?.aborted) stop();
      else
        send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "tacos", title: "TaCos", version: "0.1.0" } },
        });
    },
    cancel() {
      stop();
    },
  });
}

function piStream(binary: string, prompt: CliPrompt, options: RunOptions): ReadableStream<Uint8Array> {
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stop = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const sse = new SseChannel(controller);
      let text = "";
      let stderr = "";
      let finished = false;

      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (error) sse.error(error);
        else if (!text.trim()) sse.error("Pi returned an empty reply.");
        else sse.done();
        stop = () => {};
        child?.kill();
      };

      timer = setTimeout(() => finish("Pi took longer than three minutes. Try a shorter question."), TIMEOUT_MS);

      let proc: ChildProcess;
      try {
        proc = spawn(
          binary,
          [
            "--print",
            "--mode",
            "json",
            // H-P1-07: do not hard-gate Pi tools/MCP. H-P4-21 wires TaCos MCP + cards.
            "--no-session",
            "--system-prompt",
            prompt.system,
            prompt.body,
          ],
          {
            cwd: agentCwd(),
            env: cliEnv(options.proxy),
            stdio: ["ignore", "pipe", "pipe"],
          }
        );
      } catch (err) {
        finish(err instanceof Error ? err.message : "Could not start Pi.");
        return;
      }
      child = proc;
      if (!proc.stdout || !proc.stderr) {
        finish("Pi did not provide a stream.");
        return;
      }
      stop = () => {
        finished = true;
        if (timer) clearTimeout(timer);
        proc.kill();
        sse.close();
      };

      const handle = (line: string) => {
        let message: {
          type?: string;
          assistantMessageEvent?: { type?: string; delta?: unknown };
          message?: { role?: string; content?: unknown };
        };
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type === "message_update" && message.assistantMessageEvent?.type === "text_delta") {
          const delta = message.assistantMessageEvent.delta;
          if (typeof delta === "string" && delta) {
            text += delta;
            sse.delta(delta);
          }
          return;
        }
        if (message.type === "agent_settled") {
          return finish();
        }
        if (message.type === "message_end" && !text.trim() && message.message?.role === "assistant") {
          const blocks = Array.isArray(message.message.content) ? message.message.content : [];
          const fallback = blocks
            .map((block) =>
              block && typeof block === "object" && (block as { type?: unknown }).type === "text"
                ? String((block as { text?: unknown }).text ?? "")
                : ""
            )
            .join("");
          if (fallback.trim()) {
            text = fallback;
            sse.delta(fallback);
          }
        }
      };

      let buffer = "";
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line) handle(line);
          if (finished) return;
          index = buffer.indexOf("\n");
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4_000);
      });
      proc.on("error", (err) => finish(`Could not start Pi: ${err.message}`));
      proc.on("exit", (code) => {
        if (!finished) finish(stderrTail(stderr, `Pi exited with code ${code ?? "unknown"}.`));
      });

      options.signal?.addEventListener("abort", stop, { once: true });
      if (options.signal?.aborted) stop();
    },
    cancel() {
      stop();
    },
  });
}

export function openCliStream(
  engine: CliEngine,
  prompt: CliPrompt,
  options: RunOptions
): ReadableStream<Uint8Array> {
  const status = requireCli(engine);
  if (!status.binary) throw new TacosError(`${status.label} is not available`, 400, status.hint ?? undefined);
  return engine === "codex"
    ? codexStream(status.binary, prompt, options)
    : piStream(status.binary, prompt, options);
}
