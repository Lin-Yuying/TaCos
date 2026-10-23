import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    // web | api | mcp — who created it (app vs agent)
    createdVia: text("created_via").notNull().default("web"),
    // set when the issue was sent to Trash; restore clears it
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
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
    // description_changed | labels_changed | assignee_changed | commented
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
