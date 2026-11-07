import { ensureRevisions } from "./revisions";
import { parseLegacyNotificationBody } from "../lib/notification-data";
import { TacosError } from "../lib/tacos-error";
import { DATA_DIR } from "@/lib/data-dir";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS } from "../lib/constants";
import { DEFAULT_DISPLAY, FILTER_OPS, VIEW_LAYOUTS } from "../lib/task-view";
import { BUILTIN_AVATAR_PREFIX, builtinAvatarId, nextFreeAvatar } from "../lib/avatars";
import * as schema from "./schema";

export { DATA_DIR };

const DDL = `
CREATE TABLE IF NOT EXISTS attachment_references(attachment_id TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(attachment_id,source));
CREATE TABLE IF NOT EXISTS attachment_reference_checks(workspace_id TEXT PRIMARY KEY,checked_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachment_reclaim_candidates(attachment_id TEXT PRIMARY KEY,unreferenced_since TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runner_event_batches(run_id TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,PRIMARY KEY(run_id,sequence));
CREATE TABLE IF NOT EXISTS maintenance_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_until INTEGER NOT NULL,state TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,error TEXT,updated_at TEXT NOT NULL);
-- U-12: backup runs and the settings that control them. A restore replaces this table with
-- the backup's copy, so the files on disk are the source of truth for what can be restored.
CREATE TABLE IF NOT EXISTS backup_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  integrity TEXT NOT NULL DEFAULT '',
  db_bytes INTEGER NOT NULL DEFAULT 0,
  uploads_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS backup_runs_started_idx ON backup_runs (started_at);
CREATE TABLE IF NOT EXISTS ops_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS file_cleanup(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,error TEXT);
CREATE TABLE IF NOT EXISTS personal_task_views (
 workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,scope TEXT NOT NULL,name TEXT NOT NULL,value TEXT NOT NULL,
 PRIMARY KEY(workspace_id,user_id,scope,name)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_views (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_views_workspace_idx ON task_views (workspace_id);
CREATE INDEX IF NOT EXISTS task_views_owner_idx ON task_views (owner_id);
CREATE TABLE IF NOT EXISTS task_view_prefs (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  view_id TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0,
  display_override TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, view_id)
);
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  label_names TEXT NOT NULL DEFAULT '[]',
  field_values TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_templates_workspace_idx ON task_templates (workspace_id);
CREATE TABLE IF NOT EXISTS task_view_subscriptions (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  view_id TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["added","completed"]',
  muted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, view_id)
);

CREATE TABLE IF NOT EXISTS personal_entity_state (
  user_id TEXT NOT NULL, workspace_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  pinned_at TEXT, position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, workspace_id, entity_type, entity_id)
);

-- #80: internal automation rules, one idempotent row per (rule, event), and config history.
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  trigger TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  last_run_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_rules_workspace_idx ON automation_rules (workspace_id);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  action_results TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL,
  triggered_by TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS automation_runs_rule_event_idx ON automation_runs (rule_id, idempotency_key);
CREATE INDEX IF NOT EXISTS automation_runs_workspace_idx ON automation_runs (workspace_id, created_at);
CREATE TABLE IF NOT EXISTS automation_audit (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS automation_audit_workspace_idx ON automation_audit (workspace_id, created_at);

-- U-03 planning: workspace cycle configuration and the cycles it schedules.
CREATE TABLE IF NOT EXISTS cycle_settings (
  workspace_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  duration_weeks INTEGER NOT NULL DEFAULT 2,
  start_day INTEGER NOT NULL DEFAULT 1,
  cooldown_weeks INTEGER NOT NULL DEFAULT 0,
  upcoming_count INTEGER NOT NULL DEFAULT 2,
  auto_add INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming',
  rolled_over_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cycles_workspace_start_idx ON cycles (workspace_id, starts_at);
CREATE INDEX IF NOT EXISTS cycles_workspace_idx ON cycles (workspace_id, starts_at);

-- U-03 milestones: project-level stages with an optional target date and a plan order.
CREATE TABLE IF NOT EXISTS project_milestones (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_date TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_milestones_project_idx ON project_milestones (project_id, position);
CREATE INDEX IF NOT EXISTS project_milestones_workspace_idx ON project_milestones (workspace_id);

-- U-03 initiatives: workspace objectives grouping projects, with status/priority/owner.
CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  priority INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  target_date TEXT,
  resources TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS initiatives_workspace_idx ON initiatives (workspace_id, status);
CREATE TABLE IF NOT EXISTS initiative_projects (
  initiative_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (initiative_id, project_id)
);
CREATE INDEX IF NOT EXISTS initiative_projects_project_idx ON initiative_projects (project_id);
CREATE TABLE IF NOT EXISTS initiative_labels (
  initiative_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (initiative_id, label_id)
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
  template_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS page_versions_page_seq_idx ON page_versions (page_id, seq);

-- A reusable starting point for a new document; owned by the workspace, curated by its
-- owner or an admin. Existing pages keep a snapshot of the source, so deleting a template
-- changes nothing for them.
CREATE TABLE IF NOT EXISTS page_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  doc TEXT NOT NULL DEFAULT '',
  icon TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS page_templates_workspace_idx ON page_templates (workspace_id);

-- One row per page-to-page reference. v1 is page → page only; source_kind keeps the
-- column ready for task and comment sources without a second table. Target titles are
-- resolved from pages at render time; target_title is the last known name, used only
-- while the target is in the Trash or gone.
CREATE TABLE IF NOT EXISTS page_links (
  workspace_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'page',
  source_id TEXT NOT NULL,
  target_page_id TEXT NOT NULL,
  target_title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_kind, source_id, target_page_id)
);
CREATE INDEX IF NOT EXISTS page_links_target_idx ON page_links (workspace_id, target_page_id);
CREATE INDEX IF NOT EXISTS page_links_source_idx ON page_links (workspace_id, source_kind, source_id);

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
  parent_id TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  resolved_at TEXT,
  review_state TEXT,
  via TEXT NOT NULL DEFAULT 'you',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_issue_idx ON comments (issue_id);

-- U-11: one row per person, comment and reaction. Fixed set lives in constants.ts.
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id, emoji)
);

-- U-11: explicit follow for a task, project or document. Auto-follow writes the same
-- row (source names why), so Follow/Unfollow and the watcher list have one truth.
CREATE TABLE IF NOT EXISTS watchers (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  muted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  actor_id TEXT,
  agent_actor TEXT,
  workspace_id TEXT,
  object_type TEXT NOT NULL DEFAULT 'task',
  object_id TEXT,
  project_id TEXT,
  page_id TEXT,
  owner_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'project',
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
  last_used_ip TEXT,
  revoked_at TEXT,
  scopes TEXT,
  project_ids TEXT,
  expires_at TEXT,
  rotated_from TEXT,
  key_prefix TEXT,
  last4 TEXT
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

-- #79: named workspace agents and each member's personal agent.
CREATE TABLE IF NOT EXISTS workspace_agents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  approval TEXT NOT NULL DEFAULT 'ask',
  project_ids TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  personal INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_agents_workspace_idx ON workspace_agents (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_agents_personal_unique ON workspace_agents (workspace_id, created_by) WHERE personal = 1;

-- #79: observe-only token ledger. Nothing reads it to stop a run.
CREATE TABLE IF NOT EXISTS agent_usage (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  thread_id TEXT,
  message_id TEXT,
  issue_id TEXT,
  agent_id TEXT,
  user_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'runner',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_usage_workspace_idx ON agent_usage (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS agent_usage_agent_idx ON agent_usage (agent_id);
CREATE INDEX IF NOT EXISTS agent_usage_thread_idx ON agent_usage (thread_id);

-- #79: a harness's own session id for one thread, so the next turn can resume it.
CREATE TABLE IF NOT EXISTS agent_harness_sessions (
  thread_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, engine)
);
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

  // U-03: a small planning layer so a fresh database shows cycles, milestones and an
  // initiative instead of three empty states. The active cycle spans today under the
  // seeded 2-week Monday start; the completed one gives capacity a sample.
  const dayString = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dayOffset = (offset: number) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return dayString(date);
  };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const shift = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  const activeStart = shift(monday, -7);
  const previousStart = shift(activeStart, -14);
  const upcomingStart = shift(activeStart, 14);
  const upcomingNext = shift(activeStart, 28);
  sqlite
    .prepare(
      "INSERT INTO cycle_settings (workspace_id, enabled, duration_weeks, start_day, cooldown_weeks, upcoming_count, auto_add, updated_at) VALUES (?, 1, 2, 1, 0, 2, 0, ?)"
    )
    .run(wsId, now);
  const insertCycle = sqlite.prepare(
    "INSERT INTO cycles (id, workspace_id, number, name, starts_at, ends_at, status, rolled_over_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const previousCycleId = crypto.randomUUID();
  const activeCycleId = crypto.randomUUID();
  const upcomingCycleId = crypto.randomUUID();
  const upcomingNextCycleId = crypto.randomUUID();
  insertCycle.run(previousCycleId, wsId, 1, "Cycle 1", dayString(previousStart), dayString(shift(previousStart, 13)), "completed", now, alexId, minutesAgo(60 * 24 * 20));
  insertCycle.run(activeCycleId, wsId, 2, "Cycle 2", dayString(activeStart), dayString(shift(activeStart, 13)), "active", null, alexId, minutesAgo(60 * 24 * 13));
  insertCycle.run(upcomingCycleId, wsId, 3, "Cycle 3", dayString(upcomingStart), dayString(shift(upcomingStart, 13)), "upcoming", null, alexId, minutesAgo(60 * 24 * 6));
  insertCycle.run(upcomingNextCycleId, wsId, 4, "Cycle 4", dayString(upcomingNext), dayString(shift(upcomingNext, 13)), "upcoming", null, alexId, minutesAgo(60 * 24 * 6));

  const insertMilestone = sqlite.prepare(
    "INSERT INTO project_milestones (id, workspace_id, project_id, name, description, target_date, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const coreBetaId = crypto.randomUUID();
  const coreGaId = crypto.randomUUID();
  const agentBetaId = crypto.randomUUID();
  const agentGaId = crypto.randomUUID();
  insertMilestone.run(coreBetaId, wsId, coreId, "Beta", "First team-wide beta of the planning surface.", dayOffset(10), 1, alexId, minutesAgo(60 * 24 * 12));
  insertMilestone.run(coreGaId, wsId, coreId, "General availability", "Documented, stable and ready for the team server.", dayOffset(40), 2, alexId, minutesAgo(60 * 24 * 12));
  insertMilestone.run(agentBetaId, wsId, agentsId, "Agent beta", "MCP and REST tools usable from an agent session.", dayOffset(20), 1, alexId, minutesAgo(60 * 24 * 12));
  insertMilestone.run(agentGaId, wsId, agentsId, "Agent GA", "Delegation and review are on for every member.", null, 2, alexId, minutesAgo(60 * 24 * 12));

  const insertInitiative = sqlite.prepare(
    "INSERT INTO initiatives (id, workspace_id, name, description, status, priority, owner_id, target_date, resources, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const shipId = crypto.randomUUID();
  const agentPlatformId = crypto.randomUUID();
  insertInitiative.run(shipId, wsId, "Ship v2.4", "Planning, collaboration and search land together in the next team release.", "active", 3, alexId, dayOffset(60), JSON.stringify([{ title: "Release plan", url: "https://github.com/Lin-Yuying/tacos/releases" }]), alexId, minutesAgo(60 * 24 * 10), minutesAgo(60 * 24 * 10));
  insertInitiative.run(agentPlatformId, wsId, "Agent platform", "Named agents, delegation and review reach every project.", "proposed", 2, samId, dayOffset(120), "[]", alexId, minutesAgo(60 * 24 * 10), minutesAgo(60 * 24 * 10));
  const linkInitiativeProject = sqlite.prepare(
    "INSERT INTO initiative_projects (initiative_id, project_id) VALUES (?, ?)"
  );
  linkInitiativeProject.run(shipId, coreId);
  linkInitiativeProject.run(shipId, agentsId);
  linkInitiativeProject.run(agentPlatformId, agentsId);
  sqlite
    .prepare("INSERT INTO initiative_labels (initiative_id, label_id) VALUES (?, ?)")
    .run(shipId, labelIds.get("Feature")!);
  sqlite
    .prepare("INSERT INTO initiative_labels (initiative_id, label_id) VALUES (?, ?)")
    .run(agentPlatformId, labelIds.get("Agent")!);

  // Attach the seeded tasks to the plan, keeping the identifiers the checks already use.
  const planTask = sqlite.prepare(
    "UPDATE issues SET estimate = ?, cycle_id = ?, milestone_id = ? WHERE workspace_id = ? AND identifier = ?"
  );
  planTask.run(2, previousCycleId, coreBetaId, wsId, "CORE-4");
  planTask.run(3, previousCycleId, agentBetaId, wsId, "AGT-1");
  planTask.run(5, activeCycleId, coreBetaId, wsId, "CORE-1");
  planTask.run(3, activeCycleId, coreBetaId, wsId, "CORE-2");
  planTask.run(8, activeCycleId, coreGaId, wsId, "CORE-3");
  planTask.run(2, activeCycleId, agentGaId, wsId, "AGT-2");
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

// The index covers every entity the search page lists. Each source carries the SQL for
// its trigger, its backfill, and the row a rebuild copies into search_entries.
type SearchSource = {
  table: string;
  kind: string;
  ref: string;
  oldRef: string;
  workspace: string;
  oldWorkspace: string;
  title: string;
  body: string;
  columns: string;
  changed: string;
  condition: string;
  select: string;
};

const SEARCH_ENTITY_SOURCES: SearchSource[] = [
  {
    table: "pages",
    kind: "doc",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.title",
    body: "new.doc",
    columns: "title, doc, deleted_at, workspace_id",
    changed: "new.title IS NOT old.title OR new.doc IS NOT old.doc OR new.deleted_at IS NOT old.deleted_at OR new.workspace_id IS NOT old.workspace_id",
    condition: "new.deleted_at IS NULL",
    select: "SELECT 'doc' AS kind, id AS ref_id, workspace_id, title, doc AS body FROM pages WHERE deleted_at IS NULL",
  },
  {
    table: "issues",
    kind: "task",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.identifier || ' ' || new.title",
    body: "new.description",
    columns: "identifier, title, description, deleted_at, workspace_id",
    changed: "new.identifier IS NOT old.identifier OR new.title IS NOT old.title OR new.description IS NOT old.description OR new.deleted_at IS NOT old.deleted_at OR new.workspace_id IS NOT old.workspace_id",
    condition: "new.deleted_at IS NULL",
    select: "SELECT 'task' AS kind, id AS ref_id, workspace_id, identifier || ' ' || title AS title, description AS body FROM issues WHERE deleted_at IS NULL",
  },
  {
    table: "comments",
    kind: "task_comment",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "(SELECT workspace_id FROM issues WHERE id=new.issue_id)",
    oldWorkspace: "(SELECT workspace_id FROM issues WHERE id=old.issue_id)",
    title: "''",
    body: "new.body",
    columns: "body, issue_id",
    changed: "new.body IS NOT old.body OR new.issue_id IS NOT old.issue_id",
    condition: "1",
    select: "SELECT 'task_comment' AS kind, c.id AS ref_id, i.workspace_id, '' AS title, c.body AS body FROM comments c JOIN issues i ON i.id=c.issue_id",
  },
  {
    table: "page_comments",
    kind: "doc_comment",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "''",
    body: "new.body",
    columns: "body, deleted_at, workspace_id",
    changed: "new.body IS NOT old.body OR new.deleted_at IS NOT old.deleted_at OR new.workspace_id IS NOT old.workspace_id",
    condition: "new.deleted_at IS NULL",
    select: "SELECT 'doc_comment' AS kind, id AS ref_id, workspace_id, '' AS title, body FROM page_comments WHERE deleted_at IS NULL",
  },
  {
    table: "projects",
    kind: "project",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.name",
    body: "new.description",
    columns: "name, description, deleted_at, workspace_id",
    changed: "new.name IS NOT old.name OR new.description IS NOT old.description OR new.deleted_at IS NOT old.deleted_at OR new.workspace_id IS NOT old.workspace_id",
    condition: "new.deleted_at IS NULL",
    select: "SELECT 'project' AS kind, id AS ref_id, workspace_id, name AS title, description AS body FROM projects WHERE deleted_at IS NULL",
  },
  {
    table: "workspace_members",
    kind: "person",
    ref: "new.user_id",
    oldRef: "old.user_id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "(SELECT display_name || ' ' || username FROM users WHERE id=new.user_id)",
    body: "''",
    columns: "user_id, workspace_id",
    changed: "new.user_id IS NOT old.user_id OR new.workspace_id IS NOT old.workspace_id",
    condition: "1",
    select: "SELECT 'person' AS kind, wm.user_id AS ref_id, wm.workspace_id, u.display_name || ' ' || u.username AS title, '' AS body FROM workspace_members wm JOIN users u ON u.id=wm.user_id",
  },
  {
    table: "labels",
    kind: "label",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.name",
    body: "''",
    columns: "name, workspace_id",
    changed: "new.name IS NOT old.name OR new.workspace_id IS NOT old.workspace_id",
    condition: "1",
    select: "SELECT 'label' AS kind, id AS ref_id, workspace_id, name AS title, '' AS body FROM labels",
  },
  {
    table: "agent_threads",
    kind: "agent_thread",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.title",
    body: "(SELECT COALESCE(m.content,'') FROM agent_messages m WHERE m.thread_id=new.id AND m.role='assistant' ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1)",
    columns: "title, workspace_id",
    changed: "new.title IS NOT old.title OR new.workspace_id IS NOT old.workspace_id",
    condition: "1",
    select: "SELECT 'agent_thread' AS kind, t.id AS ref_id, t.workspace_id, t.title, COALESCE((SELECT m.content FROM agent_messages m WHERE m.thread_id=t.id AND m.role='assistant' ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1),'') AS body FROM agent_threads t",
  },
  {
    table: "attachments",
    kind: "attachment",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.name",
    body: "''",
    columns: "name, page_id, complete, workspace_id",
    changed: "new.name IS NOT old.name OR new.page_id IS NOT old.page_id OR new.complete IS NOT old.complete OR new.workspace_id IS NOT old.workspace_id",
    condition: "new.complete = 1 AND new.page_id <> 'agent-draft'",
    select: "SELECT 'attachment' AS kind, id AS ref_id, workspace_id, name AS title, '' AS body FROM attachments WHERE complete=1 AND page_id <> 'agent-draft'",
  },
  {
    table: "automation_rules",
    kind: "automation",
    ref: "new.id",
    oldRef: "old.id",
    workspace: "new.workspace_id",
    oldWorkspace: "old.workspace_id",
    title: "new.name",
    body: "new.trigger",
    columns: "name, trigger, workspace_id",
    changed: "new.name IS NOT old.name OR new.trigger IS NOT old.trigger OR new.workspace_id IS NOT old.workspace_id",
    condition: "1",
    select: "SELECT 'automation' AS kind, id AS ref_id, workspace_id, name AS title, trigger AS body FROM automation_rules",
  },
];

// Every trigger this module owns, including the two hand-written refresh paths below.
const SEARCH_TRIGGERS = [
  ...SEARCH_ENTITY_SOURCES.flatMap((source) =>
    ["ai", "au", "ad"].map((suffix) => `search_${source.table}_${suffix}`)
  ),
  "search_users_au",
  "search_users_ad",
  "search_agent_messages_ai",
  "search_agent_messages_au",
  "search_agent_messages_ad",
];

function searchEntryUniqueIsScoped(sqlite: Database.Database): boolean {
  const indexes = sqlite.prepare("PRAGMA index_list(search_entries)").all() as Array<{
    name: string;
    unique: number;
  }>;
  for (const index of indexes) {
    if (!index.unique) continue;
    const columns = (
      sqlite.prepare(`PRAGMA index_info("${index.name.replace(/"/g, '""')}")`).all() as Array<{
        name: string;
      }>
    )
      .map((column) => column.name)
      .sort();
    if (
      columns.length === 3 &&
      columns[0] === "kind" &&
      columns[1] === "ref_id" &&
      columns[2] === "workspace_id"
    ) {
      return true;
    }
  }
  return false;
}

// Triggers keep search_fts in step with every write path. The trigram tokenizer needs no word
// breaks, so Chinese matches without a dictionary. Titles of tasks carry the identifier.
// One entry is unique per workspace, so the same person can be indexed in two teams.
function ensureSearchIndex(sqlite: Database.Database) {
  sqlite.transaction(() => {
    const fresh = !tableExists(sqlite, "search_entries") || !tableExists(sqlite, "search_fts");
    sqlite.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      kind UNINDEXED, ref_id UNINDEXED, workspace_id UNINDEXED, title, body, tokenize = 'trigram'
    );
    CREATE TABLE IF NOT EXISTS search_entries (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, UNIQUE(kind, workspace_id, ref_id)
    );
    CREATE INDEX IF NOT EXISTS search_entries_scope ON search_entries(workspace_id,kind,id);`);

    // Triggers are dropped before the entry table is renamed: SQLite re-parses a
    // trigger when a table it references is renamed, and an old trigger that still
    // names search_entries would fail while that name is temporarily absent.
    for (const name of SEARCH_TRIGGERS) sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);

    // A database from before people were indexed keyed entries by (kind, ref_id) and
    // would collide when one person belongs to two workspaces. Rebuild that table once.
    const scoped = searchEntryUniqueIsScoped(sqlite);
    if (!scoped) {
      sqlite.exec(`CREATE TABLE search_entries_scoped (
          id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL, UNIQUE(kind, workspace_id, ref_id)
        );
        INSERT OR IGNORE INTO search_entries_scoped(id,kind,ref_id,workspace_id)
          SELECT id,kind,ref_id,workspace_id FROM search_entries;
        DROP TABLE search_entries;
        ALTER TABLE search_entries_scoped RENAME TO search_entries;
        CREATE INDEX IF NOT EXISTS search_entries_scope ON search_entries(workspace_id,kind,id);`);
    }

    const marker = "search_index_entities_v1";
    const versioned = Boolean(
      sqlite.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(marker)
    );
    const rebuild = fresh || !versioned || !scoped;

    if (rebuild) {
      sqlite.exec("DELETE FROM search_fts; DELETE FROM search_entries");
      for (const source of SEARCH_ENTITY_SOURCES) {
        sqlite.exec(
          `INSERT OR IGNORE INTO search_entries(kind,ref_id,workspace_id)
           SELECT kind,ref_id,workspace_id FROM (${source.select})`
        );
      }
      // FTS is derived; rebuilding inside this transaction is restart-safe.
      for (const source of SEARCH_ENTITY_SOURCES) {
        sqlite.exec(`INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
          SELECT e.id,s.kind,s.ref_id,s.workspace_id,s.title,s.body
          FROM (${source.select}) s
          JOIN search_entries e ON e.kind=s.kind AND e.ref_id=s.ref_id AND e.workspace_id=s.workspace_id`);
      }
    }

    for (const source of SEARCH_ENTITY_SOURCES) {
      const lookup = `kind='${source.kind}' AND ref_id=${source.ref} AND workspace_id=${source.workspace}`;
      const insert = `INSERT OR IGNORE INTO search_entries(kind,ref_id,workspace_id)
        SELECT '${source.kind}',${source.ref},${source.workspace} WHERE ${source.condition};
        DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_entries WHERE ${lookup});
        INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
        SELECT e.id,e.kind,e.ref_id,e.workspace_id,${source.title},${source.body}
        FROM search_entries e WHERE e.kind='${source.kind}' AND e.ref_id=${source.ref}
          AND e.workspace_id=${source.workspace} AND ${source.condition};`;
      const clear = `DELETE FROM search_fts WHERE rowid IN (
          SELECT id FROM search_entries WHERE kind='${source.kind}' AND ref_id=${source.oldRef} AND workspace_id=${source.oldWorkspace});
        DELETE FROM search_entries WHERE kind='${source.kind}' AND ref_id=${source.oldRef} AND workspace_id=${source.oldWorkspace};`;
      sqlite.exec(`CREATE TRIGGER search_${source.table}_ai AFTER INSERT ON ${source.table} BEGIN ${insert} END;
        CREATE TRIGGER search_${source.table}_au AFTER UPDATE OF ${source.columns} ON ${source.table} WHEN ${source.changed} BEGIN
          DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_entries WHERE kind='${source.kind}' AND ref_id=${source.oldRef} AND workspace_id=${source.oldWorkspace}); ${insert}
        END;
        CREATE TRIGGER search_${source.table}_ad AFTER DELETE ON ${source.table} BEGIN ${clear} END;`);
    }

    // A person's name lives in users, not in the membership row: refresh every team's entry.
    sqlite.exec(`
      CREATE TRIGGER search_users_au AFTER UPDATE OF display_name, username ON users BEGIN
        DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_entries WHERE kind='person' AND ref_id=new.id);
        INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
          SELECT e.id,e.kind,e.ref_id,e.workspace_id,new.display_name || ' ' || new.username,''
          FROM search_entries e WHERE e.kind='person' AND e.ref_id=new.id;
      END;
      CREATE TRIGGER search_users_ad AFTER DELETE ON users BEGIN
        DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_entries WHERE kind='person' AND ref_id=old.id);
        DELETE FROM search_entries WHERE kind='person' AND ref_id=old.id;
      END;`);

    // An Agent thread is one result: its title plus the latest assistant reply. Editing
    // any message refeshes that thread instead of indexing each turn separately.
    const reply = `COALESCE((SELECT m2.content FROM agent_messages m2 WHERE m2.thread_id=t.id AND m2.role='assistant'
      ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1),'')`;
    const refreshThread = (threadId: string) => `
      DELETE FROM search_fts WHERE rowid IN (SELECT id FROM search_entries WHERE kind='agent_thread' AND ref_id=${threadId});
      INSERT INTO search_fts(rowid,kind,ref_id,workspace_id,title,body)
        SELECT e.id,e.kind,e.ref_id,e.workspace_id,t.title,${reply}
        FROM search_entries e JOIN agent_threads t ON t.id=e.ref_id
        WHERE e.kind='agent_thread' AND e.ref_id=${threadId};`;
    sqlite.exec(`
      CREATE TRIGGER search_agent_messages_ai AFTER INSERT ON agent_messages BEGIN ${refreshThread("new.thread_id")} END;
      CREATE TRIGGER search_agent_messages_au AFTER UPDATE OF content, thread_id, role ON agent_messages BEGIN ${refreshThread("new.thread_id")} END;
      CREATE TRIGGER search_agent_messages_ad AFTER DELETE ON agent_messages BEGIN ${refreshThread("old.thread_id")} END;`);

    if (!versioned) {
      sqlite
        .prepare("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(marker, new Date().toISOString());
    }
  })();
}

// Personal saved views used to live in personal_task_views. They move into the
// task_views model once, keep their exact context (the URL they were saved under) and
// stay private, so nothing a member sees changes on the day of the upgrade.
function migratePersonalTaskViews(sqlite: Database.Database) {
  const marker = "task_views_personal_v1";
  const applied = sqlite
    .prepare("SELECT 1 FROM schema_migrations WHERE name = ?")
    .get(marker);
  if (applied) return;
  sqlite.transaction(() => {
    const rows = sqlite
      .prepare(
        "SELECT workspace_id, user_id, scope, name, value FROM personal_task_views ORDER BY rowid"
      )
      .all() as Array<{
      workspace_id: string;
      user_id: string;
      scope: string;
      name: string;
      value: string;
    }>;
    const insert = sqlite.prepare(`INSERT OR IGNORE INTO task_views
      (id, workspace_id, project_id, scope, name, definition, shared, owner_id, position, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)`);
    const now = new Date().toISOString();
    rows.forEach((row, position) => {
      let stored: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          stored = parsed as Record<string, unknown>;
        }
      } catch {
        // An unreadable legacy value becomes an empty personal view, not a failed boot.
      }
      const filters = Array.isArray(stored.filters)
        ? stored.filters.filter(
            (filter): filter is { key: string; op: string; value?: string } =>
              !!filter &&
              typeof filter === "object" &&
              typeof (filter as { key?: unknown }).key === "string" &&
              typeof (filter as { op?: unknown }).op === "string" &&
              (FILTER_OPS as readonly string[]).includes((filter as { op: string }).op) &&
              ((filter as { value?: unknown }).value === undefined ||
                typeof (filter as { value?: unknown }).value === "string")
          )
        : [];
      const sort = Array.isArray(stored.sort)
        ? stored.sort.filter(
            (item): item is { key: string; dir: "asc" | "desc" } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as { key?: unknown }).key === "string" &&
              ((item as { dir?: unknown }).dir === "asc" || (item as { dir?: unknown }).dir === "desc")
          )
        : [];
      const layout = (VIEW_LAYOUTS as readonly string[]).includes(String(stored.layout))
        ? (stored.layout as (typeof VIEW_LAYOUTS)[number])
        : "list";
      const projectMatch = row.scope.match(/\/projects\/([^/?#]+)/);
      const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null;
      const definition = JSON.stringify({
        filters,
        sort,
        layout,
        display: DEFAULT_DISPLAY,
        context: row.scope,
      });
      const id =
        "view-" +
        crypto
          .createHash("sha1")
          .update(`${row.workspace_id}|${row.user_id}|${row.scope}|${row.name}`)
          .digest("hex")
          .slice(0, 24);
      insert.run(
        id,
        row.workspace_id,
        projectId,
        projectId ? "project" : "workspace",
        row.name,
        definition,
        row.user_id,
        position,
        now,
        now
      );
    });
    sqlite
      .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
      .run(marker, now);
  })();
}

function bootstrap(sqlite: Database.Database) {
  const hadIssueAssignees = tableExists(sqlite, "issue_assignees");
  sqlite.exec(DDL);
  addColumnIfMissing(sqlite,"page_versions","doc_compressed","TEXT");
  addColumnIfMissing(sqlite,"agent_runs","payload_compressed","TEXT");
  addColumnIfMissing(sqlite,"runner_event_batches","body_compressed","TEXT");
  addColumnIfMissing(sqlite,"favorites","position","INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite,"page_favorites","position","INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "users", "avatar", "TEXT");
  addColumnIfMissing(sqlite, "users", "role", "TEXT NOT NULL DEFAULT 'member'");
  addColumnIfMissing(sqlite, "users", "last_workspace_id", "TEXT");
  addColumnIfMissing(sqlite, "users", "locale", "TEXT");
  // Scoped API keys. A database from before scopes keeps working: every new column is
  // nullable, and null scopes/project_ids/expires_at mean full workspace access forever.
  addColumnIfMissing(sqlite, "api_keys", "scopes", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "project_ids", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "expires_at", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "rotated_from", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "key_prefix", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "last4", "TEXT");
  addColumnIfMissing(sqlite, "api_keys", "last_used_ip", "TEXT");
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
  // A nullable parent link, one per tree. The column and its index stay out of DDL: an
  // index on a column an older database has not got fails the whole script, and the
  // ALTER that adds the column only runs after DDL. A server upgraded from 2.2 failed
  // to boot that way, so the column comes first and the index follows it.
  addColumnIfMissing(sqlite, "issues", "parent_id", "TEXT");
  addColumnIfMissing(sqlite, "pages", "parent_id", "TEXT");
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS issues_parent_idx ON issues (parent_id);
    CREATE INDEX IF NOT EXISTS pages_parent_idx ON pages (parent_id);
  `);
  addColumnIfMissing(sqlite, "issues", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "task_fields", "disabled_at", "TEXT");
  for(const column of ["parent_id","edited_at","deleted_at"]) addColumnIfMissing(sqlite,"page_comments",column,"TEXT");
  addColumnIfMissing(sqlite, "issues", "position", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "issues", "due_date", "TEXT");
  // U-09: numeric estimate read by U-03 planning; null means unsized.
  addColumnIfMissing(sqlite, "issues", "estimate", "REAL");
  // U-03: a task can be planned into one workspace cycle and one project milestone.
  // Both columns are nullable, and their indexes follow the ALTERs for the same reason
  // as parent_id above: an index on a missing column would abort an upgrade.
  addColumnIfMissing(sqlite, "issues", "cycle_id", "TEXT");
  addColumnIfMissing(sqlite, "issues", "milestone_id", "TEXT");
  sqlite.exec(`CREATE INDEX IF NOT EXISTS issues_cycle_idx ON issues (cycle_id);
    CREATE INDEX IF NOT EXISTS issues_milestone_idx ON issues (milestone_id);`);
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
  // #79: delegation keeps the human assignees and records the agent that is working.
  addColumnIfMissing(sqlite, "issues", "delegated_agent_id", "TEXT");
  addColumnIfMissing(sqlite, "issues", "delegated_by", "TEXT");
  addColumnIfMissing(sqlite, "issues", "delegated_at", "TEXT");
  addColumnIfMissing(sqlite, "issues", "delegation_status", "TEXT");
  addColumnIfMissing(sqlite, "issues", "delegation_run_id", "TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS issues_delegated_agent_idx ON issues (delegated_agent_id)");
  addColumnIfMissing(sqlite, "agent_threads", "agent_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_threads", "context_summary", "TEXT");
  addColumnIfMissing(sqlite, "agent_threads", "context_summary_through", "TEXT");
  addColumnIfMissing(sqlite, "agent_runs", "agent_id", "TEXT");
  addColumnIfMissing(sqlite, "agent_runs", "source", "TEXT NOT NULL DEFAULT 'runner'");
  addColumnIfMissing(sqlite, "agent_runs", "review_status", "TEXT");
  addColumnIfMissing(sqlite, "agent_runs", "model", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "agent_runs", "subscription", "TEXT");
  sqlite.exec("CREATE INDEX IF NOT EXISTS agent_runs_agent_idx ON agent_runs (agent_id)");
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
  addColumnIfMissing(sqlite, "notifications", "data", "TEXT");
  addColumnIfMissing(sqlite, "notifications", "state", "TEXT NOT NULL DEFAULT 'unread'");
  addColumnIfMissing(sqlite, "notifications", "snoozed_until", "TEXT");
  addColumnIfMissing(sqlite, "notifications", "deleted_at", "TEXT");
  // U-11: task comments gain threading, edit/delete, resolve and a review marker.
  // Old rows stay valid: every field is nullable except via, which defaults to the UI.
  for (const column of ["parent_id", "edited_at", "deleted_at", "resolved_at", "review_state"]) {
    addColumnIfMissing(sqlite, "comments", column, "TEXT");
  }
  addColumnIfMissing(sqlite, "comments", "via", "TEXT NOT NULL DEFAULT 'you'");
  // U-11: the activity feed reads one table. Task events already live in `events`;
  // page and project events join them with the object columns added here.
  addColumnIfMissing(sqlite, "events", "workspace_id", "TEXT");
  addColumnIfMissing(sqlite, "events", "object_type", "TEXT NOT NULL DEFAULT 'task'");
  addColumnIfMissing(sqlite, "events", "object_id", "TEXT");
  addColumnIfMissing(sqlite, "events", "project_id", "TEXT");
  addColumnIfMissing(sqlite, "events", "page_id", "TEXT");
  addColumnIfMissing(sqlite, "events", "owner_id", "TEXT");
  addColumnIfMissing(sqlite, "events", "visibility", "TEXT NOT NULL DEFAULT 'project'");
  // Indexes on the new columns come after the ALTERs: a 2.3 database already has the
  // tables, and CREATE INDEX on a missing column would abort the whole bootstrap.
  sqlite.exec(`CREATE INDEX IF NOT EXISTS comments_parent_idx ON comments (parent_id);
    CREATE INDEX IF NOT EXISTS comment_reactions_comment_idx ON comment_reactions (comment_id);
    CREATE INDEX IF NOT EXISTS watchers_scope_idx ON watchers (scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS watchers_user_idx ON watchers (workspace_id, user_id);
    CREATE INDEX IF NOT EXISTS events_workspace_idx ON events (workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS events_object_idx ON events (object_type, object_id);`);
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx
      ON notifications (workspace_id, user_id, created_at);
    CREATE TABLE IF NOT EXISTS notification_prefs (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      prefs TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS notification_mutes (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id, scope_type, scope_id)
    );
    UPDATE notifications
      SET state = CASE WHEN read_at IS NULL THEN 'unread' ELSE 'read' END
      WHERE state IS NULL OR state = '';
  `);
  for (const row of sqlite
    .prepare("SELECT id, type, body FROM notifications WHERE data IS NULL OR data = ''")
    .all() as { id: string; type: string; body: string }[]) {
    const parsed = parseLegacyNotificationBody(row.type, row.body);
    if (parsed) {
      sqlite
        .prepare("UPDATE notifications SET data = ? WHERE id = ?")
        .run(JSON.stringify(parsed), row.id);
    }
  }
  addColumnIfMissing(sqlite, "pages", "cover", "TEXT");
  addColumnIfMissing(sqlite, "pages", "position", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "pages", "share_level", "TEXT NOT NULL DEFAULT 'edit'");
  addColumnIfMissing(sqlite, "pages", "deleted_at", "TEXT");
  addColumnIfMissing(sqlite, "pages", "trash_root", "TEXT");
  addColumnIfMissing(sqlite, "pages", "template_id", "TEXT");
  addColumnIfMissing(sqlite, "pages", "template_name", "TEXT");
  addColumnIfMissing(sqlite, "page_versions", "template_name", "TEXT");
  addColumnIfMissing(sqlite, "issues", "reminder_sent_for", "TEXT");
  const reminderScheduleFresh=!sqlite.prepare("PRAGMA table_info(issues)").all().some((row)=> (row as {name:string}).name==="reminder_next_fire");
  addColumnIfMissing(sqlite,"issues","reminder_next_fire","INTEGER");
  const reminderFire=`CASE WHEN due_date IS NOT NULL AND reminder IN ('12h','1d','3d','5d','7d') AND status NOT IN ('done','canceled') AND deleted_at IS NULL AND reminder_sent_for IS NOT due_date || '|' || reminder THEN unixepoch(due_date || ' 23:59:59','utc') - CASE reminder WHEN '12h' THEN 12 WHEN '1d' THEN 24 WHEN '3d' THEN 72 WHEN '5d' THEN 120 WHEN '7d' THEN 168 END * 3600 ELSE NULL END`;
  sqlite.exec(`CREATE INDEX IF NOT EXISTS issues_reminder_due ON issues(reminder_next_fire) WHERE reminder_next_fire IS NOT NULL;
  CREATE TRIGGER IF NOT EXISTS reminder_schedule_ai AFTER INSERT ON issues BEGIN UPDATE issues SET reminder_next_fire=${reminderFire} WHERE id=new.id; END;
  CREATE TRIGGER IF NOT EXISTS reminder_schedule_au AFTER UPDATE OF due_date,reminder,status,deleted_at,reminder_sent_for ON issues BEGIN UPDATE issues SET reminder_next_fire=${reminderFire} WHERE id=new.id; END;
  CREATE INDEX IF NOT EXISTS attachments_stale_idx ON attachments(workspace_id,created_at) WHERE complete=0 OR page_id='agent-draft';`);
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
  // U-11: every task event becomes an activity row keyed by workspace and visibility.
  // Backfill once on upgrade; new rows are written with these columns by recordEvent.
  sqlite.exec(`UPDATE events SET workspace_id = (
      SELECT workspace_id FROM issues WHERE issues.id = events.issue_id
    ) WHERE workspace_id IS NULL AND issue_id <> '';
    UPDATE events SET object_type = 'task' WHERE object_type IS NULL OR object_type = '';
    UPDATE events SET object_id = issue_id WHERE object_id IS NULL AND issue_id <> '';
    UPDATE events SET visibility = 'project' WHERE visibility IS NULL OR visibility = '';
    UPDATE events SET project_id = (
      SELECT project_id FROM issues WHERE issues.id = events.issue_id
    ) WHERE project_id IS NULL AND issue_id <> '';
    UPDATE events SET owner_id = (
      SELECT created_by FROM issues WHERE issues.id = events.issue_id
    ) WHERE owner_id IS NULL AND issue_id <> '';`);
  // U-11 follow migration: the implicit creator/assignee audience becomes the initial
  // watcher set exactly once. The marker matters: re-running would undo an Unfollow.
  if (!sqlite.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("u11_watchers_v1")) {
    sqlite.transaction(() => {
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO watchers (workspace_id, user_id, scope_type, scope_id, source, muted, created_at)
           SELECT workspace_id, created_by, 'issue', id, 'creator', 0, ? FROM issues
           WHERE created_by IS NOT NULL AND deleted_at IS NULL`
        )
        .run(now);
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO watchers (workspace_id, user_id, scope_type, scope_id, source, muted, created_at)
           SELECT i.workspace_id, a.user_id, 'issue', i.id, 'assignee', 0, ?
           FROM issue_assignees a JOIN issues i ON i.id = a.issue_id
           WHERE i.deleted_at IS NULL`
        )
        .run(now);
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO watchers (workspace_id, user_id, scope_type, scope_id, source, muted, created_at)
           SELECT workspace_id, created_by, 'project', id, 'creator', 0, ? FROM projects
           WHERE created_by IS NOT NULL AND deleted_at IS NULL`
        )
        .run(now);
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO watchers (workspace_id, user_id, scope_type, scope_id, source, muted, created_at)
           SELECT workspace_id, created_by, 'page', id, 'creator', 0, ? FROM pages
           WHERE created_by IS NOT NULL AND deleted_at IS NULL`
        )
        .run(now);
      sqlite
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run("u11_watchers_v1", now);
    })();
  }
  ensureSuperAdmin(sqlite);
  ensureInitialAvatars(sqlite);
  ensureSearchIndex(sqlite);
  ensureRevisions(sqlite);
  migratePersonalTaskViews(sqlite);
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

const globalDb = globalThis as unknown as {
  __tacosDb?: TacosDb;
  __tacosDbMaintenance?: string | null;
};

/**
 * U-12: while a restore replaces the database file, every request fails fast instead of
 * reading a half-written file. The restorer closes the handle before setting this.
 */
export function setDbMaintenance(message: string | null): void {
  globalDb.__tacosDbMaintenance = message;
}

export function dbMaintenanceMessage(): string | null {
  return globalDb.__tacosDbMaintenance ?? null;
}

/**
 * Close the cached handle so the file can be replaced. The next getDb() opens it again.
 * Returns an error message when the handle could not be closed; the restorer then aborts
 * instead of replacing a database another connection still has open.
 */
export function closeDb(): string | null {
  try {
    globalDb.__tacosDb?.$client.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // A checkpoint failure must not block a restore; the WAL files are removed with the swap.
  }
  try {
    globalDb.__tacosDb?.$client.close();
  } catch (error) {
    return error instanceof Error ? error.message : "could not close the database";
  }
  delete globalDb.__tacosDb;
  return null;
}

export function getDb(): TacosDb {
  const maintenance = globalDb.__tacosDbMaintenance;
  if (maintenance) {
    throw new TacosError(maintenance, 503, "Try again when the restore finishes.");
  }
  if (!globalDb.__tacosDb) globalDb.__tacosDb = createDb();
  return globalDb.__tacosDb;
}
