/**
 * A member's own model APIs on their own computer, in one file only they can read. The server
 * never holds these. The desktop app loads this module directly to change them; the runner reads
 * the same file for each turn.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelKeysView } from "@/lib/ai-constants";
import { checkEndpointInput, MAX_ENDPOINTS } from "@/lib/model-endpoint";
import type { RunnerConfig } from "@/lib/runner/protocol";
import { TacosError } from "@/lib/tacos-error";

function configPath(): string {
  return path.join(process.env.TACOS_RUNNER_DIR || path.join(os.homedir(), ".tacos", "runner"), "config.json");
}

export function readConfig(): RunnerConfig {
  try {
    return {
      endpoints: [],
      editProvider: null,
      editModel: "",
      proxy: "",
      ...(JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<RunnerConfig>),
    };
  } catch {
    return { endpoints: [], editProvider: null, editModel: "", proxy: "" };
  }
}

function writeConfig(config: RunnerConfig): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

export function listKeys(): ModelKeysView {
  const config = readConfig();
  return {
    endpoints: config.endpoints.map((endpoint) => ({
      id: endpoint.id,
      label: endpoint.label,
      baseUrl: endpoint.baseUrl,
      models: endpoint.models,
      keyHint: `••••${endpoint.apiKey.slice(-4)}`,
    })),
    editProvider: config.editProvider,
    editModel: config.editModel,
  };
}

export async function saveKey(input: {
  id?: string;
  label: string;
  baseUrl: string;
  key: string;
  models: string;
}): Promise<{ view: ModelKeysView; verified: boolean }> {
  const config = readConfig();
  const existing = input.id ? config.endpoints.find((endpoint) => endpoint.id === input.id) : undefined;
  if (input.id && !existing) throw new TacosError("This API no longer exists", 400);
  if (!existing && config.endpoints.length >= MAX_ENDPOINTS) throw new TacosError("Too many APIs");
  const { label, baseUrl, key, models, verified } = await checkEndpointInput(input, existing);
  if (existing) {
    Object.assign(existing, { label, baseUrl, models, apiKey: key || existing.apiKey });
    // A model taken off the list must not stay behind as the inline-edit choice.
    if (config.editProvider === existing.id && !models.includes(config.editModel)) config.editModel = models[0];
  } else {
    const id = `endpoint-${crypto.randomBytes(6).toString("hex")}`;
    config.endpoints.push({ id, label, baseUrl, apiKey: key, models });
    // The first API starts doing inline edits; a later one waits to be picked.
    if (!config.editProvider) {
      config.editProvider = id;
      config.editModel = models[0];
    }
  }
  writeConfig(config);
  return { view: listKeys(), verified };
}

export function removeKey(id: string): ModelKeysView {
  const config = readConfig();
  config.endpoints = config.endpoints.filter((endpoint) => endpoint.id !== id);
  if (config.editProvider === id) {
    config.editProvider = config.endpoints[0]?.id ?? null;
    config.editModel = config.endpoints[0]?.models[0] ?? "";
  }
  writeConfig(config);
  return listKeys();
}

export function setEditModel(id: string, model: string): ModelKeysView {
  const config = readConfig();
  const endpoint = config.endpoints.find((entry) => entry.id === id);
  if (!endpoint?.models.includes(model)) throw new TacosError("This API no longer exists", 400);
  config.editProvider = id;
  config.editModel = model;
  writeConfig(config);
  return listKeys();
}
