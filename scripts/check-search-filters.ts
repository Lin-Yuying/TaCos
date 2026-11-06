/**
 * U-10 search filters: kind groups, project/assignee/status/date filters, sorting,
 * pagination, CJK short terms, snippets, the palette's scopes, and the 300 ms budget
 * on a seeded 10k-task / 1k-document workspace.
 *   npx tsx scripts/check-search-filters.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-search-filters-"));
process.env.TACOS_SEED_DEMO = "0";

async function main() {
  const { getDb } = await import("../src/db/client");
  const schema = await import("../src/db/schema");
  const { search } = await import("../src/lib/search");
  const { parseSearchInput, removeSearchToken, dateBound } = await import("../src/lib/search-query");
  const db = getDb();
  const at = "2026-01-01T00:00:00.000Z";

  db.insert(schema.users)
    .values([
      { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", createdAt: at },
      { id: "member", username: "member", displayName: "Member", passwordHash: "x", createdAt: at },
      { id: "alpha", username: "alpha", displayName: "Alpha Person", passwordHash: "x", createdAt: at },
    ])
    .run();
  db.insert(schema.workspaces)
    .values({ id: "w", name: "Workspace", key: "WS", createdBy: "owner", membersSeeAllTasks: 0, createdAt: at } as never)
    .run();
  db.insert(schema.workspaceMembers)
    .values([
      { workspaceId: "w", userId: "owner", role: "admin", createdAt: at },
      { workspaceId: "w", userId: "member", role: "member", createdAt: at },
      { workspaceId: "w", userId: "alpha", role: "member", createdAt: at },
    ])
    .run();
  db.insert(schema.projects)
    .values([
      { id: "pa", workspaceId: "w", name: "Alpha Project", key: "AP", description: "alpha project", createdBy: "owner", createdAt: at },
      { id: "pb", workspaceId: "w", name: "Beta Project", key: "BP", description: "beta project", createdBy: "owner", createdAt: at },
    ])
    .run();
  db.insert(schema.projectMembers)
    .values([
      { projectId: "pa", userId: "member", createdAt: at },
      { projectId: "pb", userId: "member", createdAt: at },
    ])
    .run();

  const issue = (
    id: string,
    number: number,
    projectId: string,
    title: string,
    status: string,
    createdAt: string,
    updatedAt: string
  ) => ({
    id,
    workspaceId: "w",
    projectId,
    number,
    identifier: `${projectId.toUpperCase()}-${number}`,
    title,
    description: "alpha body",
    status,
    createdBy: "owner",
    createdAt,
    updatedAt,
  });
  db.insert(schema.issues)
    .values([
      issue("t1", 1, "pa", "Alpha launch", "todo", "2026-01-01T00:00:00.000Z", "2026-01-10T00:00:00.000Z"),
      issue("t2", 2, "pa", "Alpha review", "done", "2026-02-01T00:00:00.000Z", "2026-02-10T00:00:00.000Z"),
      issue("t3", 3, "pb", "Alpha docs", "in_progress", "2026-03-01T00:00:00.000Z", "2026-03-10T00:00:00.000Z"),
      ...Array.from({ length: 30 }, (_, index) =>
        issue(
          `fill-${index}`,
          100 + index,
          "pa",
          `Alpha filler ${index}`,
          "todo",
          `2025-12-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
          `2025-12-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`
        )
      ),
    ] as never)
    .run();
  db.insert(schema.issueAssignees)
    .values([
      { issueId: "t1", userId: "member", createdAt: at },
      { issueId: "t3", userId: "owner", createdAt: at },
    ])
    .run();
  db.insert(schema.comments)
    .values({ id: "c1", issueId: "t1", authorId: "member", body: "alpha comment", createdAt: at })
    .run();
  db.insert(schema.pages)
    .values([
      {
        id: "d1", workspaceId: "w", projectId: "pa", title: "Alpha document",
        doc: "alpha document body", createdBy: "owner", shared: 1,
        createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "d2", workspaceId: "w", projectId: "pa", title: "Alpha secret",
        doc: "alpha private body", createdBy: "owner", shared: 0,
        createdAt: "2026-01-06T00:00:00.000Z", updatedAt: "2026-04-02T00:00:00.000Z",
      },
    ] as never)
    .run();
  db.insert(schema.labels)
    .values({ id: "l1", workspaceId: "w", name: "Alpha label", color: "#111111", createdAt: at })
    .run();
  db.insert(schema.agentThreads)
    .values({
      id: "th1", workspaceId: "w", projectId: "pb", title: "Alpha thread", engine: "codex",
      visibility: "shared", createdBy: "owner", createdAt: at, updatedAt: at,
    } as never)
    .run();
  db.insert(schema.agentMessages)
    .values({ id: "m1", threadId: "th1", role: "assistant", content: "alpha reply", createdAt: at })
    .run();
  db.insert(schema.attachments)
    .values({ id: "a1", workspaceId: "w", pageId: "d1", uploaderId: "owner", name: "Alpha file.png", size: 1, complete: 1, createdAt: at })
    .run();
  db.insert(schema.automationRules)
    .values({
      id: "r1", workspaceId: "w", name: "Alpha rule", enabled: 1, createdBy: "owner",
      updatedBy: "owner", trigger: JSON.stringify({ type: "task.created" }), conditions: "[]",
      actions: "[]", createdAt: at, updatedAt: at,
    })
    .run();

  const base = { limit: 50, includeCounts: true } as const;
  const ids = (hits: { id: string }[]) => hits.map((hit) => hit.id);
  const kinds = (hits: { kind: string }[]) => [...new Set(hits.map((hit) => hit.kind))].sort();

  // --- kind groups -----------------------------------------------------------------
  const all = await search("w", "member", "alpha", base);
  assert.equal(all.total, all.hits.length, "total matches the hits under the limit");
  assert(kinds(all.hits).includes("task") && kinds(all.hits).includes("doc"), "all groups are in the default search");
  assert(!all.hits.some((hit) => hit.id === "d2"), "a private document never enters the counts");
  for (const [group, expected] of [
    ["task", ["task"]],
    ["doc", ["doc"]],
    ["comment", ["task_comment"]],
    ["project", ["project"]],
    ["person", ["person"]],
    ["label", ["label"]],
    ["agent", ["agent_thread"]],
    ["attachment", ["attachment"]],
    ["automation", ["automation"]],
  ] as const) {
    const result = await search("w", "member", "alpha", { ...base, group });
    assert(result.hits.length > 0, `the ${group} tab returns hits`);
    assert(
      result.hits.every((hit) => (expected as readonly string[]).includes(hit.kind)),
      `the ${group} tab only returns its kinds: ${kinds(result.hits)}`
    );
  }

  // --- project, assignee, status ---------------------------------------------------
  const projectA = await search("w", "member", "alpha", { ...base, filters: { projectId: "pa" } });
  assert(projectA.hits.length > 0, "project filter returns hits");
  assert(projectA.hits.every((hit) => ["task", "task_comment", "doc", "project", "attachment"].includes(hit.kind)), `project filter only keeps project-aware kinds: ${kinds(projectA.hits)}`);
  assert(projectA.counts.label === 0 && projectA.counts.person === 0 && projectA.counts.automation === 0, "workspace-wide kinds are excluded by a project filter");
  assert(!projectA.hits.some((hit) => hit.id === "t3"), "a task in another project is excluded");
  assert(!projectA.hits.some((hit) => hit.id === "d2"), "a private document in the project is still excluded");

  const mine = await search("w", "member", "alpha", { ...base, group: "task", filters: { assignee: "me" } });
  assert.deepEqual(ids(mine.hits), ["t1"], "assignee=me resolves to the viewer");
  assert(mine.counts.task === 1 && mine.counts.doc === 0, "task-only filters zero the other kinds");

  const unassigned = await search("w", "member", "alpha", { ...base, group: "task", filters: { assignee: "none" } });
  assert(unassigned.hits.some((hit) => hit.id === "t2"), "assignee=none finds unassigned tasks");
  assert(!unassigned.hits.some((hit) => hit.id === "t1" || hit.id === "t3"), "assignee=none excludes assigned tasks");

  const ownerTasks = await search("w", "member", "alpha", { ...base, group: "task", filters: { assignee: "owner" } });
  assert.deepEqual(ids(ownerTasks.hits), ["t3"], "a user id narrows to that assignee");

  const done = await search("w", "member", "alpha", { ...base, group: "task", filters: { status: "done" } });
  assert.deepEqual(ids(done.hits), ["t2"], "status filters tasks");

  // --- created / updated -----------------------------------------------------------
  const createdSince = await search("w", "member", "alpha", { ...base, group: "task", filters: { createdFrom: "2026-02-01" } });
  assert.deepEqual(ids(createdSince.hits).sort(), ["t2", "t3"], "createdFrom keeps newer tasks");
  const updatedSince = await search("w", "member", "alpha", { ...base, group: "task", filters: { updatedFrom: "2026-03-01" } });
  assert.deepEqual(ids(updatedSince.hits), ["t3"], "updatedFrom keeps recently touched tasks");
  const updatedBefore = await search("w", "member", "alpha", { ...base, group: "task", filters: { updatedTo: "2026-02-28" } });
  assert(!updatedBefore.hits.some((hit) => hit.id === "t3"), "updatedTo drops newer tasks");
  assert(updatedBefore.hits.some((hit) => hit.id === "t1"), "updatedTo keeps older tasks");

  // --- sorting ---------------------------------------------------------------------
  const relevance = await search("w", "member", "alpha launch", { ...base, group: "task", limit: 5 });
  assert.equal(relevance.hits[0]?.id, "t1", "an exact title phrase ranks first");
  const byUpdated = await search("w", "member", "alpha", { ...base, group: "task", limit: 3, sort: "updated" });
  assert.deepEqual(ids(byUpdated.hits), ["t3", "t2", "t1"], "updated sorts newest first");
  const byCreated = await search("w", "member", "alpha", { ...base, group: "task", limit: 3, sort: "created" });
  assert.deepEqual(ids(byCreated.hits), ["t3", "t2", "t1"], "created sorts newest first");

  // --- pagination ------------------------------------------------------------------
  const page1 = await search("w", "member", "alpha", { ...base, group: "task", limit: 20, offset: 0 });
  const page2 = await search("w", "member", "alpha", { ...base, group: "task", limit: 20, offset: 20 });
  assert.equal(page1.hits.length, 20, "page one is full");
  assert.equal(page1.total, 33, "total counts every task in the group");
  assert.equal(page2.hits.length, 13, "page two keeps the remainder");
  assert(!page2.hits.some((hit) => ids(page1.hits).includes(hit.id)), "pages do not overlap");
  assert.equal(new Set([...ids(page1.hits), ...ids(page2.hits)]).size, 33, "pages cover every task");
  const perKind = await search("w", "member", "alpha", { perKindLimit: 2, includeCounts: false });
  const perKindCounts = new Map<string, number>();
  for (const hit of perKind.hits) perKindCounts.set(hit.kind, (perKindCounts.get(hit.kind) ?? 0) + 1);
  assert([...perKindCounts.values()].every((count) => count <= 2), "perKindLimit caps every kind for the palette");

  // --- snippets --------------------------------------------------------------------
  const docHit = all.hits.find((hit) => hit.kind === "doc" && hit.id === "d1")!;
  assert(docHit.snippet.toLowerCase().includes("alpha"), "document snippet contains the match");
  const commentHit = all.hits.find((hit) => hit.kind === "task_comment")!;
  assert(commentHit.snippet.toLowerCase().includes("alpha"), "comment snippet contains the match");
  const labelHit = all.hits.find((hit) => hit.kind === "label")!;
  assert.equal(labelHit.snippet, "", "a title-only hit has no fake snippet");

  // --- palette grammar -------------------------------------------------------------
  assert.equal(parseSearchInput("i alpha").group, "task", "i scopes to tasks");
  assert.equal(parseSearchInput("p alpha").group, "project", "p scopes to projects");
  assert.equal(parseSearchInput("u alpha").group, "person", "u scopes to people");
  assert.equal(parseSearchInput("d alpha").group, "doc", "d scopes to documents");
  assert.equal(parseSearchInput("a alpha").group, "agent", "a scopes to Agent threads");
  assert.equal(parseSearchInput("f alpha").group, "attachment", "f scopes to attachments");
  assert.equal(parseSearchInput("i: alpha").text, "alpha", "the separator can be a colon");
  assert.equal(parseSearchInput("is alpha").group, "all", "a word starting with i is not a prefix");
  const filtered = parseSearchInput("alpha @me @done");
  assert.equal(filtered.text, "alpha", "@ tokens are removed from the query text");
  assert.equal(filtered.filters.assignee, "me", "@me becomes an assignee filter");
  assert.equal(filtered.filters.status, "done", "@done becomes a status filter");
  assert.equal(parseSearchInput("alpha @none").filters.assignee, "none", "@none means unassigned");
  assert.equal(parseSearchInput("alpha @someone").text, "alpha @someone", "an unknown @word stays searchable");
  assert.equal(parseSearchInput("@me").text, "", "@me alone has no free text");
  assert.equal(removeSearchToken("alpha @me", "@me"), "alpha", "a filter chip removes its token");
  assert.equal(dateBound("2026-02-01", false), "2026-02-01T00:00:00.000Z", "a date starts at midnight");
  assert.equal(dateBound("2026-02-01", true), "2026-02-01T23:59:59.999Z", "a date ends at the last millisecond");
  assert.equal(dateBound("not-a-date", false), undefined, "an invalid date is dropped");

  // --- performance: 10k tasks + 1k documents ---------------------------------------
  const sqlite = (db as unknown as { $client: { exec(sql: string): void; prepare(sql: string): { run(...values: unknown[]): void } } }).$client;
  const startedSeed = Date.now();
  sqlite.exec("BEGIN");
  try {
    const insertIssue = sqlite.prepare(`INSERT INTO issues
      (id, workspace_id, project_id, number, identifier, title, description, status, priority, position, created_at, updated_at)
      VALUES (?, 'w', 'pa', ?, ?, ?, 'common performance body', 'todo', 0, ?, ?, ?)`);
    for (let index = 0; index < 10_000; index += 1) {
      const cjk = index % 100 === 0 ? `性能任务 ${index}` : `Perf task ${index}`;
      const title = index === 9999 ? "Perf needleperf task alive" : cjk;
      insertIssue.run(
        `perf-i-${index}`,
        index + 1000,
        `PERF-${index}`,
        title,
        index,
        at,
        "2026-05-01T00:00:00.000Z"
      );
    }
    const insertPage = sqlite.prepare(`INSERT INTO pages
      (id, workspace_id, project_id, title, doc, created_by, shared, created_at, updated_at)
      VALUES (?, 'w', 'pa', ?, ?, 'owner', 1, ?, ?)`);
    for (let index = 0; index < 1_000; index += 1) {
      insertPage.run(
        `perf-d-${index}`,
        index === 999 ? "Perf needleperf document" : `Perf document ${index}`,
        "performance documentation body",
        at,
        "2026-05-02T00:00:00.000Z"
      );
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  const seedMs = Date.now() - startedSeed;

  const needleRuns: { wall: number; server: number; hits: number }[] = [];
  for (let run = 0; run < 3; run += 1) {
    const before = Date.now();
    const result = await search("w", "member", "needleperf", { limit: 20, includeCounts: true });
    needleRuns.push({ wall: Date.now() - before, server: result.tookMs, hits: result.hits.length });
    assert(result.hits.some((hit) => hit.kind === "task" && hit.id === "perf-i-9999"), "the seeded task is found");
    assert(result.hits.some((hit) => hit.kind === "doc" && hit.id === "perf-d-999"), "the seeded document is found");
  }
  const bestServer = Math.min(...needleRuns.map((run) => run.server));
  const bestWall = Math.min(...needleRuns.map((run) => run.wall));
  assert(bestServer < 300, `server search on 10k/1k is under 300 ms (took ${bestServer} ms)`);

  const broad = await search("w", "member", "common", { limit: 20, includeCounts: true });
  assert.equal(broad.hits.length, 20, "a broad term still pages at the requested size");
  assert(broad.total >= 10_000, "a broad term counts every matching task");
  assert(broad.tookMs < 300, `a broad 10k-match query is under 300 ms (took ${broad.tookMs} ms)`);

  const cjkStarted = Date.now();
  const cjk = await search("w", "member", "性能", { limit: 20, includeCounts: true });
  const cjkServer = Date.now() - cjkStarted;
  assert(cjk.hits.length > 0, "the seeded Chinese titles are found through the short-term fallback");
  assert(cjkServer < 300, `a 2-character Chinese scan on 10k/1k is under 300 ms (took ${cjkServer} ms)`);

  console.log(
    `check-search-filters: ok (seed ${seedMs} ms; needleperf ${bestServer} ms server / ${bestWall} ms wall; broad ${broad.tookMs} ms; 性能 ${cjkServer} ms)`
  );
}

main().catch((error) => {
  console.error("check-search-filters: fail -", error instanceof Error ? error.stack : error);
  process.exit(1);
});
