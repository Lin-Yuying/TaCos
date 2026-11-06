/**
 * Scoped API keys: scopes, project allowlists, expiry, rotation, legacy keys,
 * /me fields and per-key rate limits.
 * Run: npx tsx scripts/check-api-key-scopes.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-api-key-scopes-"));
process.env.TACOS_SEED_DEMO = "0";

type JsonObject = { [key: string]: unknown };
type RouteResult = { status: number; body: unknown; headers: Headers };

function objectBody(result: RouteResult): JsonObject {
  return (result.body ?? {}) as JsonObject;
}

function arrayBody<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error(`expected an array response, got ${String(value)}`);
  return value as T[];
}

type RouteContext = { params: Promise<{ id: string }> };

async function call(
  handler: (req: Request, ctx: RouteContext) => Promise<Response>,
  rawKey: string | null,
  url: string,
  init: { method?: string; body?: unknown; ctx?: RouteContext; ip?: string } = {}
): Promise<RouteResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": init.ip ?? "203.0.113.9",
  };
  if (rawKey) headers.authorization = `Bearer ${rawKey}`;
  const request = new Request(`http://tacos.test${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request, init.ctx as RouteContext);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { apiKeys, issues, projects, users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const { createApiKey, generateApiKey, createIssue, rotateApiKey } = await import("../src/lib/issues");
  const { GET: listIssues, POST: createIssueRoute } = await import("../src/app/api/v1/issues/route");
  const { GET: getIssue } = await import("../src/app/api/v1/issues/[id]/route");
  const { GET: me } = await import("../src/app/api/v1/me/route");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const at = new Date().toISOString();
  const insertUser = async (id: string, role: "admin" | "member" = "member") => {
    await db.insert(users).values({
      id,
      username: id,
      displayName: id,
      passwordHash: "x",
      createdAt: at,
    });
    await db.insert(workspaceMembers).values({ workspaceId: "scope-ws", userId: id, role, createdAt: at });
  };
  await db.insert(users).values({
    id: "owner",
    username: "owner",
    displayName: "Owner",
    passwordHash: "x",
    createdAt: at,
  });
  await db.insert(workspaces).values({
    id: "scope-ws",
    name: "Scope Space",
    key: "SCOPE",
    createdBy: "owner",
    createdAt: at,
  });
  await db.insert(workspaceMembers).values({ workspaceId: "scope-ws", userId: "owner", role: "admin", createdAt: at });
  await insertUser("plain-member");
  await db.insert(projects).values([
    { id: "scope-a", workspaceId: "scope-ws", key: "SA", name: "Alpha", createdBy: "owner", createdAt: at },
    { id: "scope-b", workspaceId: "scope-ws", key: "SB", name: "Beta", createdBy: "owner", createdAt: at },
  ] as never);
  const actor = { kind: "user" as const, userId: "owner", displayName: "Owner" };
  for (let index = 1; index <= 2; index++) {
    await createIssue("scope-ws", { title: `Alpha ${index}`, project: "SA" }, actor);
  }
  await createIssue("scope-ws", { title: "Beta 1", project: "SB" }, actor);
  await db.insert(projects).values({
    id: "scope-c",
    workspaceId: "scope-ws",
    key: "SC",
    name: "Member only",
    createdBy: "plain-member",
    createdAt: at,
  } as never);
  await createIssue(
    "scope-ws",
    { title: "Member only task", project: "SC" },
    { kind: "user" as const, userId: "plain-member", displayName: "plain-member" }
  );

  const readKey = await createApiKey("scope-ws", "reader", ["read"], null, 90, "owner");
  const projectKey = await createApiKey("scope-ws", "alpha-only", ["read", "write"], ["scope-a"], 90, "owner");
  const expired = await createApiKey("scope-ws", "expired", ["read", "write"], null, 30, "owner");
  await db
    .update(apiKeys)
    .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(apiKeys.id, expired.record.id));
  const rotating = await createApiKey("scope-ws", "rotating", ["read", "write"], null, 90, "owner");
  const rotated = await rotateApiKey("scope-ws", rotating.record.id, "owner");
  assert(rotated.record.rotatedFrom === rotating.record.id, "rotation records the old key");

  // A key created before scopes existed: null scopes/projects/expiry in the database.
  const legacyRaw = generateApiKey();
  await db.insert(apiKeys).values({
    id: "legacy-key",
    workspaceId: "scope-ws",
    name: "legacy",
    keyHash: crypto.createHash("sha256").update(legacyRaw).digest("hex"),
    createdBy: "owner",
    createdAt: at,
    lastUsedAt: null,
    revokedAt: null,
    scopes: null,
    projectIds: null,
    expiresAt: null,
    rotatedFrom: null,
    keyPrefix: null,
    last4: null,
    lastUsedIp: null,
  });

  // 1. Read-only: GET works, every write names the missing scope.
  const readList = await call(listIssues, readKey.key, "/api/v1/issues");
  assert(readList.status === 200 && Array.isArray(readList.body), `read-only GET: ${readList.status}`);
  const readWrite = await call(createIssueRoute, readKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "should not exist", project: "SA" },
  });
  assert(readWrite.status === 403, `read-only POST is 403, got ${readWrite.status}`);
  assert(/read-only/.test(String(objectBody(readWrite).error)) && /write/.test(String(objectBody(readWrite).error)), `names the missing scope: ${String(objectBody(readWrite).error)}`);

  // 2. Project allowlist: lists are filtered, direct reads and writes outside it are 403.
  const scopedList = await call(listIssues, projectKey.key, "/api/v1/issues");
  assert(scopedList.status === 200, `project list: ${scopedList.status}`);
  const scopedIssues = arrayBody<{ projectId: string; title: string }>(scopedList.body);
  assert(
    scopedIssues.length === 2 && scopedIssues.every((issue) => issue.projectId === "scope-a"),
    `project list only has Alpha: ${scopedIssues.map((issue) => issue.title).join(",")}`
  );
  const filteredParam = await call(listIssues, projectKey.key, "/api/v1/issues?project=SB");
  assert(filteredParam.status === 403, `explicit other project is 403, got ${filteredParam.status}`);
  const insideRead = await call(getIssue, projectKey.key, "/api/v1/issues/SA-1", {
    ctx: { params: Promise.resolve({ id: "SA-1" }) },
  });
  assert(insideRead.status === 200 && objectBody(insideRead).identifier === "SA-1", `inside project read: ${insideRead.status}`);
  const outsideRead = await call(getIssue, projectKey.key, "/api/v1/issues/SB-1", {
    ctx: { params: Promise.resolve({ id: "SB-1" }) },
  });
  assert(outsideRead.status === 403, `outside project read is 403, got ${outsideRead.status}`);
  const outsideWrite = await call(createIssueRoute, projectKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "elsewhere", project: "SB" },
  });
  assert(outsideWrite.status === 403, `outside project write is 403, got ${outsideWrite.status}`);
  const insideWrite = await call(createIssueRoute, projectKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "inside alpha", project: "SA" },
  });
  assert(insideWrite.status === 201 && objectBody(insideWrite).projectId === "scope-a", `inside project write: ${insideWrite.status}`);

  // 3. Expired and rotated-away keys are 401 immediately.
  const expiredResult = await call(listIssues, expired.key, "/api/v1/issues");
  assert(expiredResult.status === 401, `expired key is 401, got ${expiredResult.status}`);
  const oldResult = await call(listIssues, rotating.key, "/api/v1/issues");
  assert(oldResult.status === 401, `rotated-away key is 401, got ${oldResult.status}`);
  const newResult = await call(listIssues, rotated.key, "/api/v1/issues");
  assert(newResult.status === 200, `replacement key works, got ${newResult.status}`);

  // 4. A legacy key keeps full access with no expiry.
  const legacyList = await call(listIssues, legacyRaw, "/api/v1/issues");
  assert(legacyList.status === 200, `legacy key works, got ${legacyList.status}`);
  const legacyMe = await call(me, legacyRaw, "/api/v1/me");
  assert(legacyMe.status === 200, `legacy /me: ${legacyMe.status}`);
  const legacyMeBody = objectBody(legacyMe);
  assert((legacyMeBody.scopes as string[]).join(",") === "read,write", `legacy full access: ${String(legacyMeBody.scopes)}`);
  assert(legacyMeBody.expiresAt === null, "legacy key never expires");

  // 5. /me reports scope, project count, expiry and last use with the request IP.
  const meResult = await call(me, readKey.key, "/api/v1/me");
  assert(meResult.status === 200, `/me: ${meResult.status}`);
  const meBody = objectBody(meResult);
  assert((meBody.scopes as string[]).join(",") === "read", `/me scopes: ${String(meBody.scopes)}`);
  assert(meBody.projectIds === null && meBody.projectCount === 3, `/me projects: ${String(meBody.projectCount)}`);
  assert(typeof meBody.expiresAt === "string", "/me expiry");
  assert(String(meBody.keyPrefix).startsWith("tac_"), `/me prefix: ${String(meBody.keyPrefix)}`);
  assert(String(meBody.last4).length === 4, `/me last4: ${String(meBody.last4)}`);
  assert(meBody.lastUsedAt !== null, "/me last used");
  assert(meBody.lastUsedIp === "203.0.113.9", `/me last used IP: ${String(meBody.lastUsedIp)}`);
  const scopedMe = await call(me, projectKey.key, "/api/v1/me");
  const scopedMeBody = objectBody(scopedMe);
  assert(scopedMeBody.projectCount === 1 && arrayBody(scopedMeBody.projects).length === 1, "scoped /me lists one project");

  // 6. Expiry: never is admin-only, enforced in lib.
  const memberKey = await createApiKey("scope-ws", "member-never", ["read"], null, null, "plain-member").catch(
    (error) => error as Error
  );
  assert(memberKey instanceof Error && /admin/.test(memberKey.message), `member never-expiry refused: ${memberKey}`);
  const adminNever = await createApiKey("scope-ws", "owner-never", ["read"], null, null, "owner");
  assert(adminNever.record.expiresAt === null, "owner can create a never-expiring key");

  // 7. Rate limit: 120 read/min with burst 20, then 429 + Retry-After, per key.
  const rateKey = await createApiKey("scope-ws", "rate-limited", ["read"], null, 90, "owner");
  const statuses: number[] = [];
  let limited: RouteResult | null = null;
  for (let index = 0; index < 21; index++) {
    const result = await call(listIssues, rateKey.key, "/api/v1/issues", { ip: "198.51.100.7" });
    statuses.push(result.status);
    if (result.status === 429) limited = result;
  }
  assert(statuses.slice(0, 20).every((status) => status === 200), `first 20 reads pass: ${statuses.join(",")}`);
  assert(limited !== null, `21st read is limited: ${statuses.join(",")}`);
  const retryAfter = Number(limited!.headers.get("retry-after"));
  assert(Number.isInteger(retryAfter) && retryAfter >= 1, `Retry-After header: ${limited!.headers.get("retry-after")}`);
  assert(/Rate limit/.test(String(objectBody(limited!).error)), `429 body: ${String(objectBody(limited!).error)}`);
  const otherKey = await createApiKey("scope-ws", "unlimited", ["read"], null, 90, "owner");
  const otherResult = await call(listIssues, otherKey.key, "/api/v1/issues");
  assert(otherResult.status === 200, "another key has its own bucket");

  // 8. Task visibility off: a member key only sees its own project, and the
  // no-project create default must pick a visible project, not an admin's.
  await db.update(workspaces).set({ membersSeeAllTasks: 0 }).where(eq(workspaces.id, "scope-ws"));
  const memberListKey = await createApiKey("scope-ws", "member-visible", ["read", "write"], null, 90, "plain-member");
  const memberList = await call(listIssues, memberListKey.key, "/api/v1/issues");
  assert(memberList.status === 200, `member list: ${memberList.status}`);
  const memberIssues = arrayBody<{ projectId: string; title: string }>(memberList.body);
  assert(
    memberIssues.length === 1 && memberIssues[0].projectId === "scope-c",
    `member list is visibility-filtered: ${memberIssues.map((issue) => issue.title).join(",")}`
  );
  const memberMe = objectBody(await call(me, memberListKey.key, "/api/v1/me"));
  assert(memberMe.projectCount === 1, `member /me projectCount: ${String(memberMe.projectCount)}`);
  const hiddenCreate = await call(createIssueRoute, memberListKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "hidden default", project: "SB" },
  });
  assert(hiddenCreate.status === 403 || hiddenCreate.status === 404, `member cannot create in hidden project: ${hiddenCreate.status}`);
  const defaultCreate = await call(createIssueRoute, memberListKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "member default" },
  });
  assert(
    defaultCreate.status === 201 && objectBody(defaultCreate).projectId === "scope-c",
    `no-project create picks a visible project: ${defaultCreate.status} ${JSON.stringify(objectBody(defaultCreate).projectId)}`
  );
  const hiddenAllowlist = await createApiKey(
    "scope-ws",
    "member-hidden-allowlist",
    ["read"],
    ["scope-a"],
    90,
    "plain-member"
  ).catch((error) => error as Error);
  assert(
    hiddenAllowlist instanceof Error,
    `member cannot mint a key scoped to a hidden project: ${hiddenAllowlist}`
  );

  // 9. No key is 401.
  const missing = await call(listIssues, null, "/api/v1/issues");
  assert(missing.status === 401, `missing key is 401, got ${missing.status}`);

  console.log(
    "check-api-key-scopes: pass (read-only 403, project allowlist 403/list filter, expired+rotated 401, legacy full access, /me fields, admin-only never, 429 + Retry-After, per-key buckets)"
  );
  void issues;
  void projects;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
