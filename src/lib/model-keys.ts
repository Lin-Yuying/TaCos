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
import { checkEndpointInput, keysForHarness, MAX_ENDPOINTS, type OwnApi } from "./model-endpoint";
import type { ModelAccess } from "./harness/models";
import { FIRST_CLASS_HARNESS_IDS } from "./harness/registry";
import type { DetectResult, HarnessId, HarnessKeys } from "./harness/types";
import { TacosError } from "./issues";
import { runnerViewFor } from "./runner/hub";
import { isServerMode } from "./server-mode";

type KeyRow = typeof userModelKeys.$inferSelect;

function modelList(row: Pick<KeyRow, "models">): string[] {
  return row.models.split("\n").filter(Boolean);
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

function refuseOnServer(): void {
  if (isServerMode()) {
    throw new TacosError("Model APIs stay on each member's computer", 400, "Open TaCos on your own computer to change them.");
  }
}

/**
 * Adds an API, or changes one when `id` is set. A blank key keeps the stored one, and blank models
 * are read from the API itself. Refuses a key the service turned down.
 */
export async function saveModelEndpoint(
  userId: string,
  input: { id?: string; label: string; baseUrl: string; key: string; models: string }
): Promise<{ verified: boolean }> {
  refuseOnServer();
  const rows = await readRows(userId);
  const existing = input.id ? rows.find((row) => row.provider === input.id) : undefined;
  if (input.id && !existing) throw new TacosError("This API no longer exists", 400);
  if (!existing && rows.length >= MAX_ENDPOINTS) throw new TacosError("Too many APIs");
  const { label, baseUrl, key, models, verified } = await checkEndpointInput(
    input,
    existing && { baseUrl: existing.baseUrl, apiKey: decryptKey(existing.apiKey) ?? "" }
  );

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
  refuseOnServer();
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

async function readApis(userId: string): Promise<OwnApi[]> {
  const apis: OwnApi[] = [];
  for (const row of await readRows(userId)) {
    const apiKey = decryptKey(row.apiKey);
    if (apiKey) apis.push({ id: row.provider, label: row.label, baseUrl: row.baseUrl, apiKey, models: modelList(row) });
  }
  return apis;
}

/** This person's APIs in the form one harness reads them. Null when it has none it can use. */
export async function harnessKeysFor(userId: string, harness: HarnessId): Promise<HarnessKeys | null> {
  return keysForHarness(await readApis(userId), harness);
}

/** Harnesses this person can run on their own APIs, whatever this machine is signed in to. */
export async function harnessesWithKeys(userId: string): Promise<HarnessId[]> {
  if (isServerMode()) return (await runnerViewFor(userId)).capabilities?.keyed ?? [];
  const apis = await readApis(userId);
  return FIRST_CLASS_HARNESS_IDS.filter((id) => keysForHarness(apis, id));
}

/**
 * The harness settings arguments for one viewer. On a server the harnesses are the ones their own
 * computer last reported.
 */
export async function harnessViewFor(userId: string): Promise<[HarnessId[], DetectResult[] | undefined]> {
  if (!isServerMode()) return [await harnessesWithKeys(userId), undefined];
  const { capabilities } = await runnerViewFor(userId);
  return [capabilities?.keyed ?? [], capabilities?.harnesses];
}

export async function modelAccessFor(userId: string): Promise<ModelAccess> {
  const keys = await harnessKeysFor(userId, "pi");
  return { endpoints: keys?.endpoints ?? [], signedIn: signedInHarnesses() };
}
