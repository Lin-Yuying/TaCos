import { TacosError, verifyApiKey, type ApiKeyRecord } from "./issues";

const DOCS_HINT = "Create a key in Settings → Agent access, then send header Authorization: Bearer <key>";

function extractRawKey(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? req.headers.get("x-api-key") ?? "";
}

// Verifies the key and updates lastUsedAt. Use for all mutating/data endpoints.
export async function requireApiKey(req: Request): Promise<ApiKeyRecord> {
  const raw = extractRawKey(req);
  if (!raw) throw new TacosError("Missing API key", 401, DOCS_HINT);
  const record = await verifyApiKey(raw.trim());
  if (!record) throw new TacosError("Invalid or revoked API key", 401, DOCS_HINT);
  return record;
}

// Verifies without updating lastUsedAt (for introspection endpoints).
export async function readApiKey(req: Request): Promise<ApiKeyRecord | null> {
  const raw = extractRawKey(req);
  if (!raw) return null;
  return verifyApiKey(raw.trim());
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
    return Response.json(body, { status: err.status });
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
