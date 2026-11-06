import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { projects, users, workspaceAgents } from "@/db/schema";
import { getWorkspaceHarnessGate } from "@/lib/harness";
import { harnessViewFor } from "@/lib/model-keys";
import { resolveAgentApiEndpoints } from "@/lib/agent-api-config";
import { runnerViewFor } from "@/lib/runner/hub";
import { isServerMode } from "@/lib/server-mode";
import { TacosError } from "@/lib/tacos-error";

// #79: agents are teammates with an identity. A workspace can name shared agents; each
// member also has one personal agent (the old "hand my task to my Agent" run). Delegation
// never replaces the human assignee.

export type AgentSource = "harness" | "api";
export type AgentApproval = "ask" | "auto" | "full";
export type AgentRunSource = "runner" | "api";

export type AgentView = {
  id: string;
  name: string;
  description: string;
  source: AgentSource;
  engine: string;
  model: string;
  approval: AgentApproval;
  projectIds: string[];
  enabled: boolean;
  personal: boolean;
  createdBy: string;
  createdByName: string;
  mine: boolean;
  available: boolean;
  availabilityHint: string | null;
};

export type AgentOption = {
  id: string;
  name: string;
  source: AgentSource;
  engine: string;
  model: string;
  personal: boolean;
  available: boolean;
  hint: string | null;
};

const SOURCES: AgentSource[] = ["harness", "api"];
const APPROVALS: AgentApproval[] = ["ask", "auto", "full"];
const DEFAULT_PERSONAL_NAME = "My agent";

export function asAgentSource(value: unknown): AgentSource {
  return value === "api" ? "api" : "harness";
}

export function asAgentApproval(value: unknown): AgentApproval {
  return value === "auto" || value === "full" ? value : "ask";
}

function projectIdsOf(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function availability(workspaceId: string, userId: string, source: AgentSource, engine: string): Promise<{ available: boolean; hint: string | null }> {
  if (source === "api") {
    const endpoints = await resolveAgentApiEndpoints(userId);
    return endpoints.length
      ? { available: true, hint: null }
      : {
          available: false,
          hint: isServerMode()
            ? "The server has no API agent endpoint. Set TACOS_API_AGENT_BASE_URL and TACOS_API_AGENT_KEY, or run TaCos on your computer."
            : "Add your API key in Settings → Model API.",
        };
  }
  if (isServerMode()) {
    const { online, capabilities } = await runnerViewFor(userId);
    const found = capabilities?.harnesses.find((item) => item.id === engine);
    if (!online || !capabilities) {
      return { available: false, hint: "Open TaCos on your computer to run this agent." };
    }
    if (!found?.ready && !capabilities.keyed.includes(engine as never)) {
      return { available: false, hint: found?.hint ?? "This harness is not ready on your computer." };
    }
    return { available: true, hint: null };
  }
  const gate = await getWorkspaceHarnessGate(workspaceId, ...(await harnessViewFor(userId)));
  const found = gate.enabledReady.find((row) => row.id === engine);
  return found
    ? { available: true, hint: null }
    : { available: false, hint: "Install or enable this harness in Settings → Harness." };
}

async function creatorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const rows = await getDb()
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

async function toViews(
  workspaceId: string,
  userId: string,
  rows: (typeof workspaceAgents.$inferSelect)[]
): Promise<AgentView[]> {
  const names = await creatorNames(rows.map((row) => row.createdBy));
  const checks = new Map<string, { available: boolean; hint: string | null }>();
  for (const row of rows) {
    const key = `${row.source}:${row.engine}`;
    if (!checks.has(key)) checks.set(key, await availability(workspaceId, userId, asAgentSource(row.source), row.engine));
  }
  return rows.map((row) => {
    const check = checks.get(`${row.source}:${row.engine}`) ?? { available: true, hint: null };
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      source: asAgentSource(row.source),
      engine: row.engine,
      model: row.model,
      approval: asAgentApproval(row.approval),
      projectIds: projectIdsOf(row.projectIds),
      enabled: Boolean(row.enabled),
      personal: Boolean(row.personal),
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? "Member",
      mine: row.createdBy === userId,
      // A disabled agent still appears in Settings; delegation refuses it below.
      available: Boolean(row.enabled) && check.available,
      availabilityHint: row.enabled ? check.hint : "This agent is turned off.",
    };
  });
}

export async function listAgents(workspaceId: string, userId: string): Promise<AgentView[]> {
  const rows = await getDb()
    .select()
    .from(workspaceAgents)
    .where(
      and(
        eq(workspaceAgents.workspaceId, workspaceId),
        sql`(${workspaceAgents.personal} = 0 OR ${workspaceAgents.createdBy} = ${userId})`
      )
    )
    .orderBy(desc(workspaceAgents.personal), desc(workspaceAgents.createdAt));
  return toViews(workspaceId, userId, rows);
}

export async function getAgentView(
  workspaceId: string,
  userId: string,
  agentId: string
): Promise<AgentView | null> {
  const [row] = await getDb()
    .select()
    .from(workspaceAgents)
    .where(and(eq(workspaceAgents.workspaceId, workspaceId), eq(workspaceAgents.id, agentId)))
    .limit(1);
  if (!row) return null;
  if (row.personal && row.createdBy !== userId) return null;
  return (await toViews(workspaceId, userId, [row]))[0] ?? null;
}

/** The old handoff behaviour, now identified as one personal agent per member. */
export async function ensurePersonalAgent(workspaceId: string, userId: string): Promise<AgentView> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(workspaceAgents)
    .where(
      and(
        eq(workspaceAgents.workspaceId, workspaceId),
        eq(workspaceAgents.personal, 1),
        eq(workspaceAgents.createdBy, userId)
      )
    )
    .limit(1);
  if (existing) {
    return (await toViews(workspaceId, userId, [existing]))[0];
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    await db.insert(workspaceAgents).values({
    id,
    workspaceId,
    name: DEFAULT_PERSONAL_NAME,
    description: "Your own agent. It runs on your computer, or on your model API.",
    source: "harness",
    engine: "codex",
    model: "",
    approval: "ask",
    projectIds: "[]",
    enabled: 1,
    personal: 1,
    createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    // Two polls raced; the other request created it.
    const [raced] = await db
      .select()
      .from(workspaceAgents)
      .where(
        and(
          eq(workspaceAgents.workspaceId, workspaceId),
          eq(workspaceAgents.personal, 1),
          eq(workspaceAgents.createdBy, userId)
        )
      )
      .limit(1);
    if (raced) return (await toViews(workspaceId, userId, [raced]))[0];
    throw new TacosError("Could not create your agent", 500);
  }
  const [row] = await db.select().from(workspaceAgents).where(eq(workspaceAgents.id, id)).limit(1);
  return (await toViews(workspaceId, userId, [row]))[0];
}

async function validateProjects(workspaceId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await getDb()
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, workspaceId), inArray(projects.id, unique), sql`${projects.deletedAt} IS NULL`)
    );
  if (rows.length !== unique.length) throw new TacosError("Pick projects from this workspace", 400);
  return rows.map((row) => row.id);
}

export async function createAgent(input: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string;
  source: string;
  engine?: string;
  model?: string;
  approval?: string;
  projectIds?: string[];
  personal?: boolean;
}): Promise<AgentView> {
  const name = input.name.trim();
  if (!name) throw new TacosError("Name the agent", 400);
  if (name.length > 80) throw new TacosError("Agent name is too long", 400);
  const source = asAgentSource(input.source);
  const engine = source === "api" ? "api" : (input.engine ?? "codex").trim();
  const projectIds = await validateProjects(input.workspaceId, input.projectIds ?? []);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await getDb().insert(workspaceAgents).values({
    id,
    workspaceId: input.workspaceId,
    name,
    description: (input.description ?? "").trim().slice(0, 500),
    source,
    engine,
    model: (input.model ?? "").trim().slice(0, 200),
    approval: asAgentApproval(input.approval),
    projectIds: JSON.stringify(projectIds),
    enabled: 1,
    personal: input.personal ? 1 : 0,
    createdBy: input.userId,
    createdAt: now,
    updatedAt: now,
  });
  return (await getAgentView(input.workspaceId, input.userId, id))!;
}

export async function updateAgent(input: {
  workspaceId: string;
  userId: string;
  agentId: string;
  patch: {
    name?: string;
    description?: string;
    source?: string;
    engine?: string;
    model?: string;
    approval?: string;
    projectIds?: string[];
    enabled?: boolean;
  };
}): Promise<AgentView> {
  const current = await getAgentView(input.workspaceId, input.userId, input.agentId);
  if (!current) throw new TacosError("Agent not found", 404);
  if (current.personal && !current.mine) throw new TacosError("Not your agent", 403);
  const db = getDb();
  const [row] = await db.select().from(workspaceAgents).where(eq(workspaceAgents.id, input.agentId)).limit(1);
  const source = input.patch.source ? asAgentSource(input.patch.source) : asAgentSource(row.source);
  const patch: Partial<typeof workspaceAgents.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (input.patch.name !== undefined) {
    const name = input.patch.name.trim();
    if (!name) throw new TacosError("Name the agent", 400);
    patch.name = name.slice(0, 80);
  }
  if (input.patch.description !== undefined) patch.description = input.patch.description.trim().slice(0, 500);
  if (input.patch.source !== undefined) patch.source = source;
  if (input.patch.engine !== undefined) patch.engine = source === "api" ? "api" : input.patch.engine.trim();
  if (input.patch.model !== undefined) patch.model = input.patch.model.trim().slice(0, 200);
  if (input.patch.approval !== undefined) patch.approval = asAgentApproval(input.patch.approval);
  if (input.patch.projectIds !== undefined) {
    patch.projectIds = JSON.stringify(await validateProjects(input.workspaceId, input.patch.projectIds));
  }
  if (input.patch.enabled !== undefined) patch.enabled = input.patch.enabled ? 1 : 0;
  await db.update(workspaceAgents).set(patch).where(eq(workspaceAgents.id, input.agentId));
  return (await getAgentView(input.workspaceId, input.userId, input.agentId))!;
}

export async function deleteAgent(workspaceId: string, userId: string, agentId: string): Promise<void> {
  const current = await getAgentView(workspaceId, userId, agentId);
  if (!current) throw new TacosError("Agent not found", 404);
  if (current.personal && !current.mine) throw new TacosError("Not your agent", 403);
  await getDb()
    .delete(workspaceAgents)
    .where(and(eq(workspaceAgents.workspaceId, workspaceId), eq(workspaceAgents.id, agentId)));
}

/** Agents this viewer can delegate to, with availability said plainly. */
export async function delegateOptions(workspaceId: string, userId: string): Promise<AgentOption[]> {
  const personal = await ensurePersonalAgent(workspaceId, userId);
  const all = await listAgents(workspaceId, userId);
  const list = [personal, ...all.filter((agent) => agent.id !== personal.id)];
  return list
    .filter((agent) => agent.enabled)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      source: agent.source,
      engine: agent.engine,
      model: agent.model,
      personal: agent.personal,
      available: agent.available,
      hint: agent.availabilityHint,
    }));
}

export type ResolvedAgent = AgentView & { runSource: AgentRunSource; resolvedEngine: string };

/**
 * The agent a delegation actually runs with. API agents always run in-process. A harness
 * agent falls back to the API loop when the member's computer is away and they have a
 * model API, which is recorded on the run so the panel can show it.
 */
export async function resolveDelegationAgent(input: {
  workspaceId: string;
  userId: string;
  agentId: string;
  allowFallback?: boolean;
}): Promise<ResolvedAgent> {
  const agent = await getAgentView(input.workspaceId, input.userId, input.agentId);
  if (!agent) throw new TacosError("Agent not found", 404);
  if (!agent.enabled) throw new TacosError("This agent is turned off", 409);
  if (agent.source === "api") {
    return { ...agent, runSource: "api", resolvedEngine: "api" };
  }
  if (agent.available) return { ...agent, runSource: "runner", resolvedEngine: agent.engine };
  if (input.allowFallback && (await resolveAgentApiEndpoints(input.userId)).length > 0) {
    return { ...agent, runSource: "api", resolvedEngine: "api" };
  }
  throw new TacosError(agent.availabilityHint ?? "This agent is not available", 409);
}

/** A shared agent is scoped to its projects; the personal agent has no scope. */
export function agentCoversProject(agent: Pick<AgentView, "personal" | "projectIds">, projectId: string): boolean {
  return agent.personal || agent.projectIds.length === 0 || agent.projectIds.includes(projectId);
}

export const AGENT_SOURCES = SOURCES;
export const AGENT_APPROVALS = APPROVALS;
