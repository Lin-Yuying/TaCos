/**
 * U-10 search coverage: every indexed entity is found, permissions hide what the
 * viewer may not read, and deleted/trashed/unresolved rows never match.
 *   npx tsx scripts/check-search-coverage.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-search-coverage-"));
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const pagesLib = await import("../src/lib/pages");
  const pageComments = await import("../src/lib/page-comments");
  const { search } = await import("../src/lib/search");
  const db = getDb();
  const at = "2026-01-01T00:00:00.000Z";
  const now = new Date().toISOString();

  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", createdAt: at },
      { id: "member", username: "member", displayName: "Member", passwordHash: "x", createdAt: at },
      { id: "shared", username: "shared", displayName: "Shared Person", passwordHash: "x", createdAt: at },
      { id: "zephyrite", username: "zephyrite", displayName: "周报王", passwordHash: "x", createdAt: at },
    ])
    .run();
  db.insert(schema.workspaces)
    .values([
      { id: "w1", name: "One", key: "ONE", createdBy: "owner", membersSeeAllTasks: 0, createdAt: at },
      { id: "w2", name: "Two", key: "TWO", createdBy: "owner", membersSeeAllTasks: 0, createdAt: at },
    ] as never)
    .run();
  db.insert(schema.workspaceMembers)
    .values([
      { workspaceId: "w1", userId: "owner", role: "admin", createdAt: at },
      { workspaceId: "w1", userId: "member", role: "member", createdAt: at },
      { workspaceId: "w1", userId: "shared", role: "member", createdAt: at },
      { workspaceId: "w1", userId: "zephyrite", role: "member", createdAt: at },
      { workspaceId: "w2", userId: "owner", role: "admin", createdAt: at },
      { workspaceId: "w2", userId: "shared", role: "member", createdAt: at },
    ])
    .run();
  db.insert(schema.projects)
    .values([
      { id: "p1", workspaceId: "w1", name: "Zephyr Core", key: "ZC", description: "zephyr project body", createdBy: "owner", createdAt: at },
      { id: "p2", workspaceId: "w1", name: "Zephyr Hidden", key: "ZH", description: "hidden body", createdBy: "owner", createdAt: at },
      { id: "p3", workspaceId: "w1", name: "Zephyr Trashed", key: "ZT", description: "trashed body", createdBy: "owner", createdAt: at, deletedAt: now },
      { id: "p4", workspaceId: "w1", name: "周报项目", key: "ZHB", description: "周报", createdBy: "owner", createdAt: at },
      { id: "p5", workspaceId: "w2", name: "Zephyr Other Team", key: "ZOT", description: "other body", createdBy: "owner", createdAt: at },
    ] as never)
    .run();
  db.insert(schema.projectMembers)
    .values([
      { projectId: "p1", userId: "member", createdAt: at },
      { projectId: "p1", userId: "shared", createdAt: at },
      { projectId: "p4", userId: "member", createdAt: at },
    ])
    .run();

  const sharedPage = await pagesLib.createPage("w1", "owner", {
    title: "Zephyr handbook",
    doc: "zephyr shared body with enough text",
  });
  await pagesLib.setPageShared("w1", sharedPage.id, "owner", true);
  const privatePage = await pagesLib.createPage("w1", "owner", {
    title: "Zephyr salary",
    doc: "zephyr private body",
  });
  const otherPage = await pagesLib.createPage("w2", "owner", {
    title: "Zephyr other team",
    doc: "zephyr other body",
  });
  await pagesLib.setPageShared("w2", otherPage.id, "owner", true);
  const sharedComments = await pageComments.addPageComment("w1", sharedPage.id, "owner", {
    body: "zephyr annotation on the page",
  });
  const privateComments = await pageComments.addPageComment("w1", privatePage.id, "owner", {
    body: "zephyr private note",
  });
  const privateCommentId = privateComments.at(-1)!.id;

  db.insert(schema.issues)
    .values([
      {
        id: "i1", workspaceId: "w1", projectId: "p1", number: 1, identifier: "ZC-1",
        title: "Zephyr launch", description: "zephyr task body", status: "todo",
        createdBy: "owner", createdAt: at, updatedAt: at,
      },
      {
        id: "i2", workspaceId: "w1", projectId: "p2", number: 2, identifier: "ZH-2",
        title: "Zephyr hidden", description: "hidden task body", status: "todo",
        createdBy: "owner", createdAt: at, updatedAt: at,
      },
      {
        id: "i3", workspaceId: "w1", projectId: "p1", number: 3, identifier: "ZC-3",
        title: "Zephyr deleted", description: "deleted task body", status: "todo",
        createdBy: "owner", createdAt: at, updatedAt: at, deletedAt: now,
      },
      {
        id: "i4", workspaceId: "w1", projectId: "p3", number: 4, identifier: "ZT-4",
        title: "Zephyr trashed project task", description: "trashed project body", status: "todo",
        createdBy: "owner", createdAt: at, updatedAt: at,
      },
    ] as never)
    .run();
  db.insert(schema.comments)
    .values([
      { id: "c1", issueId: "i1", authorId: "owner", body: "zephyr task comment", createdAt: at },
      { id: "c2", issueId: "i2", authorId: "owner", body: "zephyr hidden comment", createdAt: at },
      { id: "c3", issueId: "i3", authorId: "owner", body: "zephyr deleted comment", createdAt: at },
      { id: "c4", issueId: "i4", authorId: "owner", body: "zephyr trashed project comment", createdAt: at },
    ])
    .run();
  db.insert(schema.labels)
    .values([
      { id: "l1", workspaceId: "w1", name: "Zephyr", color: "#111111", createdAt: at },
      { id: "l2", workspaceId: "w1", name: "周报标签", color: "#222222", createdAt: at },
    ])
    .run();

  db.insert(schema.agentThreads)
    .values([
      {
        id: "t1", workspaceId: "w1", projectId: "p1", title: "Zephyr planning", engine: "codex",
        visibility: "shared", createdBy: "owner", createdAt: at, updatedAt: at,
      },
      {
        id: "t2", workspaceId: "w1", projectId: "p1", title: "Zephyr secret plan", engine: "codex",
        visibility: "private", createdBy: "owner", createdAt: at, updatedAt: at,
      },
      {
        id: "t3", workspaceId: "w1", projectId: "p1", title: "Zephyr member plan", engine: "codex",
        visibility: "private", createdBy: "member", createdAt: at, updatedAt: at,
      },
    ] as never)
    .run();
  db.insert(schema.agentMessages)
    .values([
      { id: "m1", threadId: "t1", role: "assistant", content: "oldreplyword zephyr", createdAt: "2026-01-01T01:00:00.000Z" },
      { id: "m2", threadId: "t1", role: "assistant", content: "newreplyword zephyr", createdAt: "2026-01-01T02:00:00.000Z" },
      { id: "m3", threadId: "t2", role: "assistant", content: "zephyr secret reply", createdAt: at },
      { id: "m4", threadId: "t3", role: "assistant", content: "zephyr member reply", createdAt: at },
    ])
    .run();

  db.insert(schema.attachments)
    .values([
      { id: "a1", workspaceId: "w1", pageId: sharedPage.id, uploaderId: "owner", name: "zephyr-file.png", size: 10, complete: 1, createdAt: at },
      { id: "a2", workspaceId: "w1", pageId: privatePage.id, uploaderId: "owner", name: "zephyr-secret.png", size: 10, complete: 1, createdAt: at },
      { id: "a3", workspaceId: "w1", pageId: "agent-draft", uploaderId: "owner", name: "zephyr-draft.png", size: 10, complete: 1, createdAt: at },
      { id: "a4", workspaceId: "w1", pageId: "thread:t1", uploaderId: "owner", name: "zephyr-thread.png", size: 10, complete: 1, createdAt: at },
      { id: "a5", workspaceId: "w1", pageId: sharedPage.id, uploaderId: "owner", name: "周报.pdf", size: 10, complete: 1, createdAt: at },
    ])
    .run();

  db.insert(schema.automationRules)
    .values([
      {
        id: "r1", workspaceId: "w1", name: "Zephyr digest", enabled: 1, createdBy: "owner",
        updatedBy: "owner", trigger: JSON.stringify({ type: "task.created" }), conditions: "[]",
        actions: "[]", createdAt: at, updatedAt: at,
      },
      {
        id: "r2", workspaceId: "w1", name: "Zephyr disabled rule", enabled: 0, createdBy: "owner",
        updatedBy: "owner", trigger: JSON.stringify({ type: "task.completed" }), conditions: "[]",
        actions: "[]", createdAt: at, updatedAt: at,
      },
      {
        id: "r3", workspaceId: "w1", name: "周报规则", enabled: 1, createdBy: "owner",
        updatedBy: "owner", trigger: JSON.stringify({ type: "task.created" }), conditions: "[]",
        actions: "[]", createdAt: at, updatedAt: at,
      },
    ])
    .run();

  const has = (hits: { id: string; kind: string }[], kind: string, id: string) =>
    hits.some((hit) => hit.kind === kind && hit.id === id);

  // --- member: every readable entity kind -----------------------------------------
  const result = await search("w1", "member", "zephyr", { limit: 50, includeCounts: true });
  const member = result.hits;
  assert(has(member, "doc", sharedPage.id), "shared document is indexed");
  assert(has(member, "task", "i1"), "task in a visible project is indexed");
  assert(has(member, "task_comment", "c1"), "task comment is indexed");
  assert(has(member, "doc_comment", sharedComments.at(-1)!.id), "document comment is indexed");
  assert(has(member, "project", "p1"), "visible project is indexed");
  assert(has(member, "label", "l1"), "label is indexed");
  assert(has(member, "agent_thread", "t1"), "shared agent thread is indexed");
  assert(has(member, "attachment", "a1"), "attachment on a readable page is indexed");
  assert(has(member, "attachment", "a4"), "attachment on a shared thread is indexed");
  assert(has(member, "automation", "r1"), "enabled automation rule is indexed");
  assert.equal(result.total, member.length, "total equals the number of hits under the limit");
  assert.equal(
    result.total,
    Object.values(result.counts).reduce((sum, value) => sum + (value ?? 0), 0),
    "kind counts add up to the total"
  );

  // --- member: impossible reads stay out ------------------------------------------
  assert(!has(member, "doc", privatePage.id), "another person's private document does not match");
  assert(!has(member, "doc_comment", privateCommentId), "its comment does not match");
  assert(!has(member, "task", "i2"), "a task in a project the member cannot see does not match");
  assert(!has(member, "task_comment", "c2"), "its comment does not match");
  assert(!has(member, "task", "i3"), "a deleted task does not match");
  assert(!has(member, "task_comment", "c3"), "a comment on a deleted task does not match");
  assert(!has(member, "project", "p2"), "a hidden project does not match");
  assert(!has(member, "project", "p3"), "a trashed project does not match");
  assert(!has(member, "agent_thread", "t2"), "another person's private thread does not match");
  assert(has(member, "agent_thread", "t3"), "a private thread is readable by the person who started it");
  assert(!has(member, "attachment", "a2"), "an attachment on a private page does not match");
  assert(!has(member, "attachment", "a3"), "an unfinished agent draft does not match");
  assert(!has(member, "automation", "r2"), "a disabled rule is not listed to members");
  assert(!member.some((hit) => hit.id === otherPage.id), "another workspace's document does not match");

  // --- owner: admin visibility and thread ownership -------------------------------
  const owner = (await search("w1", "owner", "zephyr", { limit: 50 })).hits;
  assert(has(owner, "doc", privatePage.id), "the owner sees their own private document");
  assert(has(owner, "task", "i2"), "an admin sees every project");
  assert(has(owner, "agent_thread", "t2"), "the thread's author sees a private thread");
  assert(!has(owner, "agent_thread", "t3"), "a private thread stays private to its author");
  assert(has(owner, "automation", "r2"), "an admin sees disabled automation rules");
  assert(!has(owner, "task", "i4"), "a task in a trashed project stays out for an admin");
  assert(!has(owner, "task_comment", "c4"), "its comment stays out for an admin");

  // --- people cross workspaces -----------------------------------------------------
  const peopleW1 = await search("w1", "member", "shared person", { limit: 20 });
  const peopleW2 = await search("w2", "owner", "shared person", { limit: 20 });
  const personW1 = peopleW1.hits.find((hit) => hit.kind === "person");
  const personW2 = peopleW2.hits.find((hit) => hit.kind === "person");
  assert(personW1?.id === "shared" && personW2?.id === "shared", "the same person is indexed once per workspace");
  assert(personW1?.context === "@shared", "a person hit shows their username");
  assert(personW1?.href === "/w1/people/shared", "a person hit links to their profile");
  const onlyOneEntry = await search("w2", "owner", "member", { limit: 20 });
  assert(!onlyOneEntry.hits.some((hit) => hit.kind === "person" && hit.id === "member"), "membership is per workspace");

  // --- agent threads: the latest reply is the body --------------------------------
  const oldReply = await search("w1", "member", "oldreplyword", { limit: 20 });
  assert(!oldReply.hits.some((hit) => hit.kind === "agent_thread" && hit.id === "t1"), "an older reply is replaced, not appended");
  const newReply = await search("w1", "member", "newreplyword", { limit: 20 });
  const replyHit = newReply.hits.find((hit) => hit.kind === "agent_thread" && hit.id === "t1");
  assert(replyHit, "the latest reply is searchable");
  assert(replyHit?.target === "thread" && replyHit?.href === "/w1/agent?thread=t1", "a thread opens the Agent tab");

  // --- snippets, targets and hrefs -------------------------------------------------
  const docHit = member.find((hit) => hit.kind === "doc" && hit.id === sharedPage.id)!;
  assert(docHit.snippet.toLowerCase().includes("zephyr"), "a document snippet contains the match");
  assert(docHit.target === "page", "a document hit opens the page panel");
  assert(docHit.byline === "Owner", "a document hit names its author");
  const taskHit = member.find((hit) => hit.kind === "task" && hit.id === "i1")!;
  assert(taskHit.ref === "Zephyr Core-1", "a task hit carries its reference");
  assert(taskHit.target === "issue", "a task hit opens the task panel");
  assert(taskHit.snippet.toLowerCase().includes("task body"), "a task snippet contains the body match");
  assert(member.find((hit) => hit.kind === "project" && hit.id === "p1")?.href === "/w1/projects/p1", "a project hit links to the project");
  assert(member.find((hit) => hit.kind === "label" && hit.id === "l1")?.href === "/w1/?label=Zephyr", "a label links to its task list");
  assert(member.find((hit) => hit.kind === "automation" && hit.id === "r1")?.href === "/w1/settings#automations", "a rule links to Settings");

  // --- CJK short terms across the new entities ------------------------------------
  const cjk = await search("w1", "member", "周报", { limit: 50 });
  assert(cjk.hits.some((hit) => hit.kind === "project" && hit.id === "p4"), "2-character Chinese finds a project");
  assert(cjk.hits.some((hit) => hit.kind === "label" && hit.id === "l2"), "2-character Chinese finds a label");
  assert(cjk.hits.some((hit) => hit.kind === "person" && hit.id === "zephyrite"), "2-character Chinese finds a person");
  assert(cjk.hits.some((hit) => hit.kind === "attachment" && hit.id === "a5"), "2-character Chinese finds an attachment");
  assert(cjk.hits.some((hit) => hit.kind === "automation" && hit.id === "r3"), "2-character Chinese finds a rule");

  // --- trash, delete and restore move the index -----------------------------------
  const { eq } = await import("drizzle-orm");
  db.update(schema.issues).set({ deletedAt: now }).where(eq(schema.issues.id, "i1")).run();
  assert(!(await search("w1", "member", "Zephyr launch")).hits.some((hit) => hit.id === "i1"), "trashing a task removes it");
  db.update(schema.issues).set({ deletedAt: null }).where(eq(schema.issues.id, "i1")).run();
  assert((await search("w1", "member", "Zephyr launch")).hits.some((hit) => hit.id === "i1"), "restoring a task brings it back");

  await pagesLib.deletePage("w1", sharedPage.id, "owner");
  assert(!(await search("w1", "member", "annotation on the page")).hits.length, "trashing a page removes its comments");
  await pagesLib.restorePage("w1", sharedPage.id, "owner");
  assert((await search("w1", "member", "annotation on the page")).hits.length, "restoring a page restores its comments");

  const commentId = sharedComments.at(-1)!.id;
  await pageComments.removePageComment("w1", sharedPage.id, "owner", commentId);
  assert(!(await search("w1", "member", "annotation on the page")).hits.length, "deleting a comment removes it");
  await pageComments.restorePageComment("w1", sharedPage.id, "owner", commentId);
  assert((await search("w1", "member", "annotation on the page")).hits.length, "restoring a comment brings it back");

  db.delete(schema.automationRules).where(eq(schema.automationRules.id, "r1")).run();
  assert(!(await search("w1", "owner", "Zephyr digest")).hits.some((hit) => hit.id === "r1"), "deleting a rule removes it");

  // --- filters still respect permissions ------------------------------------------
  const hiddenByFilter = await search("w1", "member", "zephyr", {
    group: "task",
    filters: { projectId: "p2" },
    limit: 20,
  });
  assert.equal(hiddenByFilter.hits.length, 0, "a project filter cannot reveal a hidden project");

  // --- a database from before this index upgrades in place ------------------------
  const sqlite = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client;
  sqlite.exec(`
    DELETE FROM search_fts;
    DROP TABLE search_entries;
    CREATE TABLE search_entries (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, UNIQUE(kind, ref_id)
    );
    DELETE FROM schema_migrations WHERE name = 'search_index_entities_v1';
  `);
  sqlite.close();
  delete (globalThis as { __tacosDb?: unknown }).__tacosDb;
  const rebuilt = await search("w1", "member", "zephyr", { limit: 50 });
  assert(rebuilt.hits.length > 0, "a pre-entities database is rebuilt on open");
  assert(rebuilt.hits.some((hit) => hit.kind === "attachment" && hit.id === "a1"), "the rebuild indexes the new entities");
  const rebuiltPeopleW1 = await search("w1", "member", "shared person", { limit: 20 });
  const rebuiltPeopleW2 = await search("w2", "owner", "shared person", { limit: 20 });
  assert(rebuiltPeopleW1.hits.some((hit) => hit.kind === "person"), "the rebuilt table keeps a person per workspace");
  assert(rebuiltPeopleW2.hits.some((hit) => hit.kind === "person"), "the same person is indexed in the second workspace after the rebuild");

  console.log("check-search-coverage: ok");
}

main().catch((error) => {
  console.error("check-search-coverage: fail -", error instanceof Error ? error.stack : error);
  process.exit(1);
});
