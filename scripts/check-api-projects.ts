/**
 * U-13a projects REST surface: list/create/get/update/trash, membership and the
 * project-tasks convenience list, with API-key scope and project-allowlist rules.
 * Run: npx tsx scripts/check-api-projects.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-api-projects-"));
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

type RouteContext = { params: Promise<{ id: string; userId: string }> };

async function call(
  handler: (req: Request, ctx: RouteContext) => Promise<Response>,
  rawKey: string | null,
  url: string,
  init: { method?: string; body?: unknown; ctx?: { id: string; userId?: string } } = {}
): Promise<RouteResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (rawKey) headers.authorization = `Bearer ${rawKey}`;
  const request = new Request(`http://tacos.test${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ctx: RouteContext = {
    params: Promise.resolve({
      id: init.ctx?.id ?? "",
      userId: init.ctx?.userId ?? "",
    }),
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
  const { issues, projects, users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const { createApiKey, createIssue } = await import("../src/lib/issues");
  const { eq } = await import("drizzle-orm");
  const { GET: listProjectsRoute, POST: createProjectRoute } = await import(
    "../src/app/api/v1/projects/route"
  );
  const { GET: getProjectRoute, PATCH: patchProjectRoute, DELETE: deleteProjectRoute } = await import(
    "../src/app/api/v1/projects/[id]/route"
  );
  const { GET: listMembersRoute, POST: addMemberRoute } = await import(
    "../src/app/api/v1/projects/[id]/members/route"
  );
  const { DELETE: removeMemberRoute } = await import(
    "../src/app/api/v1/projects/[id]/members/[userId]/route"
  );
  const { GET: projectTasksRoute } = await import("../src/app/api/v1/projects/[id]/tasks/route");

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
    await db.insert(workspaceMembers).values({ workspaceId: "proj-ws", userId: id, role, createdAt: at });
  }
  await db.insert(workspaces).values({
    id: "proj-ws",
    name: "Project Space",
    key: "PROJ",
    createdBy: "owner",
    createdAt: at,
  });
  await db.insert(projects).values([
    { id: "p-a", workspaceId: "proj-ws", key: "PA", name: "Alpha", createdBy: "owner", createdAt: at },
    { id: "p-b", workspaceId: "proj-ws", key: "PB", name: "Beta", createdBy: "owner", createdAt: at },
  ] as never);

  const owner = { kind: "user" as const, userId: "owner", displayName: "Owner" };
  const alpha1 = await createIssue("proj-ws", { title: "Alpha one", project: "PA" }, owner);
  const alpha2 = await createIssue("proj-ws", { title: "Alpha two", project: "PA", status: "in_progress" }, owner);
  await createIssue("proj-ws", { title: "Beta one", project: "PB" }, owner);

  const fullKey = await createApiKey("proj-ws", "full", ["read", "write"], null, 90, "owner");
  const readKey = await createApiKey("proj-ws", "reader", ["read"], null, 90, "owner");
  const scopedKey = await createApiKey("proj-ws", "alpha-only", ["read", "write"], ["p-a"], 90, "owner");
  const memberKey = await createApiKey("proj-ws", "member", ["read", "write"], null, 90, "member");

  // 1. Missing key is 401.
  const missing = await call(listProjectsRoute, null, "/api/v1/projects");
  assert(missing.status === 401, `missing key is 401, got ${missing.status}`);

  // 2. Lists respect the project allowlist.
  const fullList = await call(listProjectsRoute, fullKey.key, "/api/v1/projects");
  assert(fullList.status === 200 && arrayBody(fullList.body).length === 2, `full list: ${fullList.status}`);
  assert(fullList.headers.get("x-total-count") === "2", "the list reports its total");
  const scopedList = await call(listProjectsRoute, scopedKey.key, "/api/v1/projects");
  const scopedProjects = arrayBody<{ key: string }>(scopedList.body);
  assert(scopedProjects.length === 1 && scopedProjects[0].key === "PA", `scoped list: ${scopedProjects.map((p) => p.key)}`);

  // 3. Create: a full key works; scoped and read-only keys are refused; name is required.
  const created = await call(createProjectRoute, fullKey.key, "/api/v1/projects", {
    method: "POST",
    body: { name: "Gamma", description: "Third project" },
  });
  const createdBody = objectBody(created);
  assert(created.status === 201, `create: ${created.status} ${String(createdBody.error ?? "")}`);
  assert(createdBody.createdBy === "owner", `the key's person leads the new project: ${String(createdBody.createdBy)}`);
  assert(typeof createdBody.key === "string" && createdBody.key.length >= 2, "the project gets a key");
  assert(created.headers.get("location") === `/api/v1/projects/${String(createdBody.key)}`, "Location names the new project");
  const scopedCreate = await call(createProjectRoute, scopedKey.key, "/api/v1/projects", {
    method: "POST",
    body: { name: "Elsewhere" },
  });
  assert(scopedCreate.status === 403, `a scoped key cannot create projects: ${scopedCreate.status}`);
  assert(/allowlist/.test(String(objectBody(scopedCreate).error)), "the create refusal names the allowlist");
  const readCreate = await call(createProjectRoute, readKey.key, "/api/v1/projects", {
    method: "POST",
    body: { name: "Nope" },
  });
  assert(readCreate.status === 403, `a read-only key cannot create: ${readCreate.status}`);
  const unnamed = await call(createProjectRoute, fullKey.key, "/api/v1/projects", {
    method: "POST",
    body: {},
  });
  assert(unnamed.status === 400, `a nameless create is 400: ${unnamed.status}`);

  // 4. Get one project with members and task counts.
  const alpha = await call(getProjectRoute, fullKey.key, "/api/v1/projects/PA", { ctx: { id: "p-a" } });
  const alphaBody = objectBody(alpha);
  assert(alpha.status === 200, `get project: ${alpha.status}`);
  assert(alphaBody.name === "Alpha" && alphaBody.key === "PA", "the project identifies itself");
  assert(Array.isArray(alphaBody.members) && arrayBody(alphaBody.members).length === 1, "the lead is the only member");
  assert((alphaBody.members as Array<{ role: string }>)[0].role === "lead", "the creator is the lead");
  assert(asObject(alphaBody.taskCounts).total === 2, "the project reports its task count");
  assert(!("doc" in alphaBody), "the project Overview document is not part of this API");
  const outsideGet = await call(getProjectRoute, scopedKey.key, "/api/v1/projects/PB", { ctx: { id: "p-b" } });
  assert(outsideGet.status === 403, `a scoped key cannot read another project: ${outsideGet.status}`);
  const missingProject = await call(getProjectRoute, fullKey.key, "/api/v1/projects/NOPE", {
    ctx: { id: "does-not-exist" },
  });
  assert(missingProject.status === 404, `missing project is 404: ${missingProject.status}`);

  // 5. Update metadata; the identifier prefix does not change.
  const patched = await call(patchProjectRoute, fullKey.key, "/api/v1/projects/PA", {
    method: "PATCH",
    body: { name: "Alpha renamed", description: "Renamed", color: "#eb5757" },
    ctx: { id: "p-a" },
  });
  assert(patched.status === 200, `patch project: ${patched.status} ${String(objectBody(patched).error ?? "")}`);
  assert(objectBody(patched).name === "Alpha renamed" && objectBody(patched).key === "PA", "rename keeps the key");
  const [alphaRow] = await db.select().from(projects).where(eq(projects.id, "p-a"));
  assert(alphaRow.description === "Renamed" && alphaRow.color === "#eb5757", "metadata is stored");
  const badColor = await call(patchProjectRoute, fullKey.key, "/api/v1/projects/PA", {
    method: "PATCH",
    body: { color: "chartreuse" },
    ctx: { id: "p-a" },
  });
  assert(badColor.status === 400, `an unknown color is 400: ${badColor.status}`);
  const outsidePatch = await call(patchProjectRoute, scopedKey.key, "/api/v1/projects/PB", {
    method: "PATCH",
    body: { name: "Hacked" },
    ctx: { id: "p-b" },
  });
  assert(outsidePatch.status === 403, `a scoped key cannot patch another project: ${outsidePatch.status}`);
  const emptyPatch = await call(patchProjectRoute, fullKey.key, "/api/v1/projects/PA", {
    method: "PATCH",
    body: {},
    ctx: { id: "p-a" },
  });
  assert(emptyPatch.status === 400, `an empty patch is 400: ${emptyPatch.status}`);

  // 6. Membership: add by username, list, refuse the lead removal, remove a member.
  const membersBefore = await call(listMembersRoute, fullKey.key, "/api/v1/projects/PA/members", {
    ctx: { id: "p-a" },
  });
  assert(membersBefore.status === 200 && arrayBody(membersBefore.body).length === 1, "one lead before adding");
  const added = await call(addMemberRoute, fullKey.key, "/api/v1/projects/PA/members", {
    method: "POST",
    body: { username: "member" },
    ctx: { id: "p-a" },
  });
  assert(added.status === 201, `add member: ${added.status} ${String(objectBody(added).error ?? "")}`);
  assert(objectBody(added).username === "member" && objectBody(added).role === "member", "the added member is returned");
  const membersAfter = await call(listMembersRoute, fullKey.key, "/api/v1/projects/PA/members", {
    ctx: { id: "p-a" },
  });
  const roster = arrayBody<{ id: string; role: string; username: string }>(membersAfter.body);
  assert(roster.length === 2 && roster.some((m) => m.id === "member"), "the roster lists the new member");
  const unknownMember = await call(addMemberRoute, fullKey.key, "/api/v1/projects/PA/members", {
    method: "POST",
    body: { username: "ghost" },
    ctx: { id: "p-a" },
  });
  assert(unknownMember.status === 400, `an unknown member is 400: ${unknownMember.status}`);
  const leadRemoval = await call(removeMemberRoute, fullKey.key, "/api/v1/projects/PA/members/owner", {
    method: "DELETE",
    ctx: { id: "p-a", userId: "owner" },
  });
  assert(leadRemoval.status === 400, `the lead cannot be removed: ${leadRemoval.status}`);
  assert(/lead/.test(String(objectBody(leadRemoval).error)), "the refusal names the lead");
  const removed = await call(removeMemberRoute, fullKey.key, "/api/v1/projects/PA/members/member", {
    method: "DELETE",
    ctx: { id: "p-a", userId: "member" },
  });
  assert(removed.status === 200, `remove member: ${removed.status}`);
  const removedAgain = await call(removeMemberRoute, fullKey.key, "/api/v1/projects/PA/members/member", {
    method: "DELETE",
    ctx: { id: "p-a", userId: "member" },
  });
  assert(removedAgain.status === 404, `removing a non-member is 404: ${removedAgain.status}`);

  // 7. The project-tasks list has the task-list filters and headers.
  const tasks = await call(projectTasksRoute, fullKey.key, "/api/v1/projects/PA/tasks?status=active", {
    ctx: { id: "p-a" },
  });
  const taskRows = arrayBody<{ identifier: string; projectId: string }>(tasks.body);
  assert(tasks.status === 200 && taskRows.length === 2, `project tasks: ${tasks.status} ${taskRows.length}`);
  assert(taskRows.every((issue) => issue.projectId === "p-a"), "only this project's tasks");
  assert(tasks.headers.get("x-total-count") === "2", "project tasks report a total");
  const oneTask = await call(projectTasksRoute, fullKey.key, "/api/v1/projects/PA/tasks?limit=1", {
    ctx: { id: "p-a" },
  });
  assert(arrayBody(oneTask.body).length === 1 && oneTask.headers.get("x-next-cursor"), "project tasks paginate");
  const otherTasks = await call(projectTasksRoute, scopedKey.key, "/api/v1/projects/PB/tasks", {
    ctx: { id: "p-b" },
  });
  assert(otherTasks.status === 403, `a scoped key cannot list another project's tasks: ${otherTasks.status}`);

  // 8. Delete is the reversible Trash, not a hard delete.
  const memberDelete = await call(deleteProjectRoute, memberKey.key, "/api/v1/projects/PA", {
    method: "DELETE",
    ctx: { id: "p-a" },
  });
  assert(memberDelete.status === 403, `only the creator/owner may trash: ${memberDelete.status}`);
  assert(/creator or the workspace owner/.test(String(objectBody(memberDelete).error)), "the refusal names the rule");
  const readDelete = await call(deleteProjectRoute, readKey.key, "/api/v1/projects/PB", {
    method: "DELETE",
    ctx: { id: "p-b" },
  });
  assert(readDelete.status === 403, `a read-only key cannot delete: ${readDelete.status}`);
  const trashed = await call(deleteProjectRoute, fullKey.key, "/api/v1/projects/PB", {
    method: "DELETE",
    ctx: { id: "p-b" },
  });
  assert(trashed.status === 200 && objectBody(trashed).trashed === true, `trash project: ${trashed.status}`);
  const [betaRow] = await db.select().from(projects).where(eq(projects.id, "p-b"));
  assert(typeof betaRow.deletedAt === "string", "the project is marked deleted");
  const betaIssues = await db.select().from(issues).where(eq(issues.projectId, "p-b"));
  assert(betaIssues.length === 1 && betaIssues[0].deletedAt === null, "its tasks are untouched in the Trash");
  const listAfterTrash = await call(listProjectsRoute, fullKey.key, "/api/v1/projects");
  assert(arrayBody(listAfterTrash.body).every((project) => (project as { id: string }).id !== "p-b"), "trashed project leaves the list");
  const getTrashed = await call(getProjectRoute, fullKey.key, "/api/v1/projects/PB", { ctx: { id: "p-b" } });
  assert(getTrashed.status === 404, `a trashed project is gone from the API: ${getTrashed.status}`);

  // 9. A project-scoped key may trash a project it owns while it is still in its list.
  const scopedTrash = await call(deleteProjectRoute, scopedKey.key, "/api/v1/projects/PA", {
    method: "DELETE",
    ctx: { id: "p-a" },
  });
  assert(scopedTrash.status === 200, `a scoped key can trash its project: ${scopedTrash.status}`);

  void alpha1;
  void alpha2;
  console.log(
    "check-api-projects: pass (list/create/get/patch/trash, member list+add+remove, project tasks filters+pagination, scoped/read-only/401 boundaries, reversible trash)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
