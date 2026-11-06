import type Database from "better-sqlite3";

/** Database triggers keep revisions atomic with writes from every process and entry point. */
export function ensureRevisions(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_revisions (
    workspace_id TEXT NOT NULL, domain TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, domain)
  ) WITHOUT ROWID`);
  const direct: Record<string, string> = {
    issues: "tasks", projects: "projects", labels: "tasks", task_fields: "tasks",
    pages: "documents", page_comments: "documents",
    agent_threads: "threads", workspace_members: "permissions", workspaces: "permissions",
    personal_entity_state: "personal", personal_task_views: "personal",
  };
  const via: Record<string, [string, string]> = {
    overview_comments: ["projects", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    overview_doc_edits: ["projects", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    project_resources: ["projects", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    blockers: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    page_collab: ["documents", "SELECT workspace_id FROM pages WHERE id = ROW.page_id"],
    events: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    comments: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    issue_assignees: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    issue_labels: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    task_field_values: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    issue_dependencies: ["tasks", "SELECT workspace_id FROM issues WHERE id = ROW.issue_id"],
    project_members: ["permissions", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    project_grants: ["permissions", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    page_access: ["permissions", "SELECT workspace_id FROM pages WHERE id = ROW.page_id"],
    page_favorites: ["personal", "SELECT workspace_id FROM pages WHERE id = ROW.page_id"],
    favorites: ["personal", "SELECT workspace_id FROM projects WHERE id = ROW.project_id"],
    agent_messages: ["threads", "SELECT workspace_id FROM agent_threads WHERE id = ROW.thread_id"],
    agent_steps: ["threads", "SELECT workspace_id FROM agent_threads WHERE id = ROW.thread_id"],
    agent_thread_flags: ["personal", "SELECT workspace_id FROM agent_threads WHERE id = ROW.thread_id"],
    users: ["permissions", "SELECT workspace_id FROM workspace_members WHERE user_id = ROW.id"],
  };
  for (const [table, domain] of Object.entries(direct)) {
    via[table] = [domain, `SELECT ROW.${table === "workspaces" ? "id" : "workspace_id"}`];
  }
  // A workspace-deletion notification is visible in the user's other inboxes too.
  via.notifications = ["notifications", "SELECT '@user:' || ROW.user_id"];
  for (const [table, [domain, scope]] of Object.entries(via)) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    for (const event of ["INSERT", "UPDATE", "DELETE"]) {
      const row = event === "DELETE" ? "old" : "new";
      const select = scope.replaceAll("ROW.", `${row}.`).replace(/^SELECT (.+?)( FROM |$)/, "SELECT $1 AS scope$2");
      db.exec(`CREATE TRIGGER IF NOT EXISTS revision_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} BEGIN
          INSERT INTO workspace_revisions(workspace_id,domain,revision)
          SELECT scope, '${domain}', 1 FROM (${select}) AS source WHERE scope IS NOT NULL
          ON CONFLICT(workspace_id,domain) DO UPDATE SET revision=revision+1;
        END`);
    }
  }
}
