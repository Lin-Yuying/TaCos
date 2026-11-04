/**
 * A member's own model APIs: an address and a key, whichever service that is. Each one belongs
 * to one person. It reaches a harness as an environment variable on that person's own turn and
 * pays for that person's inline edits. Nobody else's turn sees it.
 */
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { userModelKeys } from "@/db/schema";
import type { ModelKeysView } from "./ai-constants";
import { decryptKey, encryptKey } from "./ai-secret";
import { signedInHarnesses } from "./harness/gate";
import type { ModelAccess } from "./harness/models";
import { FIRST_CLASS_HARNESS_IDS } from "./harness/registry";
import type { HarnessId, HarnessKeys } from "./harness/types";
import { TacosError } from "./issues";

const MAX_KEY = 4_000;
const MAX_MODEL = 120;
const MAX_LABEL = 60;
const MAX_ENDPOINTS = 20;
const MAX_MODELS = 200;
const VERIFY_TIMEOUT_MS = 10_000;
// dsh only talks to DeepSeek, and only reads this variable.
const DSH_HOST = "api.deepseek.com";

type KeyRow = typeof userModelKeys.$inferSelect;

function modelList(row: Pick<KeyRow, "models">): string[] {
  return row.models.split("\n").filter(Boolean);
}

// The id holds only hex after its prefix, so this is always a legal variable name.
function envVarOf(row: KeyRow): string {
  return `TACOS_MODEL_KEY_${row.provider.replace(/^endpoint-/, "").toUpperCase()}`;
}

async function readRows(userId: string): Promise<KeyRow[]> {
  return getDb().select().from(userModelKeys).where(eq(userModelKeys.userId, userId));
}

export async function getModelKeysView(userId: string): Promise<ModelKeysView> {
  const view: ModelKeysView = { endpoints: [], editProvider: null, editModel: "" };
  for (const row of await readRows(userId)) {
    const key = decryptKey(row.apiKey);
    if (!key) continue;
    view.endpoints.push({
      id: row.provider,
      label: row.label,
      baseUrl: row.baseUrl,
      models: modelList(row),
      keyHint: `••••${key.slice(-4)}`,
    });
    if (row.forEdits === 1) {
      view.editProvider = row.provider;
      view.editModel = row.editModel;
    }
  }
  return view;
}

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
 * Adds an API, or changes one when `id` is set. A blank key keeps the stored one, and blank models
 * are read from the API itself. Refuses a key the service turned down.
 */
export async function saveModelEndpoint(
  userId: string,
  input: { id?: string; label: string; baseUrl: string; key: string; models: string }
): Promise<{ verified: boolean }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const label = input.label.trim() || new URL(baseUrl).hostname;
  if (label.length > MAX_LABEL) throw new TacosError("Name is too long");
  const key = input.key.trim();
  if (key.length > MAX_KEY) throw new TacosError("API key is too long");
  let models = [...new Set(input.models.split(/[\s,]+/).filter(Boolean))];

  const rows = await readRows(userId);
  const existing = input.id ? rows.find((row) => row.provider === input.id) : undefined;
  if (input.id && !existing) throw new TacosError("This API no longer exists", 400);
  if (!existing && rows.length >= MAX_ENDPOINTS) throw new TacosError("Too many APIs");
  // The stored key must not follow a changed address to a server it was never meant for.
  if (!key && (!existing || existing.baseUrl !== baseUrl)) throw new TacosError("API key is required");

  let verified = false;
  if (key || models.length === 0) {
    const checked = await probe(baseUrl, key || decryptKey(existing?.apiKey ?? "") || "");
    if (checked.result === "rejected") throw new TacosError("The service rejected this API key");
    verified = checked.result === "ok";
    if (models.length === 0) models = checked.models;
  }
  if (models.length === 0) throw new TacosError("Could not read this API's models. Enter the model names.");
  models = models.slice(0, MAX_MODELS);
  if (models.some((model) => model.length > MAX_MODEL)) throw new TacosError("Model name is too long");

  const updatedAt = new Date().toISOString();
  const joined = models.join("\n");
  if (existing) {
    await getDb()
      .update(userModelKeys)
      .set({
        label,
        baseUrl,
        models: joined,
        updatedAt,
        // A model taken off the list must not stay behind as the inline-edit choice.
        editModel: models.includes(existing.editModel) ? existing.editModel : models[0],
        ...(key ? { apiKey: encryptKey(key) } : {}),
      })
      .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, existing.provider)));
  } else {
    await getDb()
      .insert(userModelKeys)
      .values({
        userId,
        provider: `endpoint-${crypto.randomBytes(6).toString("hex")}`,
        apiKey: encryptKey(key),
        editModel: models[0],
        // The first API starts doing inline edits; a later one waits to be picked.
        forEdits: rows.some((row) => row.forEdits === 1) ? 0 : 1,
        label,
        baseUrl,
        models: joined,
        updatedAt,
      });
  }
  return { verified };
}

export async function removeModelEndpoint(userId: string, id: string): Promise<void> {
  await getDb()
    .delete(userModelKeys)
    .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, id)));
  const rows = await readRows(userId);
  if (rows.length === 0 || rows.some((row) => row.forEdits === 1)) return;
  await getDb()
    .update(userModelKeys)
    .set({ forEdits: 1 })
    .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, rows[0].provider)));
}

export async function saveEditModel(userId: string, id: string, model: string): Promise<void> {
  const rows = await readRows(userId);
  const row = rows.find((entry) => entry.provider === id);
  if (!row || !modelList(row).includes(model)) throw new TacosError("This API no longer exists", 400);
  const db = getDb();
  await db.update(userModelKeys).set({ forEdits: 0 }).where(eq(userModelKeys.userId, userId));
  await db
    .update(userModelKeys)
    .set({ forEdits: 1, editModel: model })
    .where(and(eq(userModelKeys.userId, userId), eq(userModelKeys.provider, id)));
}

/** What this person's inline edits and task drafts call, or null when they have nothing set up. */
export async function resolveEditConfig(
  userId: string
): Promise<{ baseUrl: string; model: string; apiKey: string } | null> {
  const row = (await readRows(userId)).find((entry) => entry.forEdits === 1);
  const apiKey = row && decryptKey(row.apiKey);
  if (!row || !apiKey || !row.editModel) return null;
  return { baseUrl: row.baseUrl, model: row.editModel, apiKey };
}

/** This person's APIs in the form one harness reads them. Null when it has none it can use. */
export async function harnessKeysFor(userId: string, harness: HarnessId): Promise<HarnessKeys | null> {
  const keys: HarnessKeys = { env: {}, endpoints: [] };
  for (const row of await readRows(userId)) {
    const key = decryptKey(row.apiKey);
    if (!key) continue;
    if (harness === "dsh") {
      if (new URL(row.baseUrl).hostname === DSH_HOST) keys.env.DEEPSEEK_API_KEY = key;
      continue;
    }
    const envVar = envVarOf(row);
    keys.env[envVar] = key;
    keys.endpoints.push({ id: row.provider, label: row.label, baseUrl: row.baseUrl, envVar, models: modelList(row) });
  }
  return Object.keys(keys.env).length > 0 ? keys : null;
}

/** Harnesses this person can run on their own APIs, whatever this machine is signed in to. */
export async function harnessesWithKeys(userId: string): Promise<HarnessId[]> {
  const ids = [...FIRST_CLASS_HARNESS_IDS];
  const keys = await Promise.all(ids.map((id) => harnessKeysFor(userId, id)));
  return ids.filter((_, index) => keys[index]);
}

export async function modelAccessFor(userId: string): Promise<ModelAccess> {
  const keys = await harnessKeysFor(userId, "pi");
  return { endpoints: keys?.endpoints ?? [], signedIn: signedInHarnesses() };
}
