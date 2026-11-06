import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { userModelKeys } from "@/db/schema";
import { decryptKey } from "./ai-secret";
import { isServerMode } from "./server-mode";

// #79: the built-in API agent's endpoints. Kept out of model-keys so the key store itself
// never reads this server's environment (see check-deepseek-api-separate).
// --- built-in API agent (#79) ----------------------------------------------

type KeyRow = typeof userModelKeys.$inferSelect;

function modelList(row: Pick<KeyRow, "models">): string[] {
  return row.models.split("\n").filter(Boolean);
}

async function readRows(userId: string): Promise<KeyRow[]> {
  return getDb().select().from(userModelKeys).where(eq(userModelKeys.userId, userId));
}

export type AgentApiEndpoint = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  /** The model this endpoint answers inline edits with; the API agent's default. */
  editModel: string;
};

/**
 * A server operator's endpoint for the built-in API agent. Member API keys stay on each
 * member's computer (see check-runner), so a headless server gets this instead.
 */
export function envAgentApiEndpoint(): AgentApiEndpoint | null {
  const baseUrl = (process.env.TACOS_API_AGENT_BASE_URL ?? "").trim();
  const apiKey = (process.env.TACOS_API_AGENT_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  const models = (process.env.TACOS_API_AGENT_MODEL ?? "")
    .split(/[\s,]+/)
    .map((model) => model.trim())
    .filter(Boolean);
  return {
    id: "server-env",
    label: (process.env.TACOS_API_AGENT_LABEL ?? "Server API").trim() || "Server API",
    baseUrl,
    apiKey,
    models,
    editModel: models[0] ?? "",
  };
}

/**
 * Every endpoint the built-in loop may use for this viewer, best first. The endpoint
 * that answers inline edits leads; the rest are fallbacks. Empty when the viewer has no
 * model API (and the server has no env endpoint).
 */
export async function resolveAgentApiEndpoints(userId: string): Promise<AgentApiEndpoint[]> {
  const endpoints: AgentApiEndpoint[] = [];
  const env = envAgentApiEndpoint();
  if (env) endpoints.push(env);
  if (!isServerMode()) {
    const rows = await readRows(userId);
    rows.sort((a, b) => b.forEdits - a.forEdits);
    for (const row of rows) {
      const apiKey = decryptKey(row.apiKey);
      if (!apiKey) continue;
      const models = modelList(row);
      if (models.length === 0 && !row.editModel) continue;
      endpoints.push({
        id: row.provider,
        label: row.label || row.provider,
        baseUrl: row.baseUrl,
        apiKey,
        models: models.length ? models : [row.editModel],
        editModel: row.editModel || models[0],
      });
    }
  }
  return endpoints;
}

/** The API agent's model catalogue, one entry per model, endpoint label as the description. */
export async function agentApiModels(userId: string): Promise<{ id: string; label: string; description: string }[]> {
  const seen = new Set<string>();
  const models: { id: string; label: string; description: string }[] = [];
  for (const endpoint of await resolveAgentApiEndpoints(userId)) {
    for (const model of endpoint.models) {
      if (seen.has(model)) continue;
      seen.add(model);
      models.push({ id: model, label: model, description: endpoint.label });
    }
  }
  return models;
}

/** Put the endpoint that lists this model first; the rest stay as fallbacks. */
export function orderAgentApiEndpoints(
  endpoints: AgentApiEndpoint[],
  model: string
): AgentApiEndpoint[] {
  if (!model.trim()) return [...endpoints];
  return [...endpoints].sort((a, b) => {
    const aHas = a.models.includes(model) ? 0 : 1;
    const bHas = b.models.includes(model) ? 0 : 1;
    return aHas - bHas;
  });
}
