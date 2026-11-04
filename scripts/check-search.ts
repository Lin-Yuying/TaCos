/**
 * Global search (docs/plans/team-2.2.md item 7): 3+ character and 2-character Chinese queries hit
 * documents, tasks and comments; others' private documents, hidden projects and deleted things do not.
 *   npx tsx scripts/check-search.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-search-"));
process.env.TACOS_DATA_DIR = dir;

async function main() {
  const { getDb } = await import("../src/db/client");
  const { users, workspaceMembers, workspaces, projects, projectMembers, issues, comments } = await import("../src/db/schema");
  const pagesLib = await import("../src/lib/pages");
  const pageComments = await import("../src/lib/page-comments");
  const { searchWorkspace } = await import("../src/lib/search");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w-search";
  await db.insert(workspaces).values({ id: ws, name: "Search", key: "SRCH", createdBy: "owner", membersSeeAllTasks: 0, createdAt: at } as never);
  for (const id of ["owner", "member"]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: at } as never);
  }
  await db.insert(workspaceMembers).values({ workspaceId: ws, userId: "owner", role: "admin", createdAt: at } as never);
  await db.insert(workspaceMembers).values({ workspaceId: ws, userId: "member", role: "member", createdAt: at } as never);
  const addProject = async (id: string, member: boolean) => {
    await db.insert(projects).values({ id, workspaceId: ws, key: id.toUpperCase(), name: id, createdBy: "owner", createdAt: at, updatedAt: at } as never);
    if (member) await db.insert(projectMembers).values({ projectId: id, userId: "member", createdAt: at } as never);
  };
  await addProject("open", true);
  await addProject("hidden", false);
  const addIssue = (id: string, projectId: string, number: number, title: string, description: string) =>
    db.insert(issues).values({ id, workspaceId: ws, projectId, number, identifier: `T-${number}`, title, description, createdAt: at, updatedAt: at } as never);

  const shared = await pagesLib.createPage(ws, "owner", { title: "Shared 周报 notes", doc: "Quarterly roadmap 机器学习 and budget" });
  await pagesLib.setPageShared(ws, shared.id, "owner", true);
  const secret = await pagesLib.createPage(ws, "owner", { title: "Secret", doc: "roadmap 周报 salary plan" });
  await addIssue("i-open", "open", 1, "Fix the 登录 flow", "Roadmap task body");
  await addIssue("i-hidden", "hidden", 2, "Hidden roadmap 周报", "secret");
  await db.insert(comments).values({ id: "c-open", issueId: "i-open", authorId: "owner", body: "A comment about the roadmap 周报", createdAt: at } as never);
  await db.insert(comments).values({ id: "c-hidden", issueId: "i-hidden", authorId: "owner", body: "roadmap 周报 hidden", createdAt: at } as never);
  await pageComments.addPageComment(ws, shared.id, "owner", { body: "Passage note on roadmap 周报" });
  await pageComments.addPageComment(ws, secret.id, "owner", { body: "Private note on roadmap 周报" });

  const kinds = (hits: { kind: string }[]) => hits.map((hit) => hit.kind).sort().join(",");

  // 3+ characters, case-insensitive, through the index.
  let hits = await searchWorkspace(ws, "member", "ROADMAP");
  assert(kinds(hits) === "doc,doc_comment,task,task_comment", `3+ characters hit every kind once: ${kinds(hits)}`);
  assert(hits.find((hit) => hit.kind === "task")?.ref === "open-1", "task hit carries its reference");
  assert(hits.find((hit) => hit.kind === "doc_comment")?.openId === shared.id, "comment opens its page");
  assert(hits.find((hit) => hit.kind === "task_comment")?.openId === "i-open", "comment opens its task");
  assert(!JSON.stringify(hits).includes("salary") && !JSON.stringify(hits).includes("Hidden"), "nothing hidden leaks");

  // 2-character Chinese, through the scan.
  hits = await searchWorkspace(ws, "member", "周报");
  assert(kinds(hits) === "doc,doc_comment,task_comment", `2-character Chinese hits: ${kinds(hits)}`);
  assert(!(await searchWorkspace(ws, "member", "登录")).every((hit) => hit.kind !== "task"), "2-character Chinese in a task title");
  assert((await searchWorkspace(ws, "member", "机器学习")).length === 1, "4-character Chinese");

  // The owner sees their own private document and every project.
  hits = await searchWorkspace(ws, "owner", "周报");
  assert(hits.some((hit) => hit.id === secret.id) && hits.some((hit) => hit.id === "i-hidden"), "owner sees everything");
  // Several words must all match; input is taken literally.
  assert((await searchWorkspace(ws, "member", "roadmap budget")).length === 1, "all words must match");
  assert((await searchWorkspace(ws, "member", '"roadmap" OR *')).length === 0, "query syntax is literal");
  assert((await searchWorkspace(ws, "member", "%")).length === 0, "percent is literal");
  assert((await searchWorkspace(ws, "member", "   ")).length === 0, "blank query");

  // Edits move the index; delete and restore follow.
  await pagesLib.updatePage(ws, shared.id, "owner", { doc: "Now about lighthouses" });
  assert((await searchWorkspace(ws, "member", "lighthouses")).length === 1, "edit is searchable");
  assert(!(await searchWorkspace(ws, "member", "budget")).length, "old text is gone");
  await pagesLib.deletePage(ws, shared.id, "owner");
  assert(!(await searchWorkspace(ws, "member", "lighthouses")).length, "trashed document does not match");
  await pagesLib.restorePage(ws, shared.id, "owner");
  assert((await searchWorkspace(ws, "member", "lighthouses")).length === 1, "restored document matches");

  // Unsharing hides it and its comments again.
  await pagesLib.setPageShared(ws, shared.id, "owner", false);
  assert(!(await searchWorkspace(ws, "member", "lighthouses")).length, "unshared document does not match");

  // A database from before this index gets filled on open.
  const sqlite = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client;
  sqlite.exec("DROP TABLE search_fts");
  sqlite.close();
  delete (globalThis as { __tacosDb?: unknown }).__tacosDb;
  hits = await searchWorkspace(ws, "member", "ROADMAP");
  assert(kinds(hits) === "task,task_comment", `old rows are indexed on open: ${kinds(hits)}`);

  console.log("check-search: ok");
}

void main();
