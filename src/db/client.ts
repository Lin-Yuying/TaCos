import { ensureRevisions } from "./revisions";
import { DATA_DIR } from "@/lib/data-dir";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from "../lib/constants";
import { BUILTIN_AVATAR_PREFIX, builtinAvatarId, nextFreeAvatar } from "../lib/avatars";
import * as schema from "./schema";

export { DATA_DIR };

const DDL = `
CREATE TABLE IF NOT EXISTS personal_task_views (
 workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,
 PRIMARY KEY(workspace_id,user_id,scope,name)
);

CREATE TABLE IF NOT EXISTS personal_entity_state (
  user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  pinned_at TEXT, position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, workspace_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retired_usernames (
  username TEXT PRIMARY KEY,
  retired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_username_idx ON login_attempts (username, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS device_accounts (
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_by TEXT,
  members_see_all_tasks INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS join_codes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_COLOR}',
  description TEXT NOT NULL DEFAULT '',
  doc TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects (workspace_id);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id);

CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites (user_id);

CREATE TABLE IF NOT EXISTS project_grants (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_grants_user_idx ON project_grants (user_id);

CREATE TABLE IF NOT EXISTS overview_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT,
  occurrence INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS overview_comments_project_idx ON overview_comments (project_id);

CREATE TABLE IF NOT EXISTS overview_doc_edits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  doc_before TEXT NOT NULL,
  doc_after TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS overview_doc_edits_project_idx ON overview_doc_edits (project_id);

CREATE TABLE IF NOT EXISTS overview_doc_edit_views (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- The Resources row on a project overview: attached documents and links, in the order
-- they were added. A document resource points at a page; the title is read live.
CREATE TABLE IF NOT EXISTS project_resources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  page_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_resources_project_idx ON project_resources (project_id);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  parent_id TEXT,
  project_id TEXT,
  title TEXT NOT NULL,
  icon TEXT,
  doc TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pages_workspace_idx ON pages (workspace_id);

CREATE TABLE IF NOT EXISTS task_fields (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_fields_workspace_idx ON task_fields (workspace_id);

CREATE TABLE IF NOT EXISTS task_field_values (
  issue_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (issue_id, field_id)
);
CREATE INDEX IF NOT EXISTS task_field_values_field_idx ON task_field_values (field_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_page_idx ON attachments (page_id);
CREATE INDEX IF NOT EXISTS attachments_workspace_idx ON attachments (workspace_id);

CREATE TABLE IF NOT EXISTS page_favorites (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, page_id)
);

CREATE TABLE IF NOT EXISTS page_access (
  page_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS page_comments (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  quote TEXT,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  via TEXT NOT NULL DEFAULT 'you',
  resolved_at TEXT,
  parent_id TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS page_comments_page_idx ON page_comments (page_id);

CREATE TABLE IF NOT EXISTS page_collab (
    page_id TEXT PRIMARY KEY,
    state BLOB NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  doc TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  via TEXT NOT NULL,
  reason TEXT NOT NULL,
  restored_from INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS page_versions_page_seq_idx ON page_versions (page_id, seq);
CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent_id);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  number INTEGER NOT NULL,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_via TEXT NOT NULL DEFAULT 'web',
  due_date TEXT,
  reminder TEXT,
  deleted_at TEXT,
  position REAL NOT NULL DEFAULT 0,
  claimed_by TEXT,
  claimed_at TEXT,
  source_thread_id TEXT,
  published_by TEXT,
  review_status TEXT NOT NULL DEFAULT 'approved',
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_workspace_idx ON issues (workspace_id);
CREATE INDEX IF NOT EXISTS issues_project_idx ON issues (project_id);
CREATE INDEX IF NOT EXISTS issues_status_idx ON issues (status);

CREATE TABLE IF NOT EXISTS issue_dependencies (
  issue_id TEXT NOT NULL,
  blocked_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, blocked_by_id)
);
CREATE INDEX IF NOT EXISTS issue_dependencies_blocked_idx ON issue_dependencies (blocked_by_id);

CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX IF NOT EXISTS issue_assignees_user_idx ON issue_assignees (user_id);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5e6ad2',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS labels_workspace_idx ON labels (workspace_id);

CREATE TABLE IF NOT EXISTS issue_labels (
  issue_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (issue_id, label_id)
);

CREATE TABLE IF NOT EXISTS blockers (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS blockers_issue_idx ON blockers (issue_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  author_id TEXT,
  agent_author TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_issue_idx ON comments (issue_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT,
  agent_actor TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_issue_idx ON events (issue_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (workspace_id, user_id);
CREATE INDEX IF NOT EXISTS notifications_issue_idx ON notifications (issue_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS api_keys_workspace_idx ON api_keys (workspace_id);

-- Agent conversations live beside the workspace they belong to: each one is bound to a
-- project, the way a Codex thread is bound to a folder. Messages and trajectory steps
-- are kept so a thread can be reopened later.
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT 'codex',
  visibility TEXT NOT NULL DEFAULT 'private',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_threads_workspace_idx ON agent_threads (workspace_id, updated_at);

-- Pin and unread belong to the viewer, so two members can arrange a shared thread
-- differently. A missing row means "not pinned, read".
CREATE TABLE IF NOT EXISTS agent_thread_flags (
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pinned_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_messages_thread_idx ON agent_messages (thread_id);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_steps_thread_idx ON agent_steps (thread_id);
CREATE INDEX IF NOT EXISTS agent_steps_message_idx ON agent_steps (message_id);

-- One AI provider per workspace. The key is stored encrypted with a secret that lives
-- beside the database, never in the repository or in the browser.
CREATE TABLE IF NOT EXISTS ai_settings (
  workspace_id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'api',
  proxy TEXT NOT NULL DEFAULT '',
  harness_enabled TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS user_model_keys (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT NOT NULL,
  edit_model TEXT NOT NULL DEFAULT '',
  for_edits INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE IF NOT EXISTS runner_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runner_status (
  user_id TEXT PRIMARY KEY,
  capabilities TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  thread_id TEXT,
  issue_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_user_status ON agent_runs(user_id, status);
`;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function minutesAgo(min: number) {
  return new Date(Date.now() - min * 60_000).toISOString();
}

function seed(sqlite: Database.Database) {
  // A single-user desktop install wants an empty board, not demo teammates.
  if (process.env.TACOS_SEED_DEMO === "0") return;
  const count = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) return;

  const now = new Date().toISOString();
  const wsId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO workspaces (id, name, key, created_at) VALUES (?, ?, ?, ?)")
    .run(wsId, "TaCos", "HQ", now);

  sqlite
    .prepare(
      "INSERT INTO join_codes (id, workspace_id, code, created_by, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(crypto.randomUUID(), wsId, "HQ-TACOS-1234", "seed", now);

  const demoPassword = hashPassword("password123");
  const alexId = crypto.randomUUID();
  const samId = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(alexId, "alex", "Alex Chen", demoPassword, minutesAgo(60 * 24 * 7));
  sqlite
    .prepare("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(samId, "sam", "Sam Rivera", demoPassword, minutesAgo(60 * 24 * 6));
  sqlite
    .prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(wsId, alexId, "admin", minutesAgo(60 * 24 * 7));
  sqlite
    .prepare("INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
    .run(wsId, samId, "member", minutesAgo(60 * 24 * 6));

  const insertProject = sqlite.prepare(
    "INSERT INTO projects (id, workspace_id, name, key, color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const coreId = crypto.randomUUID();
  const agentsId = crypto.randomUUID();
  insertProject.run(coreId, wsId, "Core", "CORE", PROJECT_COLORS[0], alexId, minutesAgo(60 * 24 * 5));
  insertProject.run(agentsId, wsId, "Agents", "AGT", PROJECT_COLORS[1], alexId, minutesAgo(60 * 24 * 5));

  const insertLabel = sqlite.prepare(
    "INSERT INTO labels (id, workspace_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const labels: Array<[string, string]> = [
    ["Bug", "#eb5757"],
    ["Feature", "#5e6ad2"],
    ["Improvement", "#4cb782"],
    ["Design", "#ec4899"],
    ["Agent", "#a78bfa"],
  ];
  const labelIds = new Map<string, string>();
  for (const [name, color] of labels) {
    const id = crypto.randomUUID();
    labelIds.set(name, id);
    insertLabel.run(id, wsId, name, color, minutesAgo(60 * 24 * 4));
  }

  const insertIssue = sqlite.prepare(`INSERT INTO issues
    (id, workspace_id, project_id, number, identifier, title, description, status, priority, created_by, created_via, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertIssueLabel = sqlite.prepare(
    "INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)"
  );
  const insertIssueAssignee = sqlite.prepare(
    "INSERT INTO issue_assignees (issue_id, user_id, created_at) VALUES (?, ?, ?)"
  );
  const insertEvent = sqlite.prepare(
    "INSERT INTO events (id, issue_id, type, data, actor_id, agent_actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertComment = sqlite.prepare(
    "INSERT INTO comments (id, issue_id, author_id, agent_author, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );

  type SeedIssue = {
    project: string;
    title: string;
    description: string;
    status: string;
    priority: number;
    assignees: string[];
    via: string;
    actor: string | null;
    created: number;
    updated: number;
    labels?: string[];
    comment?: [string, string | null, number];
  };

  const seedIssues: SeedIssue[] = [
    {
      project: "CORE",
      title: "Set up API key authentication",
      description: "Agents call /api/v1/* with a Bearer token. Keys are created in Settings and stored as SHA-256 hashes.",
      status: "todo",
      priority: 2,
      assignees: [alexId, samId],
      via: "web",
      actor: alexId,
      created: 60 * 26,
      updated: 60 * 25,
      labels: ["Feature"],
    },
    {
      project: "CORE",
      title: "Design dark theme color tokens",
      description: "Define the palette once in globals.css: background, elevated surfaces, borders, and status colors.",
      status: "in_progress",
      priority: 3,
      assignees: [samId],
      via: "web",
      actor: samId,
      created: 60 * 30,
      updated: 40,
      labels: ["Design"],
    },
    {
      project: "CORE",
      title: "Fix issue list scroll jitter",
      description: "Hovering rows causes a 1px layout shift because of the border strategy.",
      status: "todo",
      priority: 4,
      assignees: [],
      via: "api",
      actor: null,
      created: 60 * 5,
      updated: 60 * 4,
      labels: ["Bug", "Improvement"],
    },
    {
      project: "AGT",
      title: "Write MCP server tool definitions",
      description: "Expose list/get/create/update/delete issue, add_comment, and label tools over stdio so Claude can work the backlog directly.",
      status: "done",
      priority: 3,
      assignees: [alexId],
      via: "mcp",
      actor: null,
      created: 60 * 50,
      updated: 60 * 20,
      labels: ["Agent"],
      comment: ["Registered 8 tools: list_issues, get_issue, create_issue, update_issue, delete_issue, add_comment, list_labels, create_label.", null, 60 * 20],
    },
    {
      project: "CORE",
      title: "Add keyboard shortcuts cheat sheet",
      description: "Document C, Cmd+K, J/K, Enter and Esc in the README.",
      status: "done",
      priority: 1,
      assignees: [],
      via: "web",
      actor: samId,
      created: 60 * 48,
      updated: 60 * 22,
      labels: ["Improvement"],
    },
    {
      project: "AGT",
      title: "Evaluate drag-and-drop reordering",
      description: "Nice to have, keyboard-first ordering covers the main flows for now.",
      status: "canceled",
      priority: 0,
      assignees: [],
      via: "web",
      actor: alexId,
      created: 60 * 72,
      updated: 60 * 71,
    },
  ];

  const projectIds = new Map([
    ["CORE", coreId],
    ["AGT", agentsId],
  ]);
  const counters = new Map<string, number>();

  for (const item of seedIssues) {
    const next = (counters.get(item.project) ?? 0) + 1;
    counters.set(item.project, next);
    const id = crypto.randomUUID();
    const identifier = `${item.project}-${next}`;
    insertIssue.run(
      id,
      wsId,
      projectIds.get(item.project)!,
      next,
      identifier,
      item.title,
      item.description,
      item.status,
      item.priority,
      item.actor,
      item.via,
      minutesAgo(item.created),
      minutesAgo(item.updated)
    );
    for (const labelName of item.labels ?? []) {
      insertIssueLabel.run(id, labelIds.get(labelName)!);
    }
    for (const assigneeId of item.assignees) {
      insertIssueAssignee.run(id, assigneeId, minutesAgo(item.created));
    }
    insertEvent.run(
      crypto.randomUUID(),
      id,
      "created",
      JSON.stringify({ title: item.title }),
      item.actor,
      item.via === "web" ? null : item.via,
      minutesAgo(item.created)
    );
    if (item.comment) {
      insertComment.run(
        crypto.randomUUID(),
        id,
        item.comment[1],
        item.via === "web" ? null : "mcp",
        item.comment[0],
        minutesAgo(item.comment[2])
      );
    }
  }
}

function tableExists(sqlite: Database.Database, table: string): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  );
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string
): boolean {
  if (hasColumn(sqlite, table, column)) return false;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function dropColumnIfPresent(sqlite: Database.Database, table: string, column: string): boolean {
  if (!hasColumn(sqlite, table, column)) return false;
  try {
    sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    return true;
  } catch {
    // Older SQLite builds reject DROP COLUMN. The app no longer reads this field.
    return false;
  }
}

export const BUILT_IN_ADMIN = "admin";

// Guarantees the superuser exists so a fresh install is never locked out.
// TACOS_ADMIN_PASSWORD only seeds the first creation; afterwards the account is
// managed from the admin console.
function ensureSuperAdmin(sqlite: Database.Database) {
  const existing = sqlite
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(BUILT_IN_ADMIN) as { id: string } | undefined;
  if (existing) {
    sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
    return;
  }
  sqlite
    .prepare(
      "INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)"
    )
    .run(
      crypto.randomUUID(),
      BUILT_IN_ADMIN,
      "TaCos Admin",
      hashPassword(process.env.TACOS_ADMIN_PASSWORD || "admin123"),
      new Date().toISOString()
    );
}

// Every account starts with a taco ingredient so a new server never shows a wall of
// initials. Uploads are kept; blank avatars — and avatars still pointing at the
// retired animal set — are replaced, and no two users on the same server share one
// until the library runs out.
function ensureInitialAvatars(sqlite: Database.Database) {
  const rows = sqlite
    .prepare("SELECT id, avatar FROM users ORDER BY created_at, id")
    .all() as Array<{ id: string; avatar: string | null }>;
  const update = sqlite.prepare("UPDATE users SET avatar = ? WHERE id = ?");
  const taken: Array<string | null> = [];
  const pending: typeof rows = [];
  for (const row of rows) {
    const builtin = builtinAvatarId(row.avatar);
    if (builtin) {
      taken.push(row.avatar);
    } else if (!row.avatar || row.avatar.startsWith(BUILTIN_AVATAR_PREFIX)) {
      pending.push(row);
    }
  }
  for (const row of pending) {
    const avatar = nextFreeAvatar(taken);
    update.run(avatar, row.id);
    taken.push(avatar);
  }
}

// Triggers keep search_fts in step with every write path. The trigram tokenizer needs no word
// breaks, so Chinese matches without a dictionary. Titles of tasks carry the identifier.
function ensureSearchIndex(sqlite: Database.Database) {
  sqlite.transaction(() => {
    const migrate = !tableExists(sqlite, "search_entries") || !tableExists(sqlite,"search_fts");
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      kind UNINDEXED, ref_id UNINDEXED, workspace_id UNINDEXED, title, body, tokenize = 'trigram'
    );
    CREATE TABLE IF NOT EXISTS search_entries (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, UNIQUE(kind, ref_id)
    );
    CREATE INDEX IF NOT EXISTS search_entries_scope ON search_entries(workspace_id,kind,id);`);
    const sources = [
      {table:"pages",kind:"doc",workspace:"new.workspace_id",title:"new.title",body:"new.doc",columns:"title, doc",changed:"new.title IS NOT old.title OR new.doc IS NOT old.doc",condition:"1",select:"SELECT 'doc',id,workspace_id,title,doc FROM pages"},
      {table:"issues",kind:"task",workspace:"new.workspace_id",title:"new.identifier || ' ' || new.title",body:"new.description",columns:"identifier, title, description",changed:"new.identifier IS NOT old.identifier OR new.title IS NOT old.title OR new.description IS NOT old.description",condition:"1",select:"SELECT 'task',id,workspace_id,identifier || ' ' || title,description FROM issues"},
      {table:"comments",kind:"task_comment",workspace:"(SELECT workspace_id FROM issues WHERE id=new.issue_id)",title:"''",body:"new.body",columns:"body",changed:"new.body IS NOT old.body",condition:"1",select:"SELECT 'task_comment',c.id,i.workspace_id,'',c.body FROM comments c JOIN issues i ON i.id=c.issue_id"},
      {table:"page_comments",kind:"doc_comment",workspace:"new.workspace_id",title:"''",body:"new.body",columns:"body, deleted_at",changed:"new.body IS NOT old.body OR new.deleted_at IS NOT old.deleted_at",condition:"new.deleted_at IS NULL",select:"SELECT 'doc_comment',id,workspace_id,'',body FROM page_comments WHERE deleted_at IS NULL"},
    ];
    for (const source of sources) {
      if(migrate)for(const suffix of ["ai","au","ad"])sqlite.exec(`DROP TRIGGER IF EXISTS search_${source.table}_${suffix}`);
      const insert = `INSERT OR IGNORE INTO search_entries(kind,ref_id,workspace_id) SELECT '${source.kind}',new.id,${source.workspace} WHERE ${source.condition};
        INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
        SELECT id,kind,ref_id,workspace_id,${source.title},${source.body} FROM search_entries WHERE kind='${source.kind}' AND ref_id=new.id AND ${source.condition};`;
      const remove = `DELETE FROM search_fts WHERE rowid=(SELECT id FROM search_entries WHERE kind='${source.kind}' AND ref_id=old.id);`;
      sqlite.exec(`CREATE TRIGGER IF NOT EXISTS search_${source.table}_ai AFTER INSERT ON ${source.table} BEGIN ${insert} END;
      CREATE TRIGGER IF NOT EXISTS search_${source.table}_au AFTER UPDATE OF ${source.columns} ON ${source.table} WHEN ${source.changed} BEGIN ${remove} ${insert} END;
      CREATE TRIGGER IF NOT EXISTS search_${source.table}_ad AFTER DELETE ON ${source.table} BEGIN ${remove} DELETE FROM search_entries WHERE kind='${source.kind}' AND ref_id=old.id; END;`);
    }
    if(migrate){
      sqlite.exec("DELETE FROM search_fts; DELETE FROM search_entries");
      for(const source of sources){
        const query=source.select.replace(`'${source.kind}',`, `'${source.kind}' AS kind,`).replace(/,([ci]\.)?id,/,",$1id AS ref_id,");
        sqlite.exec(`INSERT INTO search_entries(kind,ref_id,workspace_id) SELECT kind,ref_id,workspace_id FROM (${query})`);
      }
      // FTS is derived; rebuilding inside this transaction is restart-safe.
      for(const source of sources){
        sqlite.exec(`INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
          SELECT e.id,s.* FROM (${source.select.replace(`'${source.kind}',`, `'${source.kind}' AS kind,`).replace(/,([ci]\.)?id,/,",$1id AS ref_id,")}) s
          JOIN search_entries e ON e.kind=s.kind AND e.ref_id=s.ref_id`);
      }
    }
  })();
}

function bootstrap(sqlite: Database.Database) {
  const hadIssueAssignees = tableExists(sqlite, "issue_assignees");
  sqlite.exec(DDL);
  addColumnIfMissing(sqlite,"favorites","position","INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite,"page_favorites","position","INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "users", "avatar", "TEXT");
  addColumnIfMissing(sqlite, "users", "role", "TEXT NOT NULL DEFAULT 'member'");
  addColumnIfMissing(sqlite, "users", "last_workspace_id", "TEXT");
  addColumnIfMissing(sqlite, "users", "locale", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "icon", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "created_by", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "deleted_by", "TEXT");
  addColumnIfMissing(
    sqlite,
    "workspaces",
    "members_see_all_tasks",
    "INTEGER NOT NULL DEFAULT 1"
  );
  addColumnIfMissing(sqlite, "projects", "created_by", "TEXT");
  addColumnIfMissing(sqlite, "projects", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "projects", "description", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "projects", "doc", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "projects", "icon", "TEXT");
  addColumnIfMissing(sqlite, "issues", "parent_id", "TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS issues_parent_idx ON issues (parent_id)");
  addColumnIfMissing(sqlite, "issues", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "task_fields", "disabled_at", "TEXT");
  for(const column of ["parent_id","edited_at","deleted_at"]) addColumnIfMissing(sqlite,"page_comments",column,"TEXT");
  addColumnIfMissing(sqlite, "issues", "position", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "issues", "due_date", "TEXT");
  addColumnIfMissing(sqlite, "issues", "reminder", "TEXT");
  addColumnIfMissing(sqlite, "issues", "recurrence", "TEXT");
  addColumnIfMissing(sqlite, "issues", "recurred_into", "TEXT");
  // H-COLLAB-01: claim, source chat, publisher and review gate.
  addColumnIfMissing(sqlite, "issues", "claimed_by", "TEXT");
  addColumnIfMissing(sqlite, "issues", "claimed_at", "TEXT");
  addColumnIfMissing(sqlite, "issues", "source_thread_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_threads", "focus_issue_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_messages", "author_id", "TEXT");
  addColumnIfMissing(sqlite, "issues", "published_by", "TEXT");
  addColumnIfMissing(sqlite, "issues", "review_status", "TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing(sqlite, "issues", "reviewed_by", "TEXT");
  addColumnIfMissing(sqlite, "issues", "reviewed_at", "TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS issues_claimed_idx ON issues (claimed_by)");
  // Inline comments quote the passage they belong to instead of storing offsets, which
  // would drift as soon as the overview is edited.
  addColumnIfMissing(sqlite, "ai_settings", "engine", "TEXT NOT NULL DEFAULT 'api'");
  addColumnIfMissing(sqlite, "ai_settings", "proxy", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "ai_settings", "harness_enabled", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(sqlite, "overview_comments", "quote", "TEXT");
  addColumnIfMissing(sqlite, "overview_comments", "occurrence", "INTEGER NOT NULL DEFAULT 1");
  // A conversation remembers which Codex model, reasoning effort and approval mode it runs on.
  addColumnIfMissing(sqlite, "agent_threads", "model", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "agent_threads", "effort", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "agent_threads", "approval", "TEXT NOT NULL DEFAULT 'ask'");
  addColumnIfMissing(sqlite, "agent_threads", "turn_user_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_threads", "turn_started_at", "TEXT");
  // H-P1-08: Chat/Work mode is gone from the product. Drop the legacy column when SQLite allows it.
  dropColumnIfPresent(sqlite, "agent_threads", "mode");
  if (addColumnIfMissing(sqlite, "pages", "project_id", "TEXT")) {
    sqlite.exec("CREATE INDEX IF NOT EXISTS pages_project_idx ON pages (project_id)");
  }
  addColumnIfMissing(sqlite, "pages", "revision", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "notifications", "page_id", "TEXT");
  addColumnIfMissing(sqlite, "pages", "cover", "TEXT");
  addColumnIfMissing(sqlite, "pages", "position", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "pages", "share_level", "TEXT NOT NULL DEFAULT 'edit'");
  addColumnIfMissing(sqlite, "pages", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "pages", "trash_root", "TEXT");
  addColumnIfMissing(sqlite, "issues", "reminder_sent_for", "TEXT");
  const reminderScheduleFresh=!sqlite.prepare("PRAGMA table_info(issues)").all().some((row)=> (row as {name:string}).name==="reminder_next_fire");
  addColumnIfMissing(sqlite,"issues","reminder_next_fire","INTEGER");
  const reminderFire=`CASE WHEN due_date IS NOT NULL AND reminder IN ('12h','1d','3d','5d','7d') AND status NOT IN ('done','canceled') AND deleted_at IS NULL AND reminder_sent_for IS NOT due_date || '|' || reminder THEN unixepoch(due_date || ' 23:59:59','utc') - CASE reminder WHEN '12h' THEN 12 WHEN '1d' THEN 24 WHEN '3d' THEN 72 WHEN '5d' THEN 120 WHEN '7d' THEN 168 END * 3600 ELSE NULL END`;
  sqlite.exec(`CREATE INDEX IF NOT EXISTS issues_reminder_due ON issues(reminder_next_fire) WHERE reminder_next_fire IS NOT NULL;
  CREATE TRIGGER IF NOT EXISTS reminder_schedule_ai AFTER INSERT ON issues BEGIN UPDATE issues SET reminder_next_fire=${reminderFire} WHERE id=new.id; END;
  CREATE TRIGGER IF NOT EXISTS reminder_schedule_au AFTER UPDATE OF due_date,reminder,status,deleted_at,reminder_sent_for ON issues BEGIN UPDATE issues SET reminder_next_fire=${reminderFire} WHERE id=new.id; END;
  CREATE INDEX IF NOT EXISTS attachments_stale_idx ON attachments(workspace_id,created_at) WHERE complete=0 OR page_id='agent:draft';`);
  if(reminderScheduleFresh)sqlite.exec(`UPDATE issues SET reminder_next_fire=${reminderFire}`);


  const addedIssueCreator = addColumnIfMissing(sqlite, "issues", "created_by", "TEXT");
  if (!hadIssueAssignees && hasColumn(sqlite, "issues", "assignee_id")) {
    // Old boards held exactly one assignee per issue; carry it into the join table.
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO issue_assignees (issue_id, user_id, created_at)
         SELECT id, assignee_id, created_at FROM issues WHERE assignee_id IS NOT NULL`
      )
      .run();
  }
  if (addedIssueCreator) {
    // The creation event is the only record of who opened issues before this column.
    sqlite
      .prepare(
        `UPDATE issues SET created_by = (
           SELECT actor_id FROM events
           WHERE events.issue_id = issues.id AND events.type = 'created' AND events.actor_id IS NOT NULL
           ORDER BY events.created_at LIMIT 1
         ) WHERE created_by IS NULL`
      )
      .run();
  }
  // Projects created before ownership existed are credited to the workspace admin,
  // so nobody loses a project from the sidebar's Your team section.
  sqlite
    .prepare(
      `UPDATE projects SET created_by = (
         SELECT user_id FROM workspace_members
         WHERE workspace_id = projects.workspace_id AND role = 'admin'
         ORDER BY created_at LIMIT 1
       ) WHERE created_by IS NULL`
    )
    .run();
  if (
    addColumnIfMissing(
      sqlite,
      "projects",
      "color",
      `TEXT NOT NULL DEFAULT '${DEFAULT_PROJECT_COLOR}'`
    )
  ) {
    // Projects that predate colours all carry the palette's first entry; spread them
    // across it once so sibling projects read apart in the sidebar.
    const rows = sqlite
      .prepare("SELECT id, workspace_id FROM projects ORDER BY workspace_id, created_at, id")
      .all() as Array<{ id: string; workspace_id: string }>;
    const perWorkspace = new Map<string, number>();
    const setColor = sqlite.prepare("UPDATE projects SET color = ? WHERE id = ?");
    for (const row of rows) {
      const n = perWorkspace.get(row.workspace_id) ?? 0;
      perWorkspace.set(row.workspace_id, n + 1);
      setColor.run(PROJECT_COLORS[n % PROJECT_COLORS.length], row.id);
    }
  }
  // seed() bails out when any user exists, so demo teammates have to be inserted
  // before the superuser, otherwise a fresh install gets an empty demo workspace.
  seed(sqlite);
  ensureSuperAdmin(sqlite);
  ensureInitialAvatars(sqlite);
  ensureSearchIndex(sqlite);
  ensureRevisions(sqlite);
  sqlite.exec("CREATE INDEX IF NOT EXISTS pages_sibling_title_idx ON pages(workspace_id,parent_id,lower(title))");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS issues_identifier_idx ON issues(workspace_id,identifier COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS issues_project_number_idx ON issues(project_id,number);
    CREATE INDEX IF NOT EXISTS issues_workspace_position_idx ON issues(workspace_id,position);`);
  // Rows that predate manual ordering (and freshly seeded demo issues) get a slot in
  // insertion order. New issues are created with MAX(position) + 1, so they never hit 0.
  sqlite.exec("UPDATE issues SET position = rowid * 1000 WHERE position = 0");
  // Nothing older than this column recorded who made a workspace, so the first admin owns
  // it — including the demo workspace, whose rows are inserted above.
  sqlite
    .prepare(
      `UPDATE workspaces SET created_by = (
         SELECT user_id FROM workspace_members
         WHERE workspace_id = workspaces.id AND role = 'admin'
         ORDER BY created_at LIMIT 1
       ) WHERE created_by IS NULL`
    )
    .run();
}

export type TacosDb = ReturnType<typeof createDb>;

function createDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(path.join(DATA_DIR, "tacos.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  bootstrap(sqlite);
  return drizzle(sqlite, { schema });
}

const globalDb = globalThis as unknown as { __tacosDb?: TacosDb };

export function getDb(): TacosDb {
  if (!globalDb.__tacosDb) globalDb.__tacosDb = createDb();
  return globalDb.__tacosDb;
}
