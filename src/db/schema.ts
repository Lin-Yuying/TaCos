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
    // Where this page started: a template, kept by name so deleting the template does not
    // change the page's history or header.
    templateId: text("template_id"),
    templateName: text("template_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("pages_workspace_idx").on(t.workspaceId),
    index("pages_parent_idx").on(t.parentId),
    index("pages_project_idx").on(t.projectId),
  ]
);

// A reusable document body and title. Workspace-level; the owner or an admin curates it.
export const pageTemplates = sqliteTable(
  "page_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    doc: text("doc").notNull().default(""),
    icon: text("icon"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("page_templates_workspace_idx").on(t.workspaceId)]
);

// One row per page-to-page reference. v1 is page → page only (source_kind is 'page');
// target titles resolve from pages at render time, while target_title is the fallback
// used only while that page is in the Trash or gone.
export const pageLinks = sqliteTable(
  "page_links",
  {
    workspaceId: text("workspace_id").notNull(),
    sourceKind: text("source_kind").notNull().default("page"),
    sourceId: text("source_id").notNull(),
    targetPageId: text("target_page_id").notNull(),
    targetTitle: text("target_title").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceKind, t.sourceId, t.targetPageId] }),
    index("page_links_target_idx").on(t.workspaceId, t.targetPageId),
    index("page_links_source_idx").on(t.workspaceId, t.sourceKind, t.sourceId),
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
    // edit | template (the page's first text, filled from a template) | restore |
    // earlier (the text before history started) | unsaved (refused text kept when its
    // writer left the page; never the page's current text)
    reason: text("reason").notNull(),
    // The template this version started from, kept as a name; null for ordinary edits.
    templateName: text("template_name"),
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
    // planning estimate in points/hours; null when nobody sized the task yet (U-03 reads it)
    estimate: real("estimate"),
    // U-03: the workspace cycle this task is planned into; null when unscheduled.
    cycleId: text("cycle_id"),
    // U-03: the project milestone this task closes; null when the project has none.
    milestoneId: text("milestone_id"),
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
    // #79: an agent the task is delegated to. The human assignees keep ownership.
    delegatedAgentId: text("delegated_agent_id"),
    delegatedBy: text("delegated_by"),
    delegatedAt: text("delegated_at"),
    // queued | running | review | changes_requested | approved | failed | cancelled
    delegationStatus: text("delegation_status"),
    delegationRunId: text("delegation_run_id"),
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
    // U-11: one reply level. A reply points at its top-level comment.
    parentId: text("parent_id"),
    editedAt: text("edited_at"),
    deletedAt: text("deleted_at"),
    resolvedAt: text("resolved_at"),
    // approve | changes_requested. Set only on a review decision comment.
    reviewState: text("review_state"),
    via: text("via").notNull().default("you"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("comments_issue_idx").on(t.issueId), index("comments_parent_idx").on(t.parentId)]
);

// U-11: fixed-set reactions on a task comment, one row per person and emoji.
export const commentReactions = sqliteTable(
  "comment_reactions",
  {
    commentId: text("comment_id").notNull(),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId, t.emoji] }),
    index("comment_reactions_comment_idx").on(t.commentId),
  ]
);

// U-11: explicit follow rows shared by tasks, projects and documents.
export const watchers = sqliteTable(
  "watchers",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    // issue | project | page
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    // manual | creator | assignee | mention | comment | migrated
    source: text("source").notNull().default("manual"),
    muted: integer("muted").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.scopeType, t.scopeId] }),
    index("watchers_scope_idx").on(t.scopeType, t.scopeId),
    index("watchers_user_idx").on(t.workspaceId, t.userId),
  ]
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id").notNull(),
    // created | status_changed | priority_changed | title_changed |
    // description_changed | labels_changed | assignee_changed | reordered | commented |
    // blocker_reported | comment_edited | comment_deleted | comment_resolved …
    type: text("type").notNull(),
    data: text("data").notNull().default("{}"),
    actorId: text("actor_id"),
    agentActor: text("agent_actor"),
    // U-11 activity feed: every event names its workspace, object and visibility so one
    // read model covers tasks, documents and projects without joining first.
    workspaceId: text("workspace_id"),
    objectType: text("object_type").notNull().default("task"),
    objectId: text("object_id"),
    projectId: text("project_id"),
    pageId: text("page_id"),
    ownerId: text("owner_id"),
    // workspace | project | private
    visibility: text("visibility").notNull().default("project"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("events_issue_idx").on(t.issueId),
    index("events_workspace_idx").on(t.workspaceId, t.createdAt),
    index("events_object_idx").on(t.objectType, t.objectId),
  ]
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
    // #79: the workspace agent (or the author's personal agent) that opened this thread.
    agentId: text("agent_id"),
    // #79: compacted older history and the last message it covers.
    contextSummary: text("context_summary"),
    contextSummaryThrough: text("context_summary_through"),
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
  // #79: who the work belongs to, and where it actually runs. "runner" waits for the
  // member's computer; "api" runs the built-in loop here.
  agentId: text("agent_id"),
  source: text("source").notNull().default("runner"),
  // null | pending | approved | changes_requested. Set when a run finishes with output.
  reviewStatus: text("review_status"),
  model: text("model").notNull().default(""),
  // #79: plan usage snapshot captured when the run started; JSON SubscriptionInfo.
  subscription: text("subscription"),
  createdAt: text("created_at").notNull(),
  finishedAt: text("finished_at"),
});

// One workspace-level named agent, or one member's personal agent. A workspace agent is
// shared; `personal` rows belong to `createdBy` and are visible only to that member.
export const workspaceAgents = sqliteTable(
  "workspace_agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // harness: one local CLI; api: the built-in loop over the owner's model API.
    source: text("source").notNull(),
    engine: text("engine").notNull().default(""),
    model: text("model").notNull().default(""),
    approval: text("approval").notNull().default("ask"),
    // JSON array of project ids; empty means every project in the workspace.
    projectIds: text("project_ids").notNull().default("[]"),
    enabled: integer("enabled").notNull().default(1),
    personal: integer("personal").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("workspace_agents_workspace_idx").on(t.workspaceId)]
);

// The observe-only token ledger. One row per turn that reported usage. Nothing reads it
// to stop a run.
export const agentUsage = sqliteTable(
  "agent_usage",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id"),
    threadId: text("thread_id"),
    messageId: text("message_id"),
    issueId: text("issue_id"),
    agentId: text("agent_id"),
    userId: text("user_id").notNull(),
    engine: text("engine").notNull(),
    model: text("model").notNull().default(""),
    // runner | api — where the turn actually ran.
    source: text("source").notNull().default("runner"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("agent_usage_workspace_idx").on(t.workspaceId, t.createdAt),
    index("agent_usage_agent_idx").on(t.agentId),
    index("agent_usage_thread_idx").on(t.threadId),
  ]
);

// A harness's own session id for one thread. Each harness only resumes its own.
export const agentHarnessSessions = sqliteTable(
  "agent_harness_sessions",
  {
    threadId: text("thread_id").notNull(),
    engine: text("engine").notNull(),
    sessionId: text("session_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.engine] })]
);

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

// One-time schema work (data migrations) recorded by name, so it never runs twice.
export const schemaMigrations = sqliteTable("schema_migrations", {
  name: text("name").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

// Saved task list definitions. Personal views (shared=0) belong to one member;
// shared views (shared=1) are visible to everyone in the workspace, or to one
// project when scope='project'. `definition` is JSON TaskViewDefinition.
export const taskViews = sqliteTable(
  "task_views",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    // set only for a project-scoped view
    projectId: text("project_id"),
    // workspace | project
    scope: text("scope").notNull(),
    name: text("name").notNull(),
    definition: text("definition").notNull(),
    // 0 personal, 1 shared with the workspace/project
    shared: integer("shared").notNull().default(0),
    ownerId: text("owner_id").notNull(),
    position: integer("position").notNull().default(0),
    // at most one default per workspace scope and per project scope
    isDefault: integer("is_default").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("task_views_workspace_idx").on(t.workspaceId),
    index("task_views_owner_idx").on(t.ownerId),
  ]
);

// Per-member state on a view: favorite and a personal display override. A personal
// override never changes the shared definition.
export const taskViewPrefs = sqliteTable(
  "task_view_prefs",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    viewId: text("view_id").notNull(),
    favorite: integer("favorite").notNull().default(0),
    // JSON TaskViewDisplay; only this member sees it
    displayOverride: text("display_override"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId, t.viewId] })]
);

// Workspace-level task templates: a reusable draft body for the composer. Per-project
// templates are a follow-up.
export const taskTemplates = sqliteTable(
  "task_templates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: integer("priority").notNull().default(0),
    // JSON array of label names
    labelNames: text("label_names").notNull().default("[]"),
    // JSON object: custom field id -> stored value
    fieldValues: text("field_values").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("task_templates_workspace_idx").on(t.workspaceId)]
);

// A member watching a shared view. Delivery is the Inbox only; there is no
// Slack/email channel. Row absence means "not subscribed", so the feature is off
// until someone opts in.
export const taskViewSubscriptions = sqliteTable(
  "task_view_subscriptions",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    viewId: text("view_id").notNull(),
    // JSON array of "added" | "completed"; both are on unless the member changes it.
    events: text("events").notNull().default('["added","completed"]'),
    muted: integer("muted").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId, t.viewId] })]
);

// Kept for the legacy personal views that were migrated into task_views. Reads and
// writes go through task_views now; the rows stay so the migration can be audited.
export const personalTaskViews=sqliteTable("personal_task_views",{workspaceId:text("workspace_id").notNull(),userId:text("user_id").notNull(),scope:text("scope").notNull(),name:text("name").notNull(),value:text("value").notNull()},t=>[primaryKey({columns:[t.workspaceId,t.userId,t.scope,t.name]})]);

// #80: internal automations. A rule is trigger + conditions + actions; no external
// delivery surface exists. `trigger` is text because a due trigger carries its lead
// time (`task.due_soon:2`); everything else is one of the fixed trigger names.
export const automationRules = sqliteTable(
  "automation_rules",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled").notNull().default(1),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    trigger: text("trigger").notNull(),
    // JSON array of condition objects; empty means every event of the trigger matches.
    conditions: text("conditions").notNull().default("[]"),
    // JSON array of action objects, executed in order.
    actions: text("actions").notNull().default("[]"),
    lastRunAt: text("last_run_at"),
    // Bumped on every edit; the run log keeps the trigger it actually ran with.
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("automation_rules_workspace_idx").on(t.workspaceId)]
);

// One row per (rule, event). The unique key makes a repeated event, a scheduler
// restart or a retry harmless. `ruleName` is a snapshot so the log survives deletion.
export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleName: text("rule_name").notNull().default(""),
    trigger: text("trigger").notNull(),
    // JSON snapshot of the event: type, issue/page, actor, data.
    event: text("event").notNull(),
    // running | success | partial | failed
    status: text("status").notNull(),
    actionResults: text("action_results").notNull().default("[]"),
    error: text("error"),
    durationMs: integer("duration_ms").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    triggeredBy: text("triggered_by"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [
    uniqueIndex("automation_runs_rule_event_idx").on(t.ruleId, t.idempotencyKey),
    index("automation_runs_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

// Rule configuration history: who changed what, before and after.
export const automationAudit = sqliteTable(
  "automation_audit",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleName: text("rule_name").notNull().default(""),
    // created | updated | enabled | disabled | deleted
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    before: text("before"),
    after: text("after"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("automation_audit_workspace_idx").on(t.workspaceId, t.createdAt)]
);

// U-03 planning: one time-box configuration per workspace. Cycles are workspace-level
// because TaCos has no team layer (plan decision 1); a missing row means "not enabled
// yet", so no workspace starts creating cycles silently.
export const cycleSettings = sqliteTable("cycle_settings", {
  workspaceId: text("workspace_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  // 1-8 weeks
  durationWeeks: integer("duration_weeks").notNull().default(2),
  // ISO weekday of the start: 1 Monday ... 7 Sunday, 0 is normalized to 7 on write.
  startDay: integer("start_day").notNull().default(1),
  // 0-8 empty weeks between two cycles.
  cooldownWeeks: integer("cooldown_weeks").notNull().default(0),
  // How many future cycles to keep scheduled, 0-15.
  upcomingCount: integer("upcoming_count").notNull().default(2),
  // Opt-in: put active tasks without a cycle into the current one (plan decision 7).
  autoAdd: integer("auto_add").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

// U-03: a time-boxed cycle. `starts_at` is the workspace's calendar date, not an
// instant; the unique key makes a repeated lazy sweep a no-op.
export const cycles = sqliteTable(
  "cycles",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    // 1-based, per workspace; the UI says "Cycle 4".
    number: integer("number").notNull(),
    name: text("name").notNull(),
    // YYYY-MM-DD
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    // upcoming | active | completed
    status: text("status").notNull().default("upcoming"),
    // Set when the rollover ran. The conditional status update is the claim, so a
    // second process (or a restart) never rolls the same cycle twice.
    rolledOverAt: text("rolled_over_at"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("cycles_workspace_start_idx").on(t.workspaceId, t.startsAt),
    index("cycles_workspace_idx").on(t.workspaceId, t.startsAt),
  ]
);

// U-03: project-level milestone/release stage. Position is the plan's order; progress
// is always computed from attached tasks, never stored.
export const projectMilestones = sqliteTable(
  "project_milestones",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // YYYY-MM-DD, optional: a milestone can be undated.
    targetDate: text("target_date"),
    position: integer("position").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("project_milestones_project_idx").on(t.projectId, t.position),
    index("project_milestones_workspace_idx").on(t.workspaceId),
  ]
);

// U-03: an initiative groups projects under one objective. Status/priority/owner/
// target date are the whole planning surface; progress is computed from the projects.
export const initiatives = sqliteTable(
  "initiatives",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // proposed | planned | active | completed | canceled
    status: text("status").notNull().default("proposed"),
    // 0 none, 1 low, 2 medium, 3 high, 4 urgent
    priority: integer("priority").notNull().default(0),
    ownerId: text("owner_id"),
    // YYYY-MM-DD, optional.
    targetDate: text("target_date"),
    // JSON array of { title, url } links.
    resources: text("resources").notNull().default("[]"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("initiatives_workspace_idx").on(t.workspaceId, t.status)]
);

export const initiativeProjects = sqliteTable(
  "initiative_projects",
  {
    initiativeId: text("initiative_id").notNull(),
    projectId: text("project_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.projectId] }),
    index("initiative_projects_project_idx").on(t.projectId),
  ]
);

export const initiativeLabels = sqliteTable(
  "initiative_labels",
  {
    initiativeId: text("initiative_id").notNull(),
    labelId: text("label_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.labelId] })]
);

// U-05: one row per export or import. The job runs in the server process; the row keeps
// progress, the audit trail and the signed download's scope across a page reload.
export const transferJobs = sqliteTable(
  "transfer_jobs",
  {
    id: text("id").primaryKey(),
    // export | import
    kind: text("kind").notNull(),
    // The workspace the owner/admin starts from. The download is scoped to it.
    workspaceId: text("workspace_id").notNull(),
    // Set once an import has created its new (hidden until finished) workspace.
    targetWorkspaceId: text("target_workspace_id"),
    createdBy: text("created_by").notNull(),
    // queued | running | done | failed
    status: text("status").notNull().default("queued"),
    // Human-readable step for the progress line.
    phase: text("phase").notNull().default(""),
    // 0-100. Numbers that move in place render in tabular figures on the page.
    progress: integer("progress").notNull().default(0),
    // JSON: counts, options, the new workspace's name/id once known.
    summary: text("summary").notNull().default("{}"),
    error: text("error"),
    // File name under <data>/exports; empty until the archive is finished.
    artifactPath: text("artifact_path"),
    artifactName: text("artifact_name"),
    artifactBytes: integer("artifact_bytes"),
    // Source hash used to make a repeated import a no-op.
    fingerprint: text("fingerprint"),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [
    index("transfer_jobs_workspace_idx").on(t.workspaceId, t.kind, t.createdAt),
    index("transfer_jobs_fingerprint_idx").on(t.fingerprint, t.createdBy),
  ]
);

