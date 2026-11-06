import {
  TacosError,
  apiKeyHasScope,
  findIssueRow,
  getProject,
  verifyApiKey,
  type ApiKeyRecord,
  type ApiKeyScope,
  type Project,
} from "./issues";
import { ApiKeyRateLimitError, takeApiKeyToken } from "./api-key-rate-limit";
import { pendingApiKeyUsage } from "./api-key-usage";

const DOCS_HINT = "Create a key in Settings → Agent access, then send header Authorization: Bearer <key>";
const SCOPE_HINT = 'Create a key with the "write" scope in Settings → Agent access, or use its read-only key for reads.';
const PROJECT_HINT =
  'Create a key that includes this project in Settings → Agent access, or edit the existing key\'s project allowlist.';

function extractRawKey(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? req.headers.get("x-api-key") ?? "";
}

/** The first proxy hop is the client; the header is stored for display, not policing. */
export function requestIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip")?.trim() || null;
}

export type ApiKeyRequestMode = "auto" | "read" | "write" | "none";

// Verifies the key, updates lastUsedAt/IP, enforces its scope and per-key rate limit.
// `mode: "none"` leaves the scope and rate-limit check to the caller (the MCP endpoint
// classifies JSON-RPC tool calls itself).
export async function requireApiKey(
  req: Request,
  options: { mode?: ApiKeyRequestMode } = {}
): Promise<ApiKeyRecord> {
  const raw = extractRawKey(req);
  if (!raw) throw new TacosError("Missing API key", 401, DOCS_HINT);
  const record = await verifyApiKey(raw.trim(), { ip: requestIp(req) });
  if (!record) {
    throw new TacosError("Invalid, revoked or expired API key", 401, DOCS_HINT);
  }
  const mode =
    options.mode ??
    (req.method === "GET" || req.method === "HEAD" ? "read" : "write");
  if (mode !== "auto" && mode !== "none") {
    assertKeyScope(record, mode);
    const limited = takeApiKeyToken(record.id, mode);
    if (!limited.ok) throw new ApiKeyRateLimitError(limited.retryAfterSeconds);
  }
  return record;
}

// Verifies without updating lastUsedAt (for introspection endpoints). The newest use may
// still sit in the per-process journal, so settings timestamps are merged in.
export async function readApiKey(req: Request): Promise<ApiKeyRecord | null> {
  const raw = extractRawKey(req);
  if (!raw) return null;
  const record = await verifyApiKey(raw.trim(), { recordUse: false });
  if (!record) return null;
  const pending = await pendingApiKeyUsage();
  const use = pending.get(record.id);
  if (use && (!record.lastUsedAt || use.at >= record.lastUsedAt)) {
    record.lastUsedAt = use.at;
    record.lastUsedIp = use.ip ?? record.lastUsedIp;
  }
  return record;
}

export function assertKeyScope(key: ApiKeyRecord, scope: ApiKeyScope): void {
  if (apiKeyHasScope(key, scope)) return;
  if (scope === "write") {
    throw new TacosError(
      'This API key is read-only: it has the "read" scope, not "write".',
      403,
      SCOPE_HINT
    );
  }
  throw new TacosError(
    'This API key does not have the "read" scope.',
    403,
    SCOPE_HINT
  );
}

// Resolves a project key or id and rejects one outside the key's allowlist. Returns the
// project so callers can use its id for filters.
export async function assertKeyProject(key: ApiKeyRecord, idOrKey: string): Promise<Project> {
  const project = await getProject(key.workspaceId, idOrKey);
  if (!project) throw new TacosError(`Project "${idOrKey}" not found`, 404);
  assertKeyProjectId(key, project.id, project.key);
  return project;
}

export function assertKeyProjectId(key: ApiKeyRecord, projectId: string, label: string): void {
  if (key.projectIds === null || key.projectIds.includes(projectId)) return;
  throw new TacosError(`This API key is not allowed to use project "${label}".`, 403, PROJECT_HINT);
}

// The task routes name a task, not a project, so resolve the task's project first.
// A missing task is left to the business call, which owns that error message.
export async function assertKeyIssueProject(key: ApiKeyRecord, idOrIdentifier: string): Promise<void> {
  if (key.projectIds === null) return;
  const row = await findIssueRow(key.workspaceId, idOrIdentifier);
  if (!row) return;
  const project = await getProject(key.workspaceId, row.projectId);
  assertKeyProjectId(key, row.projectId, project?.key ?? row.projectId);
}

export function errorResponse(err: unknown): Response {
  // Never swallow Next's internal prerender/render interrupts from inside
  // route handlers — they must propagate to the framework.
  if (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest: unknown }).digest).startsWith("NEXT_")
  ) {
    throw err;
  }
  if (err instanceof TacosError) {
    const body: Record<string, string> = { error: err.message };
    if (err.hint) body.hint = err.hint;
    const headers: Record<string, string> = {};
    const retryAfter = (err as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
      headers["Retry-After"] = String(Math.max(1, Math.ceil(retryAfter)));
    }
    return Response.json(body, { status: err.status, headers });
  }
  console.error("[tacos] unhandled API error:", err);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new TacosError("Request body must be a JSON object", 400);
  }
}
