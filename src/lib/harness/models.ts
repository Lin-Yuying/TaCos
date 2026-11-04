/**
 * Models each harness CLI says it can run on this machine. The CLI is the only authority:
 * a provider added to OpenCode or Pi shows up here without TaCos knowing about it.
 * Model ids belong to one harness; they mean nothing to another.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CodexModel } from "@/lib/ai-constants";
import { EFFORT_LABELS, listCodexModels } from "@/lib/cli-agents";
import { findHarnessBinary } from "./detect-bin";
import type { HarnessId, HarnessKeys, ModelOption } from "./types";

const execFileAsync = promisify(execFile);

const CACHE_MS = 5 * 60_000;
const RETRY_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;

// OpenCode names its variants freely; known levels sort low to high, the rest follow.
const EFFORT_ORDER = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
const PI_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];
const DSH_EFFORTS = ["off", "low", "high", "max"];
// Used when the installed dsh package cannot be read. dsh passes the id through as is.
const DSH_FALLBACK_MODELS: ModelOption[] = [
  { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", efforts: effortLevels(DSH_EFFORTS) },
  { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro", efforts: effortLevels(DSH_EFFORTS) },
];

/** "" leaves the level to the harness, so a pick can always be taken back. */
function effortLevels(ids: string[]): { id: string; label: string }[] {
  if (ids.length === 0) return [];
  return [{ id: "", label: "Default" }, ...ids.map((id) => ({ id, label: EFFORT_LABELS[id] ?? id }))];
}

async function runCli(binary: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(binary, args, {
    encoding: "utf8",
    timeout: READ_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  return stdout;
}

/** `opencode models --verbose`: a "provider/model" line, then that model's JSON. */
export function parseOpencodeModels(output: string): ModelOption[] {
  const headers = [...output.matchAll(/^(\S+\/\S+)\n(?=\{)/gm)];
  const models: ModelOption[] = [];
  headers.forEach((header, index) => {
    const start = header.index + header[0].length;
    let detail: { name?: string; status?: string; variants?: Record<string, unknown> } = {};
    try {
      detail = JSON.parse(output.slice(start, headers[index + 1]?.index ?? output.length));
    } catch {
      // Still a model OpenCode offers, just without a display name or variants.
    }
    if (detail.status === "deprecated") return;
    const rank = (id: string) => {
      const at = EFFORT_ORDER.indexOf(id);
      return at < 0 ? EFFORT_ORDER.length : at;
    };
    const variants = Object.keys(detail.variants ?? {}).sort((a, b) => rank(a) - rank(b));
    models.push({
      id: header[1],
      label: detail.name || header[1],
      description: header[1],
      efforts: effortLevels(variants),
    });
  });
  return models;
}

/** `pi --list-models`: provider, model, context, max-out, thinking, images. */
export function parsePiModels(output: string): ModelOption[] {
  const models: ModelOption[] = [];
  output.split("\n").forEach((line, index) => {
    const fields = line.trim().split(/\s+/);
    if (index === 0 || fields.length < 5) return;
    const id = `${fields[0]}/${fields[1]}`;
    models.push({
      id,
      label: fields[1],
      description: id,
      efforts: effortLevels(fields[4] === "yes" ? PI_EFFORTS : []),
    });
  });
  return models;
}

/** codebuddy has no list command; `--help` spells out the ids and effort levels. */
export function parseCodebuddyModels(help: string): ModelOption[] {
  const list = (flag: string, prefix: string) =>
    (new RegExp(`${flag}[^\\n]*${prefix}\\(([^)]*)\\)`).exec(help)?.[1] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const efforts = effortLevels(list("--effort <level>", ""));
  return list("--model <model>", "Currently supported: ").map((id) => ({ id, label: id, efforts }));
}

/** dsh has no list command either; its catalog ships in the installed provider package. */
export function parseDshModels(source: string): ModelOption[] {
  const block = /const DEFAULT_MODELS = \[([\s\S]*?)\];/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/id: "([^"]+)",\s*name: "([^"]+)"/g)].map((match) => ({
    id: match[1],
    label: match[2],
    description: match[1],
    efforts: effortLevels(DSH_EFFORTS),
  }));
}

function readDshModels(binary: string): ModelOption[] {
  const relative = path.join("node_modules", "@deepseek-ai", "dsh-llm-deepseek", "lib", "index.js");
  try {
    let dir = path.dirname(fs.realpathSync(binary));
    for (;;) {
      const file = path.join(dir, relative);
      if (fs.existsSync(file)) {
        const models = parseDshModels(fs.readFileSync(file, "utf8"));
        if (models.length > 0) return models;
        break;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    // Unusual install layout: the two official models still work.
  }
  return DSH_FALLBACK_MODELS;
}

async function readModels(id: Exclude<HarnessId, "codex">, binary: string): Promise<ModelOption[]> {
  switch (id) {
    case "opencode":
      return parseOpencodeModels(await runCli(binary, ["models", "--verbose"]));
    case "pi":
      return parsePiModels(await runCli(binary, ["--offline", "--list-models"]));
    case "codebuddy":
      return parseCodebuddyModels(await runCli(binary, ["--help"]));
    case "dsh":
      return readDshModels(binary);
  }
}

type CacheEntry = { at: number; ttl: number; value: ModelOption[] };
const cache = new Map<HarnessId, CacheEntry>();
const reading = new Map<HarnessId, Promise<ModelOption[]>>();

/** The CLI's own models, first entry "use the harness's setting". Empty when none could be read. */
export async function listHarnessModels(id: Exclude<HarnessId, "codex">): Promise<ModelOption[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const pending = reading.get(id);
  if (pending) return pending;
  const read = (async () => {
    const binary = findHarnessBinary(id);
    let value: ModelOption[] = [];
    try {
      if (binary) value = await readModels(id, binary);
    } catch {
      // Reported by the composer as "could not read"; retried below.
    }
    if (value.length === 0) {
      // A failed read must not wipe a list that worked a minute ago.
      const kept = binary ? (hit?.value ?? []) : [];
      cache.set(id, { at: Date.now(), ttl: RETRY_MS, value: kept });
      return kept;
    }
    const withDefault: ModelOption[] = [
      { id: "", label: "Default model", description: "Uses this harness's own setting.", efforts: [] },
      ...value,
    ];
    cache.set(id, { at: Date.now(), ttl: CACHE_MS, value: withDefault });
    return withDefault;
  })().finally(() => reading.delete(id));
  reading.set(id, read);
  return read;
}

export function clearHarnessModelCache(): void {
  cache.clear();
}

function toComposerModel(model: ModelOption): CodexModel {
  return {
    slug: model.id,
    label: model.label,
    description: model.description ?? "",
    defaultEffort: "",
    efforts: model.efforts ?? [],
    priority: 99,
    fast: false,
  };
}

/** What one person can spend: their own APIs, and what the harnesses bring themselves (see signedInHarnesses). */
export type ModelAccess = { endpoints: HarnessKeys["endpoints"]; signedIn: HarnessId[] };

async function composerModels(id: HarnessId, access: ModelAccess): Promise<CodexModel[]> {
  // dsh passes its catalog ids to DeepSeek and cannot talk to anything else.
  if (id === "dsh") return (await listHarnessModels("dsh")).map(toComposerModel);
  const own = access.endpoints.flatMap((endpoint) =>
    endpoint.models.map((model) =>
      toComposerModel({ id: `${endpoint.id}/${model}`, label: model, description: endpoint.label, efforts: [] })
    )
  );
  if (!access.signedIn.includes(id)) return own;
  const listed = id === "codex" ? listCodexModels() : (await listHarnessModels(id)).map(toComposerModel);
  return [...listed, ...own];
}

export async function listComposerModels(
  ids: HarnessId[],
  access: ModelAccess
): Promise<Partial<Record<HarnessId, CodexModel[]>>> {
  const lists = await Promise.all(ids.map(async (id) => [id, await composerModels(id, access)] as const));
  return Object.fromEntries(lists);
}

/**
 * The model a turn should really ask for. A thread can hold an id its harness no longer
 * offers (the model was removed, or the thread predates this check); passing it on would
 * only fail the turn, so it falls back to what the person can still spend.
 */
export async function resolveTurnModel(
  id: HarnessId,
  model: string,
  effort: string,
  access: ModelAccess
): Promise<{ model: string | null; effort: string | null }> {
  const list = await composerModels(id, access);
  // Nothing to check against: let the CLI judge the id and report its own error.
  if (model && list.length === 0) return { model, effort: effort || null };
  const entry = model ? list.find((candidate) => candidate.slug === model) : undefined;
  if (entry) return { model, effort: entry.efforts.some((level) => level.id === effort) ? effort || null : null };
  // Without a subscription there is no harness default: the first of the person's own APIs runs it.
  if (id !== "dsh" && !access.signedIn.includes(id) && list[0]?.slug) return { model: list[0].slug, effort: null };
  return { model: null, effort: !model && id === "codex" ? effort || null : null };
}
