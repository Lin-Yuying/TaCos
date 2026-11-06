/**
 * U-13b pages REST surface: list/get/create/update/trash, tree, page comments, page
 * visibility, project allowlists, read-only rejection and pagination.
 * Run: npx tsx scripts/check-api-pages.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-api-pages-"));
process.env.TACOS_SEED_DEMO = "0";

type JsonObject = { [key: string]: unknown };
type RouteResult = { status: number; body: unknown; headers: Headers };
type RouteContext = { params: Promise<{ id: string }> };

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

async function call(
  handler: (req: Request, ctx: RouteContext) => Promise<Response>,
  rawKey: string | null,
  url: string,
  init: { method?: string; body?: unknown; id?: string } = {}
): Promise<RouteResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (rawKey) headers.authorization = `Bearer ${rawKey}`;
  const request = new Request(`http://tacos.test${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: init.id ?? "" }) });
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
  const { pageComments, pageVersions, pages, projects, users, workspaceMembers, workspaces } =
    await import("../src/db/schema");
  const { and, desc, eq } = await import("drizzle-orm");
  const { createApiKey } = await import("../src/lib/issues");
  const lib = await import("../src/lib/pages");
  const { GET: listPagesRoute, POST: createPageRoute } = await import(
    "../src/app/api/v1/pages/route"
  );
  const { GET: treeRoute } = await import("../src/app/api/v1/pages/tree/route");
  const { GET: getPageRoute, PATCH: patchPageRoute, DELETE: deletePageRoute } = await import(
    "../src/app/api/v1/pages/[id]/route"
  );
  const { GET: listCommentsRoute, POST: addCommentRoute } = await import(
    "../src/app/api/v1/pages/[id]/comments/route"
  );

  const db = getDb();
  const at = new Date().toISOString();
  for (const [id, role] of [
    ["owner", "admin"],
    ["member", "member"],
    ["outsider", "member"],
  ] as const) {
    await db.insert(users).values({
      id,
      username: id,
      displayName: id[0].toUpperCase() + id.slice(1),
      passwordHash: "x",
      createdAt: at,
    });
    await db.insert(workspaceMembers).values({
      workspaceId: "pages-ws",
      userId: id,
      role,
      createdAt: at,
    });
  }
  await db.insert(workspaces).values({
    id: "pages-ws",
    name: "Pages Space",
    key: "PAGES",
    createdBy: "owner",
    createdAt: at,
  });
  await db.insert(projects).values([
    { id: "p-a", workspaceId: "pages-ws", key: "PA", name: "Alpha", createdBy: "owner", createdAt: at },
    { id: "p-b", workspaceId: "pages-ws", key: "PB", name: "Beta", createdBy: "owner", createdAt: at },
  ] as never);

  const paShared = await lib.createPage("pages-ws", "owner", {
    title: "Alpha shared",
    doc: "Shared body",
    projectId: "p-a",
  });
  await lib.setPageShared("pages-ws", paShared.id, "owner", true);
  const paPrivate = await lib.createPage("pages-ws", "member", {
    title: "Member private",
    doc: "Only member",
    projectId: "p-a",
  });
  const pbShared = await lib.createPage("pages-ws", "owner", {
    title: "Beta shared",
    doc: "Beta body",
    projectId: "p-b",
  });
  await lib.setPageShared("pages-ws", pbShared.id, "owner", true);
  const memberShared = await lib.createPage("pages-ws", "member", {
    title: "Member shared",
    doc: "Member body",
    projectId: "p-a",
  });
  await lib.setPageShared("pages-ws", memberShared.id, "member", true);
  const workspaceShared = await lib.createPage("pages-ws", "owner", {
    title: "Workspace doc",
    doc: "Landing",
  });
  await lib.setPageShared("pages-ws", workspaceShared.id, "owner", true);
  const child = await lib.createPage("pages-ws", "owner", {
    title: "Alpha child",
    doc: "Child body",
    parentId: paShared.id,
  });

  const fullKey = await createApiKey("pages-ws", "full", ["read", "write"], null, 90, "owner");
  const readKey = await createApiKey("pages-ws", "reader", ["read"], null, 90, "owner");
  const scopedKey = await createApiKey("pages-ws", "alpha-only", ["read", "write"], ["p-a"], 90, "owner");
  const memberKey = await createApiKey("pages-ws", "member", ["read", "write"], null, 90, "member");
  const outsiderKey = await createApiKey("pages-ws", "outsider", ["read", "write"], null, 90, "outsider");

  // 1. Missing key is 401.
  const missing = await call(listPagesRoute, null, "/api/v1/pages");
  assert(missing.status === 401, `missing key is 401, got ${missing.status}`);

  // 2. Page visibility follows the existing rule: shared pages plus the viewer's own.
  const fullList = await call(listPagesRoute, fullKey.key, "/api/v1/pages");
  const fullTitles = arrayBody<{ title: string }>(fullList.body).map((page) => page.title).sort();
  assert(fullList.status === 200, `full list: ${fullList.status}`);
  assert(
    fullTitles.join(",") === "Alpha child,Alpha shared,Beta shared,Member shared,Workspace doc",
    `the owner sees shared pages and not another member's private page: ${fullTitles.join(",")}`
  );
  assert(fullList.headers.get("x-total-count") === "5", "the page list reports its total");
  const memberList = await call(listPagesRoute, memberKey.key, "/api/v1/pages");
  const memberTitles = arrayBody<{ title: string }>(memberList.body).map((page) => page.title);
  assert(memberTitles.includes("Member private"), "the author sees their own private page");
  assert(memberTitles.length === 6, `the member sees their private page plus shared: ${memberTitles.join(",")}`);
  const outsiderList = await call(listPagesRoute, outsiderKey.key, "/api/v1/pages");
  assert(
    !arrayBody<{ title: string }>(outsiderList.body).some((page) => page.title === "Member private"),
    "a private page does not leak to another member"
  );
  assert(
    !arrayBody<{ title: string }>(fullList.body).some((page) => "doc" in page),
    "the list leaves the markdown body out"
  );

  // 3. Project filter and title search.
  const projectList = await call(listPagesRoute, fullKey.key, "/api/v1/pages?project=PA");
  const projectRows = arrayBody<{ projectId: string }>(projectList.body);
  assert(projectRows.length === 3, `project pages: ${projectRows.length}`);
  assert(projectRows.every((page) => page.projectId === "p-a"), "project filter pins the project");
  const searched = await call(listPagesRoute, fullKey.key, "/api/v1/pages?q=ALPHA");
  assert(arrayBody(searched.body).length === 2, `title search is case-insensitive: ${arrayBody(searched.body).length}`);
  const badProject = await call(listPagesRoute, fullKey.key, "/api/v1/pages?project=NOPE");
  assert(badProject.status === 404, `an unknown project is 404: ${badProject.status}`);

  // 4. Keyset pagination.
  const firstPage = await call(listPagesRoute, fullKey.key, "/api/v1/pages?limit=2");
  const firstRows = arrayBody<{ id: string }>(firstPage.body);
  assert(firstRows.length === 2 && firstPage.headers.get("x-total-count") === "5", "first page is two of five");
  const cursor = firstPage.headers.get("x-next-cursor");
  assert(cursor, "the first page returns a cursor");
  const secondPage = await call(
    listPagesRoute,
    fullKey.key,
    `/api/v1/pages?limit=2&cursor=${encodeURIComponent(cursor)}`
  );
  const secondRows = arrayBody<{ id: string }>(secondPage.body);
  assert(secondRows.length === 2, "the cursor returns the next page");
  assert(
    secondRows.every((row) => !firstRows.some((first) => first.id === row.id)),
    "pages do not repeat across cursors"
  );
  const thirdPage = await call(
    listPagesRoute,
    fullKey.key,
    `/api/v1/pages?limit=2&cursor=${encodeURIComponent(secondPage.headers.get("x-next-cursor") ?? "")}`
  );
  assert(arrayBody(thirdPage.body).length === 1, "the last page is the remainder");
  assert(!thirdPage.headers.get("x-next-cursor"), "the last page has no cursor");
  const badCursor = await call(listPagesRoute, fullKey.key, "/api/v1/pages?cursor=not-a-cursor");
  assert(badCursor.status === 400, `an invalid cursor is 400: ${badCursor.status}`);

  // 5. The tree has depth, keeps order, and accepts the project filter.
  const tree = await call(treeRoute, fullKey.key, "/api/v1/pages/tree");
  const treeRows = arrayBody<{ id: string; depth: number }>(tree.body);
  assert(treeRows.length === 5 && tree.headers.get("x-total-count") === "5", "tree returns every visible page");
  assert(treeRows.find((row) => row.id === child.id)?.depth === 1, "a subpage sits at depth 1");
  assert(treeRows.find((row) => row.id === paShared.id)?.depth === 0, "a root page sits at depth 0");
  const projectTree = await call(treeRoute, fullKey.key, "/api/v1/pages/tree?project=PA");
  assert(arrayBody(projectTree.body).length === 3, "project tree is pinned to the project");
  const scopedTree = await call(treeRoute, scopedKey.key, "/api/v1/pages/tree");
  const scopedTreeRows = arrayBody<{ projectId: string | null }>(scopedTree.body);
  assert(
    scopedTreeRows.every((row) => row.projectId === null || row.projectId === "p-a"),
    "the tree respects the project allowlist"
  );

  // 6. Read one page, with the body, author and edit hint.
  const got = await call(getPageRoute, fullKey.key, `/api/v1/pages/${paShared.id}`, { id: paShared.id });
  const gotBody = objectBody(got);
  assert(got.status === 200 && gotBody.doc === "Shared body", `get page: ${got.status}`);
  assert(gotBody.shared === true && (gotBody.author as { id: string }).id === "owner", "get names sharing and author");
  assert(gotBody.canEdit === true, "the owner may edit");
  const memberGetsOwnPrivate = await call(getPageRoute, memberKey.key, `/api/v1/pages/${paPrivate.id}`, {
    id: paPrivate.id,
  });
  assert(memberGetsOwnPrivate.status === 200, "the author reads a private page");
  const memberGetsOthersPrivate = await call(getPageRoute, fullKey.key, `/api/v1/pages/${paPrivate.id}`, {
    id: paPrivate.id,
  });
  assert(memberGetsOthersPrivate.status === 404, `another member's private page is 404: ${memberGetsOthersPrivate.status}`);
  const missingPage = await call(getPageRoute, fullKey.key, "/api/v1/pages/nope", { id: "nope" });
  assert(missingPage.status === 404, `unknown page is 404: ${missingPage.status}`);
  const outsideGet = await call(getPageRoute, scopedKey.key, `/api/v1/pages/${pbShared.id}`, {
    id: pbShared.id,
  });
  assert(outsideGet.status === 403, `a scoped key cannot read another project's page: ${outsideGet.status}`);
  assert(/not allowed to use project/.test(String(objectBody(outsideGet).error)), "the refusal names the restricted project");

  // 7. Create: project/parent association, private default, attribution, limits.
  const created = await call(createPageRoute, fullKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "API created", doc: "Hello **markdown**", project: "PA" },
  });
  const createdBody = objectBody(created);
  assert(created.status === 201, `create page: ${created.status} ${String(createdBody.error ?? "")}`);
  assert(createdBody.createdBy === "owner", "the key's person owns the new page");
  assert(createdBody.projectId === "p-a" && createdBody.shared === false, "a new API page is private and project-bound");
  assert(created.headers.get("location") === `/api/v1/pages/${String(createdBody.id)}`, "Location names the page");
  const createdVersion = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, String(createdBody.id)))
    .orderBy(desc(pageVersions.seq));
  assert(
    createdVersion.length === 1 && createdVersion[0].via === "api:full" && createdVersion[0].reason === "edit",
    `the first version names the API key: ${createdVersion.map((version) => version.via).join(",")}`
  );
  const createdChild = await call(createPageRoute, scopedKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "Scoped child", project: "PA", parentId: paShared.id },
  });
  const createdChildBody = objectBody(createdChild);
  assert(createdChild.status === 201, `create child: ${createdChild.status}`);
  assert(
    createdChildBody.projectId === "p-a" && createdChildBody.shared === true,
    "a subpage inherits its parent's project and sharing"
  );
  const outsideCreate = await call(createPageRoute, scopedKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "Outside", project: "PB" },
  });
  assert(outsideCreate.status === 403, `a scoped key cannot create in another project: ${outsideCreate.status}`);
  const outsideParent = await call(createPageRoute, scopedKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "Outside child", parentId: pbShared.id },
  });
  assert(outsideParent.status === 403, `a scoped key cannot create under another project's page: ${outsideParent.status}`);
  const readCreate = await call(createPageRoute, readKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "Nope" },
  });
  assert(readCreate.status === 403, `a read-only key cannot create: ${readCreate.status}`);
  assert(/read-only/.test(String(objectBody(readCreate).error)), "the read-only refusal says so");
  const badDoc = await call(createPageRoute, fullKey.key, "/api/v1/pages", {
    method: "POST",
    body: { title: "Bad", doc: 42 },
  });
  assert(badDoc.status === 400, `a non-string body is 400: ${badDoc.status}`);

  // 8. Update: owner/editor paths, attribution, stale revision, type checks.
  const patched = await call(patchPageRoute, fullKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "PATCH",
    body: { title: "Alpha shared v2", doc: "Shared body v2" },
    id: paShared.id,
  });
  assert(patched.status === 200, `patch page: ${patched.status} ${String(objectBody(patched).error ?? "")}`);
  assert(objectBody(patched).doc === "Shared body v2", "the body is replaced");
  const sharedVersion = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, paShared.id))
    .orderBy(desc(pageVersions.seq));
  assert(sharedVersion[0]?.via === "api:full", `the update version names the API key: ${sharedVersion[0]?.via}`);
  const memberPatches = await call(patchPageRoute, memberKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "PATCH",
    body: { doc: "Shared body by member" },
    id: paShared.id,
  });
  assert(memberPatches.status === 200, `a shared editor may update: ${memberPatches.status}`);
  const memberVersion = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, paShared.id))
    .orderBy(desc(pageVersions.seq));
  assert(memberVersion[0]?.via === "api:member", `the member update names their key: ${memberVersion[0]?.via}`);
  const privatePatch = await call(patchPageRoute, fullKey.key, `/api/v1/pages/${paPrivate.id}`, {
    method: "PATCH",
    body: { title: "Nope" },
    id: paPrivate.id,
  });
  assert(privatePatch.status === 404, `a private page cannot be patched by others: ${privatePatch.status}`);
  const stale = await call(patchPageRoute, fullKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "PATCH",
    body: { doc: "stale", baseRevision: 0 },
    id: paShared.id,
  });
  assert(stale.status === 409, `a stale baseRevision is 409: ${stale.status}`);
  const emptyPatch = await call(patchPageRoute, fullKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "PATCH",
    body: {},
    id: paShared.id,
  });
  assert(emptyPatch.status === 400, `an empty patch is 400: ${emptyPatch.status}`);
  const readPatch = await call(patchPageRoute, readKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "PATCH",
    body: { title: "Nope" },
    id: paShared.id,
  });
  assert(readPatch.status === 403, `a read-only key cannot update: ${readPatch.status}`);
  const outsidePatch = await call(patchPageRoute, scopedKey.key, `/api/v1/pages/${pbShared.id}`, {
    method: "PATCH",
    body: { title: "Hacked" },
    id: pbShared.id,
  });
  assert(outsidePatch.status === 403, `a scoped key cannot patch another project's page: ${outsidePatch.status}`);

  // 9. Delete is the reversible Trash; only the author may do it.
  const memberDelete = await call(deletePageRoute, memberKey.key, `/api/v1/pages/${paShared.id}`, {
    method: "DELETE",
    id: paShared.id,
  });
  assert(memberDelete.status === 403, `only the page author may trash: ${memberDelete.status}`);
  assert(/owner can delete/.test(String(objectBody(memberDelete).error)), "the refusal names the rule");
  const outsideDelete = await call(deletePageRoute, scopedKey.key, `/api/v1/pages/${pbShared.id}`, {
    method: "DELETE",
    id: pbShared.id,
  });
  assert(outsideDelete.status === 403, `a scoped key cannot delete another project's page: ${outsideDelete.status}`);
  const trashed = await call(deletePageRoute, fullKey.key, `/api/v1/pages/${pbShared.id}`, {
    method: "DELETE",
    id: pbShared.id,
  });
  assert(trashed.status === 200 && objectBody(trashed).trashed === true, `trash page: ${trashed.status}`);
  const [trashedRow] = await db.select().from(pages).where(eq(pages.id, pbShared.id));
  assert(
    typeof trashedRow.deletedAt === "string" && trashedRow.trashRoot === pbShared.id,
    "the page is soft-deleted and names its trash root"
  );
  const afterTrash = await call(getPageRoute, fullKey.key, `/api/v1/pages/${pbShared.id}`, {
    id: pbShared.id,
  });
  assert(afterTrash.status === 404, `a trashed page is gone from the API: ${afterTrash.status}`);
  await lib.restorePage("pages-ws", pbShared.id, "owner");
  const restored = await call(getPageRoute, fullKey.key, `/api/v1/pages/${pbShared.id}`, {
    id: pbShared.id,
  });
  assert(restored.status === 200, `trash is reversible: ${restored.status}`);

  // 10. Page comments: list/add, threading, attribution, visibility and scope.
  const emptyComments = await call(listCommentsRoute, fullKey.key, `/api/v1/pages/${paShared.id}/comments`, {
    id: paShared.id,
  });
  assert(emptyComments.status === 200 && arrayBody(emptyComments.body).length === 0, "a new page has no comments");
  const addedComment = await call(addCommentRoute, fullKey.key, `/api/v1/pages/${paShared.id}/comments`, {
    method: "POST",
    body: { body: "First API comment" },
    id: paShared.id,
  });
  const commentBody = objectBody(addedComment);
  const comment = asObject(commentBody.comment);
  assert(addedComment.status === 201, `add comment: ${addedComment.status} ${String(commentBody.error ?? "")}`);
  assert(comment.body === "First API comment", "the comment text is stored");
  assert((comment.author as { id: string }).id === "owner", "the comment is authored by the key's person");
  assert(typeof comment.id === "string", "the comment has an id");
  const [commentRow] = await db.select().from(pageComments).where(eq(pageComments.id, String(comment.id)));
  assert(commentRow?.via === "api:full", `the comment names the API key: ${commentRow?.via}`);
  const replied = await call(addCommentRoute, memberKey.key, `/api/v1/pages/${paShared.id}/comments`, {
    method: "POST",
    body: { body: "A reply", parentId: comment.id },
    id: paShared.id,
  });
  assert(replied.status === 201, `reply: ${replied.status}`);
  assert(asObject(objectBody(replied).comment).parentId === comment.id, "the reply keeps its parent");
  const firstCommentPage = await call(
    listCommentsRoute,
    fullKey.key,
    `/api/v1/pages/${paShared.id}/comments?limit=1`,
    { id: paShared.id }
  );
  assert(arrayBody(firstCommentPage.body).length === 1, "comments paginate");
  assert(firstCommentPage.headers.get("x-total-count") === "2", "comments report the total");
  const commentCursor = firstCommentPage.headers.get("x-next-cursor");
  assert(commentCursor, "the first comment page returns a cursor");
  const secondCommentPage = await call(
    listCommentsRoute,
    fullKey.key,
    `/api/v1/pages/${paShared.id}/comments?limit=1&cursor=${encodeURIComponent(commentCursor)}`,
    { id: paShared.id }
  );
  assert(arrayBody(secondCommentPage.body).length === 1, "the comment cursor returns the next page");
  const readComment = await call(addCommentRoute, readKey.key, `/api/v1/pages/${paShared.id}/comments`, {
    method: "POST",
    body: { body: "Nope" },
    id: paShared.id,
  });
  assert(readComment.status === 403, `a read-only key cannot comment: ${readComment.status}`);
  const privateComment = await call(addCommentRoute, fullKey.key, `/api/v1/pages/${paPrivate.id}/comments`, {
    method: "POST",
    body: { body: "Nope" },
    id: paPrivate.id,
  });
  assert(privateComment.status === 404, `another member's private page cannot be commented on: ${privateComment.status}`);
  const outsideComment = await call(addCommentRoute, scopedKey.key, `/api/v1/pages/${pbShared.id}/comments`, {
    method: "POST",
    body: { body: "Nope" },
    id: pbShared.id,
  });
  assert(outsideComment.status === 403, `a scoped key cannot comment on another project's page: ${outsideComment.status}`);
  const emptyComment = await call(addCommentRoute, fullKey.key, `/api/v1/pages/${paShared.id}/comments`, {
    method: "POST",
    body: { body: "   " },
    id: paShared.id,
  });
  assert(emptyComment.status === 400, `an empty comment is 400: ${emptyComment.status}`);

  // 11. Everything stays in the workspace.
  const foreign = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, "pages-ws"), eq(pages.id, workspaceShared.id)));
  assert(foreign.length === 1, "fixture page belongs to the workspace");

  console.log(
    "check-api-pages: pass (list/tree/get/create/update/reversible trash, project+parent, title search + cursor pagination, comments list+add+thread+cursor, private/shared visibility, project allowlist, read-only rejection, api:<key> version attribution)"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
