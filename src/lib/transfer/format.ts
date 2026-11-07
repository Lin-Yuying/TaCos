// U-05: the on-disk transfer format and the in-memory import plan.
//
// workspace.json is the canonical, machine-readable export. It refers to documents by
// their path under docs/ and to attachments by the manifest, so large bodies and files
// never sit inside the JSON. Everything in it is data an owner can hand to a teammate:
// no password hashes, API key hashes, session tokens or provider keys.

export const TRANSFER_SCHEMA_VERSION = 1;
export const EXPORT_KIND = "tacos-workspace-export";
export const EXPORT_WORKSPACE_FILE = "workspace.json";
export const EXPORT_MANIFEST_FILE = "manifest.json";
export const EXPORT_TASKS_FILE = "tasks.csv";
export const EXPORT_DOCS_DIR = "docs";
export const EXPORT_ATTACHMENTS_DIR = "attachments";

export type ExportWorkspaceInfo = {
  name: string;
  key: string;
  icon: string | null;
  membersSeeAllTasks: boolean;
  createdAt: string;
};

export type ExportMember = {
  username: string;
  displayName: string;
  role: "admin" | "member";
  createdAt: string;
};

export type ExportProject = {
  id: string;
  name: string;
  key: string;
  color: string;
  icon: string | null;
  description: string;
  doc: string;
  createdBy: string | null;
  createdAt: string;
};

export type ExportLabel = { id: string; name: string; color: string };

export type ExportTaskField = {
  id: string;
  name: string;
  type: string;
  options: string[];
  disabledAt: string | null;
};

export type ExportIssue = {
  id: string;
  identifier: string;
  projectId: string;
  projectKey: string;
  parentId: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  createdBy: string | null;
  dueDate: string | null;
  estimate: number | null;
  reminder: string | null;
  recurrence: string | null;
  createdAt: string;
  updatedAt: string;
  // Usernames, label names and field names keep the JSON readable and let an importer
  // map onto accounts that already exist on the destination server.
  assignees: string[];
  labels: string[];
  fieldValues: Record<string, string>;
  blockedBy: string[];
};

export type ExportComment = {
  id: string;
  issueId: string;
  author: string | null;
  agentAuthor: string | null;
  body: string;
  parentId: string | null;
  editedAt: string | null;
  resolvedAt: string | null;
  reviewState: string | null;
  via: string;
  createdAt: string;
};

export type ExportPage = {
  id: string;
  parentId: string | null;
  projectId: string | null;
  title: string;
  icon: string | null;
  // Path under the ZIP root, e.g. docs/Handbook/Onboarding.md.
  markdownPath: string;
  shared: boolean;
  shareLevel: string;
  position: number;
  createdBy: string;
  templateName: string | null;
  coverAttachmentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExportPageComment = {
  id: string;
  pageId: string;
  author: string | null;
  body: string;
  parentId: string | null;
  quote: string | null;
  resolvedAt: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  via: string;
  createdAt: string;
};

export type ExportApiKey = {
  name: string;
  scopes: string[] | null;
  projectKeys: string[];
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
};

export type ExportTaskView = {
  id: string;
  name: string;
  scope: string;
  projectId: string | null;
  definition: unknown;
  shared: boolean;
  createdAt: string;
};

export type ExportAutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ExportWorkspaceJson = {
  schemaVersion: number;
  kind: typeof EXPORT_KIND;
  exportedAt: string;
  workspace: ExportWorkspaceInfo;
  members: ExportMember[];
  projects: ExportProject[];
  labels: ExportLabel[];
  taskFields: ExportTaskField[];
  issues: ExportIssue[];
  comments: ExportComment[];
  pages: ExportPage[];
  pageComments: ExportPageComment[];
  apiKeys: ExportApiKey[];
  taskViews: ExportTaskView[];
  automationRules: ExportAutomationRule[];
};

export type ExportManifest = {
  schemaVersion: number;
  kind: typeof EXPORT_KIND;
  exportedAt: string;
  workspace: { id: string; name: string; key: string };
  counts: {
    members: number;
    projects: number;
    labels: number;
    taskFields: number;
    tasks: number;
    comments: number;
    documents: number;
    pageComments: number;
    apiKeys: number;
    attachments: number;
  };
  attachments: {
    included: boolean;
    capBytes: number;
    totalBytes: number;
    includedCount: number;
    omittedCount: number;
    omittedBytes: number;
  };
  files: {
    workspace: string;
    tasks: string;
    docs: string;
    attachments: string;
  };
};

export type ExportAttachmentManifest = {
  schemaVersion: number;
  workspaceId: string;
  attachments: Array<{
    id: string;
    pageId: string;
    name: string;
    mime: string;
    size: number;
    // Path under the ZIP root.
    path: string;
    createdAt: string;
  }>;
};

// ---------------------------------------------------------------------------
// Import

export type ImportSourceKind = "tacos-export" | "markdown" | "csv";

export type ImportCounts = {
  members: number;
  matchedMembers: number;
  projects: number;
  labels: number;
  taskFields: number;
  tasks: number;
  comments: number;
  documents: number;
  pageComments: number;
  attachments: number;
  attachmentBytes: number;
};

export type ImportConflict = {
  kind:
    | "task"
    | "document"
    | "comment"
    | "attachment"
    | "member"
    | "project"
    | "csv"
    | "source";
  message: string;
  count: number;
  samples: string[];
};

export type ImportUnmapped = {
  source: string;
  field: string;
  count: number;
};

export type ImportIgnored = {
  section: string;
  count: number;
};

export type PlannedProject = {
  externalId: string;
  name: string;
  key: string | null;
  color: string | null;
  icon: string | null;
  description: string;
  doc: string;
  createdBy: string | null;
};

export type PlannedIssue = {
  externalId: string;
  identifier: string | null;
  projectExternalId: string;
  parentExternalId: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  createdBy: string | null;
  dueDate: string | null;
  estimate: number | null;
  recurrence: string | null;
  assignees: string[];
  labels: string[];
  fieldValues: Record<string, string>;
  blockedBy: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type PlannedComment = {
  externalId: string;
  issueExternalId: string;
  author: string | null;
  agentAuthor: string | null;
  body: string;
  parentExternalId: string | null;
  reviewState: string | null;
  via: string;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
};

export type PlannedPage = {
  externalId: string;
  parentExternalId: string | null;
  projectExternalId: string | null;
  title: string;
  // Canonical exports read the body from this ZIP entry; Markdown imports carry it here.
  markdownPath: string | null;
  doc: string | null;
  icon: string | null;
  shared: boolean;
  shareLevel: string;
  position: number;
  createdBy: string | null;
  templateName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PlannedPageComment = {
  externalId: string;
  pageExternalId: string;
  author: string | null;
  body: string;
  parentExternalId: string | null;
  quote: string | null;
  resolvedAt: string | null;
  editedAt: string | null;
  via: string;
  createdAt: string;
};

export type PlannedAttachment = {
  externalId: string;
  zipPath: string;
  pageExternalId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  // A page cover points at one attachment.
  cover: boolean;
  // Relative links in a Markdown body that this file replaces.
  links: string[];
};

export type ImportPlan = {
  kind: ImportSourceKind;
  fingerprint: string;
  fileName: string;
  bytes: number;
  workspaceName: string;
  workspaceKey: string | null;
  workspaceIcon: string | null;
  // Preserved for a canonical import; Markdown/CSV imports start with the default.
  workspaceMembersSeeAllTasks: boolean;
  members: ExportMember[];
  projects: PlannedProject[];
  labels: ExportLabel[];
  taskFields: ExportTaskField[];
  issues: PlannedIssue[];
  comments: PlannedComment[];
  pages: PlannedPage[];
  pageComments: PlannedPageComment[];
  attachments: PlannedAttachment[];
  conflicts: ImportConflict[];
  unmapped: ImportUnmapped[];
  ignored: ImportIgnored[];
  warnings: string[];
  counts: ImportCounts;
  // A previous successful import of the exact same source and options.
  duplicateWorkspaceId: string | null;
  attachmentCapBytes: number;
};

export type ImportOptions = {
  includeAttachments?: boolean;
  attachmentCapBytes?: number;
  workspaceName?: string;
};

export const DEFAULT_ATTACHMENT_CAP_MB = 1024;

export function attachmentCapBytes(): number {
  const value = Number(process.env.TACOS_TRANSFER_ATTACHMENT_MAX_MB);
  return (value > 0 ? value : DEFAULT_ATTACHMENT_CAP_MB) * 1024 * 1024;
}
