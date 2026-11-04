/** Rules for one model API, shared by the database store and a member computer's own file. */
import type { HarnessId, HarnessKeys } from "./harness/types";
import { TacosError } from "./tacos-error";

const MAX_KEY = 4_000;
const MAX_MODEL = 120;
const MAX_LABEL = 60;
export const MAX_ENDPOINTS = 20;
const MAX_MODELS = 200;
const VERIFY_TIMEOUT_MS = 10_000;
// dsh only talks to DeepSeek, and only reads this variable.
const DSH_HOST = "api.deepseek.com";

export type OwnApi = { id: string; label: string; baseUrl: string; apiKey: string; models: string[] };

// "unknown" means the service gave no usable answer, which says nothing about the key: this server
// may need a proxy, or the service may have no model list.
async function probe(baseUrl: string, key: string): Promise<{ result: "ok" | "rejected" | "unknown"; models: string[] }> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      // A redirect must not carry the key to an address nobody typed.
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return { result: "rejected", models: [] };
    const text = await response.text();
    if (response.status === 400 && text.includes("API_KEY_INVALID")) return { result: "rejected", models: [] };
    if (!response.ok) return { result: "unknown", models: [] };
    const data = (JSON.parse(text) as { data?: { id?: unknown }[] }).data ?? [];
    const models = data.map((entry) => entry.id).filter((id): id is string => typeof id === "string");
    return { result: "ok", models };
  } catch {
    return { result: "unknown", models: [] };
  }
}

function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new TacosError("Enter the API's full address, starting with http:// or https://");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new TacosError("Enter the API's full address, starting with http:// or https://");
  }
  return `${url.origin}${url.pathname}`.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

/**
 * Checks a new or changed API. A blank key keeps the stored one, and blank models are read from
 * the API itself. Refuses a key the service turned down.
 */
export async function checkEndpointInput(
  input: { label: string; baseUrl: string; key: string; models: string },
  existing?: { baseUrl: string; apiKey: string }
): Promise<{ label: string; baseUrl: string; key: string; models: string[]; verified: boolean }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const label = input.label.trim() || new URL(baseUrl).hostname;
  if (label.length > MAX_LABEL) throw new TacosError("Name is too long");
  const key = input.key.trim();
  if (key.length > MAX_KEY) throw new TacosError("API key is too long");
  let models = [...new Set(input.models.split(/[\s,]+/).filter(Boolean))];
  // The stored key must not follow a changed address to a server it was never meant for.
  if (!key && (!existing || existing.baseUrl !== baseUrl)) throw new TacosError("API key is required");

  let verified = false;
  if (key || models.length === 0) {
    const checked = await probe(baseUrl, key || existing?.apiKey || "");
    if (checked.result === "rejected") throw new TacosError("The service rejected this API key");
    verified = checked.result === "ok";
    if (models.length === 0) models = checked.models;
  }
  if (models.length === 0) throw new TacosError("Could not read this API's models. Enter the model names.");
  models = models.slice(0, MAX_MODELS);
  if (models.some((model) => model.length > MAX_MODEL)) throw new TacosError("Model name is too long");
  return { label, baseUrl, key, models, verified };
}

/** One person's APIs in the form one harness reads them. Null when it has none it can use. */
export function keysForHarness(apis: OwnApi[], harness: HarnessId): HarnessKeys | null {
  const keys: HarnessKeys = { env: {}, endpoints: [] };
  for (const api of apis) {
    if (harness === "dsh") {
      if (new URL(api.baseUrl).hostname === DSH_HOST) keys.env.DEEPSEEK_API_KEY = api.apiKey;
      continue;
    }
    // The id holds only hex after its prefix, so this is always a legal variable name.
    const envVar = `TACOS_MODEL_KEY_${api.id.replace(/^endpoint-/, "").toUpperCase()}`;
    keys.env[envVar] = api.apiKey;
    keys.endpoints.push({ id: api.id, label: api.label, baseUrl: api.baseUrl, envVar, models: api.models });
  }
  return Object.keys(keys.env).length > 0 ? keys : null;
}
