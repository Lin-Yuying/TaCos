import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from "../lib/constants";
import * as schema from "./schema";

// A packaged desktop install cannot write next to its read-only app bundle, so the
// data directory comes from the environment and only falls back to the repo checkout.
const DATA_DIR = process.env.TACOS_DATA_DIR
  ? path.resolve(process.env.TACOS_DATA_DIR)
  : path.join(process.cwd(), "data");

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_via TEXT NOT NULL DEFAULT 'web',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_workspace_idx ON issues (workspace_id);
CREATE INDEX IF NOT EXISTS issues_project_idx ON issues (project_id);
CREATE INDEX IF NOT EXISTS issues_status_idx ON issues (status);

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
    .run(wsId, "Tacos", "HQ", now);

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
      "Tacos Admin",
      hashPassword(process.env.TACOS_ADMIN_PASSWORD || "admin123"),
      new Date().toISOString()
    );
}

function bootstrap(sqlite: Database.Database) {
  const hadIssueAssignees = tableExists(sqlite, "issue_assignees");
  sqlite.exec(DDL);
  addColumnIfMissing(sqlite, "users", "avatar", "TEXT");
  addColumnIfMissing(sqlite, "users", "role", "TEXT NOT NULL DEFAULT 'member'");
  addColumnIfMissing(sqlite, "users", "last_workspace_id", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "icon", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "created_by", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "workspaces", "deleted_by", "TEXT");
  addColumnIfMissing(sqlite, "projects", "created_by", "TEXT");
  addColumnIfMissing(sqlite, "projects", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "projects", "description", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "projects", "doc", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "issues", "deleted_at", "TEXT");
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
