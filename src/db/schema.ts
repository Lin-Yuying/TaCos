import { blob,index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

// A deleted account keeps its username so a later person cannot take it.
export const retiredUsernames = sqliteTable("retired_usernames", {
  username: text("username").primaryKey(),
  retiredAt: text("retired_at").notNull(),
});

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("login_attempts_username_idx").on(t.username, t.createdAt)]
);

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
    position: integer("position").notNull().default(0),
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
    // Goes up with every change to the body; a save names the one it started from.
    revision: integer("revision").notNull().default(0),
    // A finished attachment shown across the top of the page.
    cover: text("cover"),
    // Order among siblings; older rows stay 0 and fall back to createdAt.
    position: integer("position").notNull().default(0),
    // What every member may do once it is shared: view | comment | edit
    shareLevel: text("share_level").notNull().default("edit"),
    // In the Trash when set. trashRoot is the page whose deletion took this one with it,
    // so a restore brings back exactly that subtree.
    deletedAt: text("deleted_at"),
    trashRoot: text("trash_root"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("pages_workspace_idx").on(t.workspaceId),
    index("pages_parent_idx").on(t.parentId),
    index("pages_project_idx").on(t.projectId),
  ]
);

// What a document looked like after each change; the Updates panel reads these.
export const pageVersions = sqliteTable(
  "page_versions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    doc: text("doc").notNull(),
    docCompressed: text("doc_compressed"),
    actorId: text("actor_id").notNull(),
    // you | mcp
    via: text("via").notNull(),
    // edit | restore | earlier (the text before history started) | unsaved (refused text
    // kept when its writer left the page; never the page's current text)
    reason: text("reason").notNull(),
    restoredFrom: integer("restored_from"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("page_versions_page_seq_idx").on(t.pageId, t.seq)]
);

// A file sent to a page. The bytes live under <data>/uploads/<id>.
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    pageId: text("page_id").notNull(),
    uploaderId: text("uploader_id").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    complete: integer("complete").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("attachments_page_idx").on(t.pageId), index("attachments_workspace_idx").on(t.workspaceId)]
);

export const pageFavorites = sqliteTable(
  "page_favorites",
  {
    userId: text("user_id").notNull(),
    pageId: text("page_id").notNull(),
    createdAt: text("created_at").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] })]
);

// One member's level on a shared page, in place of the page's shareLevel.
export const pageAccess = sqliteTable(
  "page_access",
  {
    pageId: text("page_id").notNull(),
    userId: text("user_id").notNull(),
    level: text("level").notNull(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] })]
);

export const pageComments = sqliteTable(
  "page_comments",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    // The passage it is about, with its surroundings; empty for a comment on the document.
    quote: text("quote"),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    via: text("via").notNull().default("you"),
    resolvedAt: text("resolved_at"),
    parentId: text("parent_id"),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("page_comments_page_idx").on(t.pageId)]
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    // The task this one belongs to. Null for a top-level task.
    parentId: text("parent_id"),
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
    // daily | weekly | monthly. Null when the task does not repeat.
    recurrence: text("recurrence"),
    // The next task already opened from this one. Set once, when it is marked done.
    recurredInto: text("recurred_into"),
    // H-COLLAB-11: "<dueDate>|<preset>" of the reminder already sent. A new due date or
    // preset gives a new key, so the reminder fires again; the same key never fires twice.
    reminderSentFor: text("reminder_sent_for"),
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
    index("issues_parent_idx").on(t.parentId),
  ]
);

// An issue can be worked by more than one person; assigning "everyone" is just
// one row per workspace member.
// The task in `issueId` stays blocked until `blockedById` is done or canceled.
export const issueDependencies = sqliteTable(
  "issue_dependencies",
  {
    issueId: text("issue_id").notNull(),
    blockedById: text("blocked_by_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.blockedById] }),
    index("issue_dependencies_blocked_idx").on(t.blockedById),
  ]
);

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

// A column every task in the workspace can fill in. options is a JSON list, for select fields.
export const taskFields = sqliteTable(
  "task_fields",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    options: text("options").notNull().default("[]"),
    disabledAt: text("disabled_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("task_fields_workspace_idx").on(t.workspaceId)]
);

export const taskFieldValues = sqliteTable(
  "task_field_values",
  {
    issueId: text("issue_id").notNull(),
    fieldId: text("field_id").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.fieldId] }), index("task_field_values_field_idx").on(t.fieldId)]
);

export const issueLabels = sqliteTable(
  "issue_labels",
  {
    issueId: text("issue_id").notNull(),
    labelId: text("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })]
);

// A member's report that a task is stuck. The inbox notice is separate.
export const blockers = sqliteTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("blockers_issue_idx").on(t.issueId)]
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
    // description_changed | labels_changed | assignee_changed | reordered | commented |
    // blocker_reported
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
    // Set on a document's notice; issueId is empty then.
    pageId: text("page_id"),
    // assigned | commented | mentioned | doc_commented | doc_mentioned | blocker
    type: text("type").notNull(),
    // Legacy human-readable text kept as a fallback for rows created before the
    // structured payload existed. New rows render from `data`.
    body: text("body").notNull(),
    // JSON payload: actorName, title, task, date, workspaceName — rendered in the
    // reader's language instead of storing a prebuilt English sentence.
    data: text("data"),
    // unread | read | done. done stays searchable until the 90-day sweep.
    state: text("state").notNull().default("unread"),
    // Snoozed rows are hidden until this time; the unread badge ignores them.
    snoozedUntil: text("snoozed_until"),
    // Soft delete: clearing the inbox keeps an undo window instead of dropping rows.
    deletedAt: text("deleted_at"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("notifications_user_idx").on(t.workspaceId, t.userId),
    index("notifications_issue_idx").on(t.issueId),
    index("notifications_user_created_idx").on(t.workspaceId, t.userId, t.createdAt),
  ]
);

// Per-user notification preferences, scoped to one workspace. JSON shape:
// { types?: Record<string, boolean> } — a missing type means enabled.
export const notificationPrefs = sqliteTable(
  "notification_prefs",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    prefs: text("prefs").notNull().default("{}"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]
);

// One person's mute on a task, document or project. notify() skips the matching
// scope; the Inbox shows the mute list so it can be removed.
export const notificationMutes = sqliteTable(
  "notification_mutes",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    label: text("label").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId, t.scopeType, t.scopeId] })]
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
    lastUsedIp: text("last_used_ip"),
    revokedAt: text("revoked_at"),
    // JSON arrays. null on both keeps a key created before scopes and project
    // allowlists existed at its original full-workspace access.
    scopes: text("scopes"),
    projectIds: text("project_ids"),
    expiresAt: text("expires_at"),
    // The key this one replaced, so a rotation keeps its history.
    rotatedFrom: text("rotated_from"),
    // Shown in Settings after the plaintext key is gone.
    keyPrefix: text("key_prefix"),
    last4: text("last4"),
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
    // team-2.3: one Agent turn at a time on a shared chat.
    turnUserId: text("turn_user_id"),
    turnStartedAt: text("turn_started_at"),
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
// One person's model API. The same user sees the same APIs in every workspace.
export const userModelKeys = sqliteTable(
  "user_model_keys",
  {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    apiKey: text("api_key").notNull(),
    editModel: text("edit_model").notNull().default(""),
    forEdits: integer("for_edits").notNull().default(0),
    label: text("label").notNull().default(""),
    baseUrl: text("base_url").notNull().default(""),
    models: text("models").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })]
);

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

// One per member's computer. Only the hash is stored; the runner holds the token.
export const runnerTokens = sqliteTable("runner_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
});

// What a member's computer last said it can run. Holds no key.
export const runnerStatus = sqliteTable("runner_status", {
  userId: text("user_id").primaryKey(),
  capabilities: text("capabilities").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

// A piece of Agent work waiting for, or running on, the member's computer. It only runs on
// the computer of the member who started it.
export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  threadId: text("thread_id"),
  issueId: text("issue_id"),
  payload: text("payload").notNull(),
  payloadCompressed: text("payload_compressed"),
  // queued | running | done | failed | cancelled
  status: text("status").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

// A document's shared editing state; pages.doc stays the text everything else reads.
export const pageCollab = sqliteTable("page_collab", {
  pageId: text("page_id").primaryKey(),
  state: blob("state", { mode: "buffer" }).notNull(),
  // The page revision this state matches. If the page moved on, the state takes in its text.
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const personalEntityState = sqliteTable("personal_entity_state", {
  userId: text("user_id").notNull(), workspaceId: text("workspace_id").notNull(),
  entityType: text("entity_type").notNull(), entityId: text("entity_id").notNull(),
  pinnedAt: text("pinned_at"), position: integer("position").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.workspaceId, t.entityType, t.entityId] })]);

export const personalTaskViews=sqliteTable("personal_task_views",{workspaceId:text("workspace_id").notNull(),userId:text("user_id").notNull(),scope:text("scope").notNull(),name:text("name").notNull(),value:text("value").notNull()},t=>[primaryKey({columns:[t.workspaceId,t.userId,t.scope,t.name]})]);
