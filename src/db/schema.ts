import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  // data: URL of a small square image the user uploaded
  avatar: text("avatar"),
  // site-wide role, independent of per-workspace roles: admin (superuser) | member
  role: text("role").notNull().default("member"),
  // last workspace this account opened; where a fresh session lands when it is still theirs
  lastWorkspaceId: text("last_workspace_id"),
  // interface language; null follows the browser's Accept-Language
  locale: text("locale"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export const deviceAccounts = sqliteTable(
  "device_accounts",
  {
    // random id kept in an httpOnly cookie; proves this browser signed into the account before
    deviceId: text("device_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.userId] })]
);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // issue identifier prefix, e.g. ACME
  key: text("key").notNull().unique(),
  // data: URL of a square image shown next to the workspace name; null falls back to the otter
  icon: text("icon"),
  // who created the workspace — the owner, and the only one who can delete it
  createdBy: text("created_by"),
  // soft delete: the owner gets 30 days to restore it from the recycle bin
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  // 1 = every member sees every task; 0 = only projects the member joined
  membersSeeAllTasks: integer("members_see_all_tasks").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const joinCodes = sqliteTable("join_codes", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    // admin | member
    role: text("role").notNull().default("member"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    // issue identifier prefix for this project, e.g. ENG
    key: text("key").notNull(),
    // cube colour shown next to the project, drawn from PROJECT_COLORS
    color: text("color").notNull().default("#8b5cf6"),
    // optional emoji picked by the team, drawn instead of the cube
    icon: text("icon"),
    // one-line summary shown under the project title
    description: text("description").notNull().default(""),
    // the Overview page's markdown document
    doc: text("doc").notNull().default(""),
    // who created the project — the "lead" in the sidebar's Your team section
    createdBy: text("created_by"),
    // set when the project was moved to the trash; issues stay untouched until purged
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("projects_workspace_idx").on(t.workspaceId)]
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_idx").on(t.userId),
  ]
);

// Per-user, never shared: who starred what. Unstarring deletes the row, so the
// table only ever holds the ones that are on.
export const favorites = sqliteTable(
  "favorites",
  {
    userId: text("user_id").notNull(),
    projectId: text("project_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.projectId] }),
    index("favorites_user_idx").on(t.userId),
  ]
);

// Who may open a project's Overview, and how far: comment can read and discuss,
// edit can also rewrite the document. The project creator and workspace admins
// always have both and need no row here.
export const projectGrants = sqliteTable(
  "project_grants",
  {
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    // comment | edit
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_grants_user_idx").on(t.userId),
  ]
);

// Discussion under an Overview document. Issues have their own comments table;
// this one is scoped to the project so a doc thread never mixes with task chatter.
export const overviewComments = sqliteTable(
  "overview_comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    // Inline annotations pin a comment to a passage; the quote plus which occurrence
    // of it identifies the anchor without storing offsets that shift on every edit.
    quote: text("quote"),
    occurrence: integer("occurrence").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("overview_comments_project_idx").on(t.projectId)]
);

// Who rewrote an Overview document, and what it said before/after: the History list
// in the comments panel. Kept to the newest 100 rows per project; edits by the same
// author within a few minutes are folded into one row so a typing session is one entry.
export const overviewDocEdits = sqliteTable(
  "overview_doc_edits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    docBefore: text("doc_before").notNull(),
    docAfter: text("doc_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("overview_doc_edits_project_idx").on(t.projectId)]
);

// When each viewer last opened the History panel. Newer edits by other people show up
// as an unread badge on the History button; the row is created on the first open.
export const overviewDocEditViews = sqliteTable(
  "overview_doc_edit_views",
  {
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    seenAt: text("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })]
);

// Resources on a project overview: an attached document (page_id) or an external link.
// Document titles are read from the page at display time so a rename shows through.
export const projectResources = sqliteTable(
  "project_resources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    pageId: text("page_id"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("project_resources_project_idx").on(t.projectId)]
);

// Standalone markdown documents, stored in the TaCos data directory alongside every
// other table. Private to the author by default; sharing a page shares its subtree.
export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    parentId: text("parent_id"),
    // Pages created from a project's Documents tab belong to that project; workspace
    // docs created elsewhere stay unattached.
    projectId: text("project_id"),
    title: text("title").notNull(),
    // emoji shown next to the title, like Notion's page icon
    icon: text("icon"),
    doc: text("doc").notNull().default(""),
    createdBy: text("created_by").notNull(),
    shared: integer("shared").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("pages_workspace_idx").on(t.workspaceId),
    index("pages_parent_idx").on(t.parentId),
    index("pages_project_idx").on(t.projectId),
  ]
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // todo | in_progress | done | canceled
    status: text("status").notNull().default("todo"),
    // 0 none, 1 low, 2 medium, 3 high, 4 urgent
    priority: integer("priority").notNull().default(0),
    // who opened it; null when an agent created it. Only this account and the
    // assignees may change the status.
    createdBy: text("created_by"),
    // YYYY-MM-DD, picked in the task panel. Null when the task has no deadline.
    dueDate: text("due_date"),
    // how long before dueDate to remind: 12h | 1d | 3d | 5d | 7d
    reminder: text("reminder"),
    // web | api | mcp — who created it (app vs agent)
    createdVia: text("created_via").notNull().default("web"),
    // set when the issue was sent to Trash; restore clears it
    deletedAt: text("deleted_at"),
    // manual order; higher sits further up in a column. Fractional so a drop can be
    // placed between two neighbours without renumbering the rest of the board.
    position: real("position").notNull().default(0),
    // H-COLLAB-01: one person may claim a task to push it forward. The claim does not
    // replace the assignees. Null when nobody holds the claim.
    claimedBy: text("claimed_by"),
    claimedAt: text("claimed_at"),
    // agent thread that produced this task, if any
    sourceThreadId: text("source_thread_id"),
    // the person who published the task (for agent tasks: the user who ran the agent)
    publishedBy: text("published_by"),
    // approved | pending | rejected. Agent-published tasks start as pending and need a
    // human reviewer before anyone can claim them.
    reviewStatus: text("review_status").notNull().default("approved"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("issues_claimed_idx").on(t.claimedBy),
    index("issues_workspace_idx").on(t.workspaceId),
    index("issues_project_idx").on(t.projectId),
    index("issues_status_idx").on(t.status),
  ]
);

// An issue can be worked by more than one person; assigning "everyone" is just
// one row per workspace member.
export const issueAssignees = sqliteTable(
  "issue_assignees",
  {
    issueId: text("issue_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.userId] }),
    index("issue_assignees_user_idx").on(t.userId),
  ]
);

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#5e6ad2"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("labels_workspace_idx").on(t.workspaceId)]
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id").notNull(),
    labelId: text("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })]
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    authorId: text("author_id"),
    // for agent authors: "api:key-name" | "mcp"; null for humans
    agentAuthor: text("agent_author"),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("comments_issue_idx").on(t.issueId)]
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    // created | status_changed | priority_changed | title_changed |
    // description_changed | labels_changed | assignee_changed | reordered | commented
    type: text("type").notNull(),
    data: text("data").notNull().default("{}"),
    actorId: text("actor_id"),
    agentActor: text("agent_actor"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("events_issue_idx").on(t.issueId)]
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    issueId: text("issue_id").notNull(),
    // assigned | commented | mentioned
    type: text("type").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.workspaceId, t.userId),
    index("notifications_issue_idx").on(t.issueId),
  ]
);

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("api_keys_workspace_idx").on(t.workspaceId)]
);

// An Agent conversation is bound to one project, the way a Codex thread is bound to a
// folder. Writes go through MCP tools with per-turn approval.
export const agentThreads = sqliteTable(
  "agent_threads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull().default(""),
    // codex | pi | … — recorded so a reopened thread shows what answered it
    engine: text("engine").notNull().default("codex"),
    // Codex model slug and reasoning effort; empty means "whatever the CLI is set to"
    model: text("model").notNull().default(""),
    effort: text("effort").notNull().default(""),
    // ask: every write needs a card | auto: only unsafe ones ask | full: never ask
    approval: text("approval").notNull().default("ask"),
    // private: only the author; shared: every workspace member can read and follow along
    visibility: text("visibility").notNull().default("private"),
    // H-COLLAB-08: the task that "用 Agent 推进" opened this chat for, or null.
    focusIssueId: text("focus_issue_id"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("agent_threads_workspace_idx").on(t.workspaceId, t.updatedAt)]
);

// Pin and unread are per viewer, not per conversation: a shared thread pinned by one
// member stays where it is for everyone else.
export const agentThreadFlags = sqliteTable(
  "agent_thread_flags",
  {
    threadId: text("thread_id").notNull(),
    userId: text("user_id").notNull(),
    pinnedAt: text("pinned_at"),
    unread: integer("unread").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })]
);

export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    // user | assistant
    role: text("role").notNull(),
    // H-COLLAB-09: who wrote a user message. Null for assistant replies and old rows.
    authorId: text("author_id"),
    content: text("content").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("agent_messages_thread_idx").on(t.threadId)]
);

// The work trajectory: every shell command, file change and TaCos tool call the agent
// made, kept next to the reply it belongs to. `detail` is JSON (params, output, paths).
export const agentSteps = sqliteTable(
  "agent_steps",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    messageId: text("message_id").notNull(),
    // command | file | tool | info
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    detail: text("detail"),
    // running | done | error | denied
    status: text("status").notNull().default("running"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("agent_steps_thread_idx").on(t.threadId),
    index("agent_steps_message_idx").on(t.messageId),
  ]
);

// The workspace's AI provider. `apiKey` is encrypted with a key stored next to the
// SQLite file, so a copied database alone does not expose the provider credential.
export const aiSettings = sqliteTable("ai_settings", {
  workspaceId: text("workspace_id").primaryKey(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKey: text("api_key").notNull(),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  engine: text("engine").notNull().default("api"),
  proxy: text("proxy").notNull().default(""),
  // JSON map of HarnessId -> enabled. Empty object means every harness is enabled.
  harnessEnabled: text("harness_enabled").notNull().default("{}"),
});
