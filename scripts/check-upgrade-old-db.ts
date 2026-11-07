/**
 * 2.3 upgrade: a database created before the issue tree existed must still boot.
 * A 2.2 board has no issues.parent_id, and bootstrap used to create the index on that
 * column inside DDL — before the ALTER that adds it — so the whole script threw and
 * every request answered 500. This check builds that old shape and opens it.
 *   node --import tsx scripts/check-upgrade-old-db.ts
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-upgrade-"));
process.env.TACOS_DATA_DIR = dir;
process.env.TACOS_SEED_DEMO = "0";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// The 2.2 shape of the tasks table: no parent_id, no issues_parent_idx, one row worth
// keeping. Every other table is left to bootstrap, which creates what is missing.
const old = new Database(path.join(dir, "tacos.db"));
old.exec(`
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  created_via TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO issues (id, workspace_id, project_id, number, identifier, title, created_at, updated_at)
VALUES ('old-issue', 'ws-old', 'project-old', 1, 'OLD-1', 'kept', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
-- U-11: the 2.3 comments/events tables lack the new columns. Bootstrap must ALTER them
-- before creating indexes, or the whole upgrade aborts.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  author_id TEXT,
  agent_author TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT,
  agent_actor TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO events (id, issue_id, type, data, created_at)
VALUES ('old-event', 'old-issue', 'created', '{}', '2026-01-01T00:00:00.000Z');
`);
old.close();

async function main() {
  const { getDb } = await import("../src/db/client");
  getDb(); // Threw "no such column: parent_id" before the fix.
  const check = new Database(path.join(dir, "tacos.db"));
  const columns = check.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
  assert(
    columns.some((column) => column.name === "parent_id"),
    "bootstrap must add issues.parent_id to an older database"
  );
  const index = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'issues_parent_idx'")
    .get();
  assert(index, "bootstrap must create issues_parent_idx once the column exists");
  const pageIndex = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'pages_parent_idx'")
    .get();
  assert(pageIndex, "bootstrap must still index the page tree");
  const row = check.prepare("SELECT title FROM issues WHERE id = 'old-issue'").get() as
    | { title: string }
    | undefined;
  assert(row?.title === "kept", "an upgrade keeps the tasks that were already there");
  const commentColumns = check.prepare("PRAGMA table_info(comments)").all() as Array<{ name: string }>;
  assert(
    commentColumns.some((column) => column.name === "parent_id"),
    "bootstrap must add comments.parent_id to an older database"
  );
  const eventColumns = check.prepare("PRAGMA table_info(events)").all() as Array<{ name: string }>;
  assert(
    eventColumns.some((column) => column.name === "workspace_id"),
    "bootstrap must add events.workspace_id to an older database"
  );
  const eventIndex = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'events_workspace_idx'")
    .get();
  assert(eventIndex, "bootstrap must index events after the ALTER");
  const watcherTable = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'watchers'")
    .get();
  assert(watcherTable, "bootstrap must create the watchers table on an older database");
  // U-03: an upgraded database gets the planning links and tables, so the planning
  // surface does not die with "no such column: cycle_id".
  const planningColumns = check.prepare("PRAGMA table_info(issues)").all() as Array<{ name: string }>;
  assert(
    planningColumns.some((column) => column.name === "cycle_id"),
    "bootstrap must add issues.cycle_id to an older database"
  );
  assert(
    planningColumns.some((column) => column.name === "milestone_id"),
    "bootstrap must add issues.milestone_id to an older database"
  );
  for (const table of ["cycle_settings", "cycles", "project_milestones", "initiatives", "initiative_projects", "initiative_labels"]) {
    const row = check
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    assert(row, `bootstrap must create ${table} on an older database`);
  }
  const planningIndex = check
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'issues_cycle_idx'")
    .get();
  assert(planningIndex, "bootstrap must index issues.cycle_id after the ALTER");
  check.close();
  console.log("ok   2.3 upgrade boots on a database without issues.parent_id");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
