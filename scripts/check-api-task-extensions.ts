/**
 * U-13a task extensions through REST: custom fields, dependencies, recurrence,
 * claim/release, review changes, blockers and restore from Trash, with API-key
 * scope/project rules and api:<key> attribution.
 * Run: npx tsx scripts/check-api-task-extensions.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-api-ext-"));
process.env.TACOS_SEED_DEMO = "0";

type JsonObject = { [key: string]: unknown };
type RouteResult = { status: number; body: unknown; headers: Headers };

function objectBody(result: RouteResult): JsonObject {
  return (result.body ?? {}) as JsonObject;
}

function asObject(value: unknown): JsonObject {
  return (value ?? {}) as JsonObject;
}

function arrayBody<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error(`expected an array response, got ${String(value)}`);
  return value as T[];
}

type RouteContext = { params: Promise<{ id: string; depId: string }> };

async function call(
  handler: (req: Request, ctx: RouteContext) => Promise<Response>,
  rawKey: string | null,
  url: string,
  init: { method?: string; body?: unknown; ctx?: { id: string; depId?: string } } = {}
): Promise<RouteResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (rawKey) headers.authorization = `Bearer ${rawKey}`;
  const request = new Request(`http://tacos.test${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ctx: RouteContext = {
    params: Promise.resolve({ id: init.ctx?.id ?? "", depId: init.ctx?.depId ?? "" }),
  };
  const response = await handler(request, ctx);
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
  const { blockers, events, issues, projects, taskFieldValues, users, workspaceMembers, workspaces } =
    await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { createApiKey, createIssue, listIssues } = await import("../src/lib/issues");
  const { createTaskField } = await import("../src/lib/task-fields");
  const { GET: getIssueRoute, PATCH: patchIssueRoute, DELETE: deleteIssueRoute } = await import(
    "../src/app/api/v1/issues/[id]/route"
  );
  const { POST: createIssueRoute } = await import("../src/app/api/v1/issues/route");
  const { PUT: setFieldsRoute } = await import("../src/app/api/v1/issues/[id]/fields/route");
  const { POST: addDependencyRoute } = await import("../src/app/api/v1/issues/[id]/dependencies/route");
  const { DELETE: removeDependencyRoute } = await import(
    "../src/app/api/v1/issues/[id]/dependencies/[depId]/route"
  );
  const { POST: claimRoute, DELETE: releaseRoute } = await import("../src/app/api/v1/issues/[id]/claim/route");
  const { POST: reviewRoute } = await import("../src/app/api/v1/issues/[id]/review/route");
  const { POST: blockerRoute } = await import("../src/app/api/v1/issues/[id]/blockers/route");
  const { POST: restoreRoute } = await import("../src/app/api/v1/issues/[id]/restore/route");

  const db = getDb();
  const at = new Date().toISOString();
  for (const [id, role] of [
    ["owner", "admin"],
    ["member", "member"],
  ] as const) {
    await db.insert(users).values({
      id,
      username: id,
      displayName: id[0].toUpperCase() + id.slice(1),
      passwordHash: "x",
      createdAt: at,
    });
    await db.insert(workspaceMembers).values({ workspaceId: "ext-ws", userId: id, role, createdAt: at });
  }
  await db.insert(workspaces).values({
    id: "ext-ws",
    name: "Extension Space",
    key: "EXT",
    createdBy: "owner",
    createdAt: at,
  });
  await db.insert(projects).values([
    { id: "e-a", workspaceId: "ext-ws", key: "EA", name: "Alpha", createdBy: "owner", createdAt: at },
    { id: "e-b", workspaceId: "ext-ws", key: "EB", name: "Beta", createdBy: "owner", createdAt: at },
  ] as never);

  const owner = { kind: "user" as const, userId: "owner", displayName: "Owner" };
  const agent = { kind: "agent" as const, label: "codex", via: "mcp" as const, publishedBy: "owner" };
  const stage = await createTaskField("ext-ws", "owner", {
    name: "Stage",
    type: "select",
    options: ["alpha", "beta"],
  });
  const points = await createTaskField("ext-ws", "owner", { name: "Points", type: "number" });

  const task = await createIssue("ext-ws", { title: "Main task", project: "EA" }, owner);
  const blocking = await createIssue("ext-ws", { title: "Blocking task", project: "EA" }, owner);
  const betaTask = await createIssue("ext-ws", { title: "Beta task", project: "EB" }, owner);
  const pending = await createIssue("ext-ws", { title: "Needs review", project: "EA" }, agent);
  const pendingTwo = await createIssue("ext-ws", { title: "Reject me", project: "EA" }, agent);

  let fullKey = await createApiKey("ext-ws", "full", ["read", "write"], null, 90, "owner");
  const readKey = await createApiKey("ext-ws", "reader", ["read"], null, 90, "owner");
  const scopedKey = await createApiKey("ext-ws", "alpha-only", ["read", "write"], ["e-a"], 90, "owner");

  const eventFor = async (issueId: string, type: string) => {
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.issueId, issueId), eq(events.type, type)));
    return rows;
  };

  // 1. Custom fields: set several, read them back, clear one, keep the event attribution.
  const setFields = await call(setFieldsRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Stage: "beta", Points: "5" } },
    ctx: { id: task.issue.id },
  });
  assert(setFields.status === 200, `set fields: ${setFields.status} ${String(objectBody(setFields).error ?? "")}`);
  const setBody = objectBody(setFields);
  assert(asObject(setBody.fields).Stage === "beta", "the select value is stored");
  assert(asObject(setBody.fields).Points === "5", "the number value is stored");
  const values = await db.select().from(taskFieldValues).where(eq(taskFieldValues.issueId, task.issue.id));
  assert(values.length === 2, `two values are stored, got ${values.length}`);
  const fieldEvents = await eventFor(task.issue.id, "field_changed");
  assert(fieldEvents.length === 2, `two field changes are recorded, got ${fieldEvents.length}`);
  assert(fieldEvents.every((event) => event.agentActor === "api:full"), `field events name the key: ${fieldEvents.map((e) => e.agentActor)}`);
  const detail = await call(getIssueRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}`, {
    ctx: { id: task.issue.identifier },
  });
  assert(objectBody(detail).fields !== undefined, "GET issue returns custom fields");
  assert(asObject(objectBody(detail).fields).Stage === "beta", "GET issue shows the value");
  const cleared = await call(setFieldsRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Points: null } },
    ctx: { id: task.issue.id },
  });
  assert(cleared.status === 200 && asObject(objectBody(cleared).fields).Points === undefined, "null clears a value");
  const unknownField = await call(setFieldsRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Nope: "x" } },
    ctx: { id: task.issue.id },
  });
  assert(unknownField.status === 400 && /Unknown field/.test(String(objectBody(unknownField).error)), `unknown field: ${unknownField.status}`);
  const badOption = await call(setFieldsRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Stage: "gamma" } },
    ctx: { id: task.issue.id },
  });
  assert(badOption.status === 400 && /options/.test(String(objectBody(badOption).error)), `invalid option: ${badOption.status}`);
  const readFields = await call(setFieldsRoute, readKey.key, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Stage: "alpha" } },
    ctx: { id: task.issue.id },
  });
  assert(readFields.status === 403, `read-only field write: ${readFields.status}`);
  const crossedFields = await call(setFieldsRoute, scopedKey.key, `/api/v1/issues/${betaTask.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: { Stage: "alpha" } },
    ctx: { id: betaTask.issue.id },
  });
  assert(crossedFields.status === 403, `scoped field write outside the allowlist: ${crossedFields.status}`);
  void stage;

  // 2. Dependencies: add, read back, remove; loops and self-links are refused.
  const linked = await call(addDependencyRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/dependencies`, {
    method: "POST",
    body: { blockedBy: blocking.issue.identifier },
    ctx: { id: task.issue.id },
  });
  assert(linked.status === 200, `add dependency: ${linked.status} ${String(objectBody(linked).error ?? "")}`);
  assert(arrayBody(objectBody(linked).dependencies).length === 1, "the dependency is returned");
  assert(objectBody(linked).blocked === true, "an unfinished dependency marks the task blocked");
  const addedEvents = await eventFor(task.issue.id, "dependency_added");
  assert(addedEvents.length === 1 && addedEvents[0].agentActor === "api:full", "the dependency event names the key");
  const selfLink = await call(addDependencyRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/dependencies`, {
    method: "POST",
    body: { blockedBy: task.issue.identifier },
    ctx: { id: task.issue.id },
  });
  assert(selfLink.status === 400, `a self-dependency is 400: ${selfLink.status}`);
  const crossingLink = await call(addDependencyRoute, scopedKey.key, `/api/v1/issues/${task.issue.identifier}/dependencies`, {
    method: "POST",
    body: { blockedBy: betaTask.issue.identifier },
    ctx: { id: task.issue.id },
  });
  assert(crossingLink.status === 403, `a scoped key cannot link a task outside the allowlist: ${crossingLink.status}`);
  const unlinked = await call(removeDependencyRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/dependencies/${blocking.issue.identifier}`, {
    method: "DELETE",
    ctx: { id: task.issue.id, depId: blocking.issue.identifier },
  });
  assert(unlinked.status === 200 && arrayBody(objectBody(unlinked).dependencies).length === 0, "remove dependency");
  assert(objectBody(unlinked).blocked === false, "removing the only dependency unblocks the task");
  assert((await eventFor(task.issue.id, "dependency_removed")).length === 1, "the removal is recorded");

  // 3. Recurrence on update and on create.
  const recurring = await call(patchIssueRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}`, {
    method: "PATCH",
    body: { recurrence: "weekly" },
    ctx: { id: task.issue.identifier },
  });
  assert(recurring.status === 200 && objectBody(recurring).recurrence === "weekly", `recurrence update: ${recurring.status}`);
  const badRecurrence = await call(patchIssueRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}`, {
    method: "PATCH",
    body: { recurrence: "fortnightly" },
    ctx: { id: task.issue.identifier },
  });
  assert(badRecurrence.status === 400, `an unknown recurrence is 400: ${badRecurrence.status}`);
  const recurringCreate = await call(createIssueRoute, fullKey.key, "/api/v1/issues", {
    method: "POST",
    body: { title: "Monthly report", project: "EA", recurrence: "monthly", dueDate: "2026-11-30" },
  });
  assert(recurringCreate.status === 201 && objectBody(recurringCreate).recurrence === "monthly", `recurrence create: ${recurringCreate.status}`);

  // A fresh key with the same name: the write rate-limit bucket is per key, and this
  // check drives more than one burst of writes. Attribution stays `api:full`.
  fullKey = await createApiKey("ext-ws", "full", ["read", "write"], null, 90, "owner");

  // 4. Claim and release act for the key's person, with the key in the activity.
  const claimed = await call(claimRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/claim`, {
    method: "POST",
    ctx: { id: task.issue.id },
  });
  assert(claimed.status === 200 && objectBody(claimed).claimedBy === "owner", `claim: ${claimed.status} ${String(objectBody(claimed).error ?? "")}`);
  const claimEvent = (await eventFor(task.issue.id, "claimed")).at(-1);
  assert(claimEvent?.agentActor === "api:full", `the claim event names the key: ${claimEvent?.agentActor}`);
  const released = await call(releaseRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/claim`, {
    method: "DELETE",
    ctx: { id: task.issue.id },
  });
  assert(released.status === 200 && objectBody(released).claimedBy === null, `release: ${released.status}`);
  const releaseAgain = await call(releaseRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/claim`, {
    method: "DELETE",
    ctx: { id: task.issue.id },
  });
  assert(releaseAgain.status === 403, `releasing an unclaimed task is 403: ${releaseAgain.status}`);
  const pendingClaim = await call(claimRoute, fullKey.key, `/api/v1/issues/${pending.issue.identifier}/claim`, {
    method: "POST",
    ctx: { id: pending.issue.id },
  });
  assert(pendingClaim.status === 409, `a task waiting for review cannot be claimed: ${pendingClaim.status}`);
  const readClaim = await call(claimRoute, readKey.key, `/api/v1/issues/${task.issue.identifier}/claim`, {
    method: "POST",
    ctx: { id: task.issue.id },
  });
  assert(readClaim.status === 403, `a read-only key cannot claim: ${readClaim.status}`);
  const crossedClaim = await call(claimRoute, scopedKey.key, `/api/v1/issues/${betaTask.issue.identifier}/claim`, {
    method: "POST",
    ctx: { id: betaTask.issue.id },
  });
  assert(crossedClaim.status === 403, `a scoped key cannot claim outside the allowlist: ${crossedClaim.status}`);

  // 5. Review changes are made as the key's person and recorded as the key.
  const approved = await call(reviewRoute, fullKey.key, `/api/v1/issues/${pending.issue.identifier}/review`, {
    method: "POST",
    body: { state: "approved" },
    ctx: { id: pending.issue.id },
  });
  assert(approved.status === 200, `review approve: ${approved.status} ${String(objectBody(approved).error ?? "")}`);
  assert(objectBody(approved).reviewStatus === "approved" && objectBody(approved).reviewedBy === "owner", "the key's person is the reviewer");
  const reviewEvents = await eventFor(pending.issue.id, "review_approved");
  assert(reviewEvents.length === 1 && reviewEvents[0].agentActor === "api:full", "the review event names the key");
  const twice = await call(reviewRoute, fullKey.key, `/api/v1/issues/${pending.issue.identifier}/review`, {
    method: "POST",
    body: { state: "rejected" },
    ctx: { id: pending.issue.id },
  });
  assert(twice.status === 409, `a reviewed task refuses a second review: ${twice.status}`);
  const rejected = await call(reviewRoute, fullKey.key, `/api/v1/issues/${pendingTwo.issue.identifier}/review`, {
    method: "POST",
    body: { state: "rejected" },
    ctx: { id: pendingTwo.issue.id },
  });
  assert(rejected.status === 200 && objectBody(rejected).reviewStatus === "rejected", "review reject");
  const board = await listIssues("ext-ws", {});
  assert(!board.some((issue) => issue.id === pendingTwo.issue.id), "a rejected task leaves the board");
  const badReview = await call(reviewRoute, fullKey.key, `/api/v1/issues/${pendingTwo.issue.identifier}/review`, {
    method: "POST",
    body: { state: "pending" },
    ctx: { id: pendingTwo.issue.id },
  });
  assert(badReview.status === 400, `an unknown review state is 400: ${badReview.status}`);

  // 6. A blocker report is authored by the key's person and attributed to the key.
  const reported = await call(blockerRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/blockers`, {
    method: "POST",
    body: { body: "Waiting on the upstream API" },
    ctx: { id: task.issue.id },
  });
  assert(reported.status === 201, `report blocker: ${reported.status} ${String(objectBody(reported).error ?? "")}`);
  const [blockerRow] = await db.select().from(blockers).where(eq(blockers.issueId, task.issue.id));
  assert(blockerRow?.body === "Waiting on the upstream API" && blockerRow.authorId === "owner", "the blocker names the key's person");
  const blockerEvents = await eventFor(task.issue.id, "blocker_reported");
  assert(blockerEvents.length === 1 && blockerEvents[0].agentActor === "api:full", "the blocker event names the key");
  const emptyBlocker = await call(blockerRoute, fullKey.key, `/api/v1/issues/${task.issue.identifier}/blockers`, {
    method: "POST",
    body: { body: "  " },
    ctx: { id: task.issue.id },
  });
  assert(emptyBlocker.status === 400, `an empty blocker is 400: ${emptyBlocker.status}`);
  const readBlocker = await call(blockerRoute, readKey.key, `/api/v1/issues/${task.issue.identifier}/blockers`, {
    method: "POST",
    body: { body: "nope" },
    ctx: { id: task.issue.id },
  });
  assert(readBlocker.status === 403, `a read-only key cannot report a blocker: ${readBlocker.status}`);

  // 7. Delete goes to Trash and restore brings the task back by id or identifier.
  const deleted = await call(deleteIssueRoute, fullKey.key, `/api/v1/issues/${betaTask.issue.identifier}`, {
    method: "DELETE",
    ctx: { id: betaTask.issue.identifier },
  });
  assert(deleted.status === 200 && objectBody(deleted).trashed === true, `delete: ${deleted.status}`);
  const gone = await call(getIssueRoute, fullKey.key, `/api/v1/issues/${betaTask.issue.identifier}`, {
    ctx: { id: betaTask.issue.identifier },
  });
  assert(gone.status === 404, `a trashed task is gone: ${gone.status}`);
  const crossedRestore = await call(restoreRoute, scopedKey.key, `/api/v1/issues/${betaTask.issue.identifier}/restore`, {
    method: "POST",
    ctx: { id: betaTask.issue.identifier },
  });
  assert(crossedRestore.status === 403, `a scoped key cannot restore outside the allowlist: ${crossedRestore.status}`);
  const restored = await call(restoreRoute, fullKey.key, `/api/v1/issues/${betaTask.issue.identifier}/restore`, {
    method: "POST",
    ctx: { id: betaTask.issue.identifier },
  });
  assert(restored.status === 200, `restore: ${restored.status} ${String(objectBody(restored).error ?? "")}`);
  assert(asObject(objectBody(restored).restored).identifier === betaTask.issue.identifier, "the restored identifier is returned");
  const [restoredRow] = await db.select().from(issues).where(eq(issues.id, betaTask.issue.id));
  assert(restoredRow.deletedAt === null, "the task is live again");
  const restoredGet = await call(getIssueRoute, fullKey.key, `/api/v1/issues/${betaTask.issue.identifier}`, {
    ctx: { id: betaTask.issue.identifier },
  });
  assert(restoredGet.status === 200, `the restored task reads again: ${restoredGet.status}`);
  const restoreAgain = await call(restoreRoute, fullKey.key, `/api/v1/issues/${betaTask.issue.identifier}/restore`, {
    method: "POST",
    ctx: { id: betaTask.issue.identifier },
  });
  assert(restoreAgain.status === 404, `restoring a live task is 404: ${restoreAgain.status}`);
  const readRestore = await call(restoreRoute, readKey.key, `/api/v1/issues/${betaTask.issue.identifier}/restore`, {
    method: "POST",
    ctx: { id: betaTask.issue.identifier },
  });
  assert(readRestore.status === 403, `a read-only key cannot restore: ${readRestore.status}`);

  const noKey = await call(setFieldsRoute, null, `/api/v1/issues/${task.issue.identifier}/fields`, {
    method: "PUT",
    body: { fields: {} },
    ctx: { id: task.issue.id },
  });
  assert(noKey.status === 401, `missing key is 401: ${noKey.status}`);

  void points;
  console.log(
    "check-api-task-extensions: pass (fields, dependencies, recurrence, claim/release, review, blocker, trash restore, api attribution, scope/allowlist/401 boundaries)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
