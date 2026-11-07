import crypto from "node:crypto";
import path from "node:path";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { normalizePriority, normalizeStatus } from "@/lib/issues";
import { splitImportedMarkdown } from "@/lib/pages";
import { completedImportForFingerprint } from "@/lib/transfer/jobs";
import {
  EXPORT_KIND,
  EXPORT_WORKSPACE_FILE,
  TRANSFER_SCHEMA_VERSION,
  attachmentCapBytes,
  type ExportAutomationRule,
  type ExportComment,
  type ExportIssue,
  type ExportLabel,
  type ExportMember,
  type ExportPage,
  type ExportPageAccess,
  type ExportPageComment,
  type ExportProjectMember,
  type ExportProject,
  type ExportTaskField,
  type ExportTaskView,
  type ExportWorkspaceJson,
  type ImportConflict,
  type ImportCounts,
  type ImportIgnored,
  type ImportOptions,
  type ImportPlan,
  type ImportUnmapped,
  type PlannedAttachment,
  type PlannedComment,
  type PlannedIssue,
  type PlannedPage,
  type PlannedPageComment,
  type PlannedProject,
} from "@/lib/transfer/format";
import { TacosError } from "@/lib/tacos-error";
import { isJunkEntry, ZipReader, type ZipSourceEntry } from "@/lib/transfer/zip";
import { importEntryMap } from "./zip-paths";
import { cell, mapCsvHeaders, parseCsv, splitList, type CsvMapping } from "./csv";

const MAX_IMPORTED_DOC_BYTES = 4 * 1024 * 1024;
const MAX_CONFLICT_SAMPLES = 5;

class ConflictList {
  private readonly map = new Map<string, ImportConflict>();

  add(kind: ImportConflict["kind"], message: string, sample?: string): void {
    const key = `${kind}\u0000${message}`;
    const existing = this.map.get(key);
    if (existing) {
      existing.count += 1;
      if (sample && existing.samples.length < MAX_CONFLICT_SAMPLES) existing.samples.push(sample);
      return;
    }
    this.map.set(key, {
      kind,
      message,
      count: 1,
      samples: sample ? [sample.slice(0, 160)] : [],
    });
  }

  list(): ImportConflict[] {
    return [...this.map.values()].sort((a, b) => b.count - a.count);
  }
}

class UnmappedList {
  private readonly map = new Map<string, ImportUnmapped>();

  add(source: string, field: string, count = 1): void {
    const key = `${source}\u0000${field}`;
    const existing = this.map.get(key);
    if (existing) existing.count += count;
    else this.map.set(key, { source, field, count });
  }

  list(): ImportUnmapped[] {
    return [...this.map.values()].sort((a, b) => b.count - a.count);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanList(value: unknown): string[] {
  return [...new Set(arrayValue(value).map(stringValue).map((entry) => entry.trim()).filter(Boolean))];
}

function validDueDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function validRecurrence(value: string): string | null {
  return value === "daily" || value === "weekly" || value === "monthly" ? value : null;
}

function sourceStem(fileName: string): string {
  return fileName
    .replace(/\.(zip|csv|md|markdown|txt)$/i, "")
    .replace(/\s+[0-9a-f]{8,}$/i, "")
    .replace(/^Export[-_ ]+/i, "")
    .trim();
}

function safeTitle(value: string, fallback: string): string {
  const title = value.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  return title || fallback;
}


type People = {
  byUsername: Map<string, { id: string; username: string; displayName: string }>;
  byName: Map<string, { id: string; username: string; displayName: string }>;
};

async function loadPeople(): Promise<People> {
  const rows = await getDb()
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users);
  return {
    byUsername: new Map(rows.map((row) => [row.username.toLowerCase(), row])),
    byName: new Map(
      rows.flatMap((row) => [
        [row.username.toLowerCase(), row] as const,
        [row.displayName.toLowerCase(), row] as const,
      ])
    ),
  };
}

function personFor(
  value: string,
  people: People
): { id: string; username: string; displayName: string } | null {
  return people.byUsername.get(value.toLowerCase()) ?? people.byName.get(value.toLowerCase()) ?? null;
}

type BuildContext = {
  reader: ZipReader;
  entries: Map<string, ZipSourceEntry>;
  people: People;
  conflicts: ConflictList;
  unmapped: UnmappedList;
  warnings: Set<string>;
  includeAttachments: boolean;
  capBytes: number;
  attachmentBytes: number;
  attachments: PlannedAttachment[];
  omittedAttachments: number;
  actorId: string;
};

function pushAttachment(
  context: BuildContext,
  candidate: Omit<PlannedAttachment, "cover"> & { cover?: boolean }
): boolean {
  if (!context.includeAttachments) {
    context.omittedAttachments += 1;
    return false;
  }
  if (context.attachmentBytes + candidate.size > context.capBytes) {
    context.omittedAttachments += 1;
    return false;
  }
  context.attachmentBytes += candidate.size;
  context.attachments.push({ ...candidate, cover: candidate.cover ?? false });
  return true;
}

function finishCounts(
  partial: Omit<ImportCounts, "attachmentBytes"> & { attachmentBytes?: number }
): ImportCounts {
  return { ...partial, attachmentBytes: partial.attachmentBytes ?? 0 };
}

// ---------------------------------------------------------------------------
// Canonical TaCos export

async function planCanonical(context: BuildContext, raw: ExportWorkspaceJson, input: {
  fileName: string;
  fingerprint: string;
  options: ImportOptions;
}): Promise<ImportPlan> {
  if (raw.kind !== EXPORT_KIND) throw new TacosError("This ZIP is not a TaCos workspace export", 400);
  if (raw.schemaVersion !== TRANSFER_SCHEMA_VERSION) {
    throw new TacosError(
      `This export uses schema version ${String(raw.schemaVersion)}; this TaCos reads version ${TRANSFER_SCHEMA_VERSION}.`,
      400
    );
  }
  const rawMembers = arrayValue(raw.members) as ExportMember[];
  const matchedMembers: ExportMember[] = [];
  for (const member of rawMembers) {
    const person = peopleRecord(member, context.people);
    if (!person) {
      context.conflicts.add("member", "Members who are not on this server are skipped", stringValue(member?.username));
      continue;
    }
    matchedMembers.push({
      username: person.username,
      displayName: typeof member?.displayName === "string" ? member.displayName : person.username,
      role: member?.role === "admin" ? "admin" : "member",
      createdAt: stringValue(member?.createdAt) || new Date().toISOString(),
    });
  }

  const projects: PlannedProject[] = [];
  const projectByExternal = new Map<string, PlannedProject>();
  for (const project of arrayValue(raw.projects) as ExportProject[]) {
    const name = stringValue(project?.name).trim();
    if (!name) {
      context.conflicts.add("project", "A project without a name was skipped");
      continue;
    }
    const externalId = stringValue(project?.id) || `project:${name.toLowerCase()}`;
    if (projectByExternal.has(externalId)) {
      context.conflicts.add("project", "Duplicate project ids were merged", name);
      continue;
    }
    const planned: PlannedProject = {
      externalId,
      name: name.slice(0, 120),
      key: stringValue(project?.key).slice(0, 12) || null,
      color: stringValue(project?.color) || null,
      icon: stringValue(project?.icon) || null,
      description: stringValue(project?.description).slice(0, 500),
      doc: stringValue(project?.doc),
      createdBy: personFor(stringValue(project?.createdBy), context.people)?.username ?? null,
      members: [
        ...new Set(
          (arrayValue(project?.members) as ExportProjectMember[])
            .map((member) => personFor(stringValue(member?.username), context.people)?.username ?? null)
            .filter((username): username is string => Boolean(username))
        ),
      ],
    };
    projects.push(planned);
    projectByExternal.set(externalId, planned);
  }

  const labels = (arrayValue(raw.labels) as ExportLabel[])
    .filter((label) => stringValue(label?.name).trim())
    .map((label) => ({
      id: stringValue(label.id) || `label:${stringValue(label.name).toLowerCase()}`,
      name: stringValue(label.name).trim().slice(0, 60),
      color: stringValue(label.color) || "#5e6ad2",
    }));
  const taskFields = (arrayValue(raw.taskFields) as ExportTaskField[])
    .filter((field) => stringValue(field?.name).trim())
    .map((field) => ({
      id: stringValue(field.id) || `field:${stringValue(field.name).toLowerCase()}`,
      name: stringValue(field.name).trim().slice(0, 60),
      type: stringValue(field.type) || "text",
      options: cleanList(field?.options),
      disabledAt: stringValue(field?.disabledAt) || null,
    }));

  const issues: PlannedIssue[] = [];
  const issueById = new Map<string, PlannedIssue>();
  const unknownAssignees = new Set<string>();
  for (const issue of arrayValue(raw.issues) as ExportIssue[]) {
    const title = stringValue(issue?.title).trim();
    const externalId = stringValue(issue?.id);
    if (!externalId) {
      context.conflicts.add("task", "A task without an id was skipped", title);
      continue;
    }
    if (!title) {
      context.conflicts.add("task", "Tasks without a title were skipped", externalId);
      continue;
    }
    if (issueById.has(externalId)) {
      context.conflicts.add("task", "Duplicate task ids were skipped", title);
      continue;
    }
    const projectExternalId = stringValue(issue.projectId);
    if (!projectByExternal.has(projectExternalId)) {
      const key = stringValue(issue.projectKey);
      const match = projects.find((project) => project.key === key);
      if (!match) {
        context.conflicts.add("task", "Tasks in a project that is not in the export were skipped", title);
        continue;
      }
    }
    const project = projectByExternal.get(projectExternalId) ?? projects.find((entry) => entry.key === stringValue(issue.projectKey));
    if (!project) {
      context.conflicts.add("task", "Tasks in a project that is not in the export were skipped", title);
      continue;
    }
    const normalizedStatus = normalizeStatus(issue.status);
    if (!normalizedStatus) {
      context.conflicts.add("task", "Unknown task status becomes Todo", title);
      context.unmapped.add("Export", "status", 1);
    }
    const normalizedPriority = normalizePriority(issue.priority);
    if (normalizedPriority === null) context.unmapped.add("Export", "priority", 1);
    const assignees: string[] = [];
    for (const username of cleanList(issue.assignees)) {
      const person = personFor(username, context.people);
      if (!person) {
        unknownAssignees.add(username);
        continue;
      }
      assignees.push(person.username);
    }
    const planned: PlannedIssue = {
      externalId,
      identifier: stringValue(issue.identifier) || null,
      projectExternalId: project.externalId,
      parentExternalId: stringValue(issue.parentId) || null,
      title: title.slice(0, 500),
      description: stringValue(issue.description),
      status: normalizedStatus ?? "todo",
      priority: normalizedPriority ?? 0,
      createdBy: personFor(stringValue(issue.createdBy), context.people)?.username ?? null,
      dueDate: validDueDate(stringValue(issue.dueDate)),
      estimate: typeof issue.estimate === "number" ? issue.estimate : null,
      recurrence: validRecurrence(stringValue(issue.recurrence)),
      assignees: [...new Set(assignees)],
      labels: cleanList(issue.labels),
      fieldValues: Object.fromEntries(
        Object.entries(recordValue(issue.fieldValues))
          .map(([name, value]) => [name, stringValue(value)])
          .filter(([, value]) => value)
      ),
      blockedBy: cleanList(issue.blockedBy),
      createdAt: stringValue(issue.createdAt) || null,
      updatedAt: stringValue(issue.updatedAt) || null,
    };
    issues.push(planned);
    issueById.set(externalId, planned);
  }
  if (unknownAssignees.size > 0) {
    context.conflicts.add(
      "member",
      "Assignees who are not on this server are unassigned",
      [...unknownAssignees].join(", ")
    );
  }
  for (const issue of issues) {
    if (issue.parentExternalId && !issueById.has(issue.parentExternalId)) {
      issue.parentExternalId = null;
      context.conflicts.add("task", "A subtask's parent is missing; it becomes a top-level task", issue.title);
    }
    issue.blockedBy = issue.blockedBy.filter((id) => issueById.has(id));
  }

  const comments: PlannedComment[] = [];
  const commentById = new Map<string, PlannedComment>();
  for (const comment of arrayValue(raw.comments) as ExportComment[]) {
    const externalId = stringValue(comment?.id);
    const issueExternalId = stringValue(comment?.issueId);
    const body = stringValue(comment?.body);
    if (!externalId || !issueById.has(issueExternalId)) {
      context.conflicts.add("comment", "Comments on tasks outside the export were skipped");
      continue;
    }
    if (!body.trim()) {
      context.conflicts.add("comment", "Empty comments were skipped");
      continue;
    }
    const planned: PlannedComment = {
      externalId,
      issueExternalId,
      author: personFor(stringValue(comment.author), context.people)?.username ?? null,
      agentAuthor: stringValue(comment.agentAuthor) || null,
      body,
      parentExternalId: stringValue(comment.parentId) || null,
      reviewState: stringValue(comment.reviewState) || null,
      via: stringValue(comment.via) || "you",
      createdAt: stringValue(comment.createdAt) || new Date().toISOString(),
      editedAt: stringValue(comment.editedAt) || null,
      resolvedAt: stringValue(comment.resolvedAt) || null,
    };
    comments.push(planned);
    commentById.set(externalId, planned);
  }
  for (const comment of comments) {
    if (comment.parentExternalId && !commentById.has(comment.parentExternalId)) comment.parentExternalId = null;
  }

  const pages: PlannedPage[] = [];
  const pageById = new Map<string, PlannedPage>();
  for (const page of arrayValue(raw.pages) as ExportPage[]) {
    const externalId = stringValue(page?.id);
    const title = stringValue(page?.title).trim();
    const markdownPath = stringValue(page?.markdownPath);
    if (!externalId || !title) {
      context.conflicts.add("document", "Documents without an id or title were skipped", title);
      continue;
    }
    if (pageById.has(externalId)) {
      context.conflicts.add("document", "Duplicate document ids were skipped", title);
      continue;
    }
    const entry = context.entries.get(markdownPath);
    if (!entry) {
      context.conflicts.add("document", "Documents whose Markdown file is missing were skipped", title);
      continue;
    }
    if (entry.uncompressedSize > MAX_IMPORTED_DOC_BYTES) {
      context.conflicts.add("document", "Documents larger than 4 MB were skipped", title);
      continue;
    }
    const planned: PlannedPage = {
      externalId,
      parentExternalId: stringValue(page.parentId) || null,
      projectExternalId: stringValue(page.projectId) || null,
      title: safeTitle(title, "Untitled"),
      markdownPath,
      doc: null,
      icon: stringValue(page.icon) || null,
      shared: boolValue(page.shared, true),
      shareLevel: stringValue(page.shareLevel) || "edit",
      access: [
        ...new Map(
          (arrayValue(page?.access) as ExportPageAccess[])
            .map((entry) => {
              const username = personFor(stringValue(entry?.username), context.people)?.username;
              const level = entry?.level === "edit" ? ("edit" as const) : ("view" as const);
              return username ? [username, level] as const : null;
            })
            .filter((entry): entry is readonly [string, "view" | "edit"] => Boolean(entry))
        ).entries(),
      ].map(([username, level]) => ({ username, level })),
      position: numberValue(page.position),
      createdBy: personFor(stringValue(page.createdBy), context.people)?.username ?? null,
      templateName: stringValue(page.templateName) || null,
      createdAt: stringValue(page.createdAt) || null,
      updatedAt: stringValue(page.updatedAt) || null,
    };
    pages.push(planned);
    pageById.set(externalId, planned);
  }
  for (const page of pages) {
    if (page.parentExternalId && !pageById.has(page.parentExternalId)) page.parentExternalId = null;
    if (page.projectExternalId && !projectByExternal.has(page.projectExternalId)) page.projectExternalId = null;
  }

  const pageComments: PlannedPageComment[] = [];
  const pageCommentById = new Map<string, PlannedPageComment>();
  for (const comment of arrayValue(raw.pageComments) as ExportPageComment[]) {
    const externalId = stringValue(comment?.id);
    const pageExternalId = stringValue(comment?.pageId);
    const body = stringValue(comment?.body);
    if (!externalId || !pageById.has(pageExternalId) || !body.trim()) {
      context.conflicts.add("comment", "Document comments on missing documents were skipped");
      continue;
    }
    const planned: PlannedPageComment = {
      externalId,
      pageExternalId,
      author: personFor(stringValue(comment.author), context.people)?.username ?? null,
      body,
      parentExternalId: stringValue(comment.parentId) || null,
      quote: stringValue(comment.quote) || null,
      resolvedAt: stringValue(comment.resolvedAt) || null,
      editedAt: stringValue(comment.editedAt) || null,
      via: stringValue(comment.via) || "you",
      createdAt: stringValue(comment.createdAt) || new Date().toISOString(),
    };
    pageComments.push(planned);
    pageCommentById.set(externalId, planned);
  }
  for (const comment of pageComments) {
    if (comment.parentExternalId && !pageCommentById.has(comment.parentExternalId)) comment.parentExternalId = null;
  }

  // Attachment manifest. The canonical export names cover attachments on the page row,
  // so a file can be marked as one while copying.
  const rawPages = arrayValue(raw.pages) as ExportPage[];
  const coverIds = new Set(
    rawPages
      .map((page) => stringValue(page.coverAttachmentId))
      .filter(Boolean)
  );
  const attachmentEntry = context.entries.get("attachments/manifest.json");
  if (attachmentEntry) {
    let manifest: { attachments?: unknown };
    try {
      manifest = JSON.parse(
        (await context.reader.read(attachmentEntry, 64 * 1024 * 1024)).toString("utf8")
      ) as { attachments?: unknown };
    } catch {
      throw new TacosError("The export's attachment manifest is damaged", 400);
    }
    const seen = new Set<string>();
    for (const rawAttachment of arrayValue(manifest.attachments)) {
      const attachment = recordValue(rawAttachment);
      const id = stringValue(attachment.id);
      const pageExternalId = stringValue(attachment.pageId);
      const zipPath = stringValue(attachment.path);
      const name = stringValue(attachment.name) || path.posix.basename(zipPath) || "file";
      if (!id || !pageById.has(pageExternalId) || !zipPath) {
        context.conflicts.add("attachment", "Attachments whose document is missing were skipped", name);
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      const zipEntry = context.entries.get(zipPath);
      if (!zipEntry) {
        context.conflicts.add("attachment", "Attachments whose file is missing were skipped", name);
        continue;
      }
      pushAttachment(context, {
        externalId: id,
        zipPath,
        pageExternalId,
        name,
        mime: stringValue(attachment.mime) || "application/octet-stream",
        size: numberValue(attachment.size, zipEntry.uncompressedSize),
        createdAt: stringValue(attachment.createdAt) || new Date().toISOString(),
        cover: coverIds.has(id),
        links: [],
      });
    }
  } else if (pages.length > 0) {
    context.warnings.add("The archive has no attachment manifest; documents were imported without their files.");
  }

  const ignored: ImportIgnored[] = [];
  const views = arrayValue(raw.taskViews) as ExportTaskView[];
  const rules = arrayValue(raw.automationRules) as ExportAutomationRule[];
  if (views.length > 0) ignored.push({ section: "Saved views", count: views.length });
  if (rules.length > 0) ignored.push({ section: "Automation rules", count: rules.length });
  const keyCount = arrayValue(raw.apiKeys).length;
  if (keyCount > 0) ignored.push({ section: "API keys", count: keyCount });
  if (!context.includeAttachments) {
    context.warnings.add("Attachments are off; documents import without their files.");
  } else if (context.omittedAttachments > 0) {
    context.warnings.add(`${context.omittedAttachments} attachments were skipped because they exceed the size cap.`);
  }

  const effectiveFingerprint = fingerprintFor(input.fingerprint, {
    includeAttachments: context.includeAttachments,
    capBytes: context.capBytes,
    workspaceName: input.options.workspaceName ?? "",
  });
  const previous = await completedImportForFingerprint(effectiveFingerprint, context.actorId);
  return {
    kind: "tacos-export",
    fingerprint: effectiveFingerprint,
    fileName: input.fileName,
    bytes: 0,
    workspaceName: safeTitle(
      input.options.workspaceName ?? stringValue(raw.workspace?.name) ?? "",
      sourceStem(input.fileName) || "Imported workspace"
    ),
    workspaceKey: stringValue(raw.workspace?.key).slice(0, 8) || null,
    workspaceIcon: stringValue(raw.workspace?.icon) || null,
    workspaceMembersSeeAllTasks: boolValue(raw.workspace?.membersSeeAllTasks, true),
    members: matchedMembers,
    projects,
    labels,
    taskFields,
    issues,
    comments,
    pages,
    pageComments,
    attachments: context.attachments,
    conflicts: context.conflicts.list(),
    unmapped: context.unmapped.list(),
    ignored,
    warnings: [...context.warnings],
    counts: finishCounts({
      members: rawMembers.length,
      matchedMembers: matchedMembers.length,
      projects: projects.length,
      labels: labels.length,
      taskFields: taskFields.length,
      tasks: issues.length,
      comments: comments.length,
      documents: pages.length,
      pageComments: pageComments.length,
      attachments: context.attachments.length,
      attachmentBytes: context.attachmentBytes,
    }),
    duplicateWorkspaceId: previous?.targetWorkspaceId ?? null,
    attachmentCapBytes: context.capBytes,
  };
}

function peopleRecord(
  value: unknown,
  people: People
): { id: string; username: string; displayName: string } | null {
  const record = recordValue(value);
  return personFor(stringValue(record.username), people);
}

function fingerprintFor(sourceFingerprint: string, options: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(sourceFingerprint)
    .update("\u0000")
    .update(JSON.stringify(options))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Markdown folder and CSV

type DocNode = {
  path: string;
  segments: string[];
  doc: string | null;
  title: string | null;
  sourceEntry: string | null;
};

function markdownStem(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

/** Notion appends a hash to exported page and database names; it is not part of the title. */
function niceSegment(value: string): string {
  return value
    .replace(/\s+[0-9a-f]{8,}$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function relativeTarget(docPath: string, target: string): string {
  const dir = path.posix.dirname(docPath);
  return path.posix.normalize(path.posix.join(dir === "." ? "" : dir, decodeTarget(target)));
}

function findAsset(
  entries: Map<string, ZipSourceEntry>,
  docPath: string,
  target: string
): { path: string; entry: ZipSourceEntry } | null {
  if (!target || /^(https?:|mailto:|tel:|data:|#|\/)/i.test(target)) return null;
  const cleaned = target.replace(/^<|>$/g, "");
  if (!cleaned || /\.(md|markdown|csv)$/i.test(cleaned)) return null;
  const resolved = relativeTarget(docPath, cleaned);
  const exact = entries.get(resolved);
  if (exact) return { path: resolved, entry: exact };
  const base = path.posix.basename(decodeTarget(cleaned)).toLowerCase();
  const matches = [...entries.entries()].filter(
    ([name]) => path.posix.basename(name).toLowerCase() === base
  );
  return matches.length === 1 ? { path: matches[0][0], entry: matches[0][1] } : null;
}

const LINK_PATTERNS = [
  /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
  /<(?:img|a)[^>]+(?:src|href)=["']([^"']+)["']/gi,
];

function linkedTargets(doc: string): string[] {
  const out = new Set<string>();
  for (const pattern of LINK_PATTERNS) {
    for (const match of doc.matchAll(pattern)) {
      if (match[1]) out.add(match[1]);
    }
  }
  return [...out];
}

function ensureMember(members: ExportMember[], person: { username: string; displayName: string }): void {
  if (members.some((member) => member.username === person.username)) return;
  members.push({
    username: person.username,
    displayName: person.displayName,
    role: "member",
    createdAt: new Date().toISOString(),
  });
}

function projectExternalForName(name: string): string {
  return `csv-project:${name.trim().toLowerCase()}`;
}

function csvProjectName(csvPath: string): string {
  const stem = path.posix
    .basename(csvPath)
    .replace(/\.csv$/i, "")
    .replace(/\s+[0-9a-f]{8,}$/i, "")
    .trim();
  return /^(tasks?|export|import|untitled)$/i.test(stem) ? "Imported tasks" : stem || "Imported tasks";
}

function addCsvRows(input: {
  context: BuildContext;
  table: ReturnType<typeof parseCsv>;
  mapping: CsvMapping;
  csvPath: string;
  projectName: string | null;
  projects: PlannedProject[];
  projectByName: Map<string, PlannedProject>;
  members: ExportMember[];
  issues: PlannedIssue[];
  labels: Map<string, ExportLabel>;
  pendingParents: Map<string, string>;
  seenRows: Set<string>;
}): void {
  const { context, table, mapping, csvPath, projects, projectByName, members, issues, labels, pendingParents, seenRows } = input;
  const columns = mapping.columns;
  table.rows.forEach((row, index) => {
    const title = cell(row, columns.title).replace(/\s+/g, " ").trim();
    if (!title) {
      context.conflicts.add("csv", "CSV rows without a title were skipped", `${csvPath} row ${index + 2}`);
      return;
    }
    const rowProject = cell(row, columns.project) || input.projectName || csvProjectName(csvPath);
    const projectName = rowProject.slice(0, 120) || "Imported tasks";
    let project = projectByName.get(projectName.toLowerCase());
    if (!project) {
      project = {
        externalId: projectExternalForName(projectName),
        name: projectName,
        key: null,
        color: null,
        icon: null,
        description: "",
        doc: "",
        createdBy: null,
        members: [],
      };
      projects.push(project);
      projectByName.set(projectName.toLowerCase(), project);
    }
    const identifier = cell(row, columns.identifier) || null;
    const dedupeKey = (identifier ?? `${project.externalId}\u0000${title.toLowerCase()}`).toLowerCase();
    if (seenRows.has(dedupeKey)) {
      context.conflicts.add("csv", "Duplicate CSV rows were skipped", `${csvPath} row ${index + 2}: ${title}`);
      return;
    }
    seenRows.add(dedupeKey);
    const status = normalizeStatus(cell(row, columns.status));
    if (!status && cell(row, columns.status)) {
      context.unmapped.add(csvPath, "status", 1);
    }
    const rawPriority = cell(row, columns.priority);
    const priority = normalizePriority(rawPriority);
    if (priority === null && rawPriority) context.unmapped.add(csvPath, "priority", 1);
    const assignees: string[] = [];
    for (const name of splitList(cell(row, columns.assignees))) {
      const person = personFor(name, context.people);
      if (!person) {
        context.conflicts.add("member", "CSV assignees who are not on this server are unassigned", name);
        continue;
      }
      assignees.push(person.username);
      ensureMember(members, person);
    }
    const labelNames = splitList(cell(row, columns.labels)).map((name) => name.slice(0, 60));
    for (const name of labelNames) {
      if (!labels.has(name.toLowerCase())) {
        labels.set(name.toLowerCase(), { id: `label:${name.toLowerCase()}`, name, color: "#5e6ad2" });
      }
    }
    const estimateText = cell(row, columns.estimate);
    const estimate = estimateText && Number.isFinite(Number(estimateText)) ? Number(estimateText) : null;
    const externalId = `${csvPath}#${index + 2}`;
    const dueText = cell(row, columns.dueDate);
    const dueDate = validDueDate(dueText);
    if (dueText && !dueDate) {
      context.conflicts.add("csv", "Due dates that are not YYYY-MM-DD were ignored", `${csvPath} row ${index + 2}: ${dueText}`);
    }
    const recurrenceText = cell(row, columns.recurrence);
    const recurrence = validRecurrence(recurrenceText);
    if (recurrenceText && !recurrence) {
      context.conflicts.add("csv", "Unknown recurrence values were ignored", `${csvPath} row ${index + 2}: ${recurrenceText}`);
    }
    const parentText = cell(row, columns.parent);
    if (parentText) pendingParents.set(externalId, parentText);
    const planned: PlannedIssue = {
      externalId,
      identifier,
      projectExternalId: project.externalId,
      parentExternalId: null,
      title: title.slice(0, 500),
      description: cell(row, columns.description),
      status: status ?? "todo",
      priority: priority ?? 0,
      createdBy: null,
      dueDate,
      estimate,
      recurrence,
      assignees: [...new Set(assignees)],
      labels: [...new Set(labelNames)],
      fieldValues: {},
      blockedBy: [],
      createdAt: cell(row, columns.createdAt) || null,
      updatedAt: null,
    };
    issues.push(planned);
  });
}

function resolveCsvParents(
  issues: PlannedIssue[],
  pendingParents: Map<string, string>,
  conflicts: ConflictList
): void {
  const byIdentifier = new Map<string, PlannedIssue>();
  const byProjectTitle = new Map<string, PlannedIssue>();
  for (const issue of issues) {
    if (issue.identifier) byIdentifier.set(issue.identifier.toLowerCase(), issue);
    byProjectTitle.set(`${issue.projectExternalId}\u0000${issue.title.toLowerCase()}`, issue);
  }
  for (const issue of issues) {
    const raw = pendingParents.get(issue.externalId);
    if (!raw) continue;
    const found =
      byIdentifier.get(raw.toLowerCase()) ??
      byProjectTitle.get(`${issue.projectExternalId}\u0000${raw.toLowerCase()}`);
    if (found && found.externalId !== issue.externalId) {
      issue.parentExternalId = found.externalId;
    } else {
      conflicts.add("csv", "A CSV parent reference did not match a task; the task becomes top-level", raw);
    }
  }
}

async function planMarkdown(
  context: BuildContext,
  input: { fileName: string; fingerprint: string; bytes: number; options: ImportOptions }
): Promise<ImportPlan> {
  const entries = context.entries;
  const markdownEntries = [...entries.entries()].filter(([name]) => /\.(md|markdown)$/i.test(name));
  const csvEntries = [...entries.entries()].filter(([name]) => /\.csv$/i.test(name));
  if (markdownEntries.length === 0 && csvEntries.length === 0) {
    throw new TacosError("No Markdown documents or CSV files were found in this archive", 400);
  }
  const docs: DocNode[] = [];
  for (const [name, entry] of markdownEntries) {
    if (entry.uncompressedSize > MAX_IMPORTED_DOC_BYTES) {
      context.conflicts.add("document", "Markdown files larger than 4 MB were skipped", name);
      continue;
    }
    let content: string;
    try {
      content = (await context.reader.read(entry, MAX_IMPORTED_DOC_BYTES)).toString("utf8");
    } catch {
      context.conflicts.add("document", "Markdown files that could not be read were skipped", name);
      continue;
    }
    const segments = markdownStem(name).split("/").filter(Boolean);
    const stem = segments[segments.length - 1] ?? "Untitled";
    const parsed = splitImportedMarkdown(stem, content);
    const title = safeTitle(parsed.title, niceSegment(stem) || "Untitled");
    docs.push({ path: markdownStem(name), segments, doc: parsed.doc, title, sourceEntry: name });
  }
  // One page per path segment; a page with children and a Markdown body is the same node.
  const nodes = new Map<string, DocNode>();
  for (const doc of docs) {
    const segments = doc.segments;
    for (let depth = 1; depth <= segments.length; depth++) {
      const prefix = segments.slice(0, depth);
      const key = prefix.join("/");
      if (!nodes.has(key)) {
        nodes.set(key, {
          path: key,
          segments: prefix,
          doc: null,
          title: depth === segments.length ? doc.title : niceSegment(prefix[depth - 1]),
          sourceEntry: null,
        });
      }
    }
    const node = nodes.get(segments.join("/"))!;
    node.doc = doc.doc;
    node.title = doc.title;
    node.sourceEntry = doc.sourceEntry;
  }
  const ordered = [...nodes.values()].sort(
    (a, b) => a.segments.length - b.segments.length || a.path.localeCompare(b.path)
  );
  const pages: PlannedPage[] = ordered.map((node, index) => ({
    externalId: `markdown:${node.path}`,
    parentExternalId:
      node.segments.length > 1 ? `markdown:${node.segments.slice(0, -1).join("/")}` : null,
    projectExternalId: null,
    title: safeTitle(node.title ?? node.segments[node.segments.length - 1], "Untitled"),
    markdownPath: null,
    doc: node.doc ?? "",
    icon: null,
    // Import into a new team workspace; the pages were shared in the source tool.
    shared: true,
    shareLevel: "edit",
    access: [],
    position: index,
    createdBy: null,
    templateName: null,
    createdAt: null,
    updatedAt: null,
  }));
  // Relative images and file links become attachments when the archive carries them.
  for (const page of pages) {
    const node = nodes.get(page.externalId.replace(/^markdown:/, ""));
    if (!node?.doc || !node.sourceEntry) continue;
    for (const target of linkedTargets(node.doc)) {
      const asset = findAsset(entries, node.sourceEntry, target);
      if (!asset) continue;
      const name = path.posix.basename(asset.path);
      const existing = context.attachments.find(
        (attachment) => attachment.pageExternalId === page.externalId && attachment.zipPath === asset.path
      );
      if (existing) {
        if (!existing.links.includes(target)) existing.links.push(target);
        continue;
      }
      pushAttachment(context, {
        externalId: `asset:${asset.path}`,
        zipPath: asset.path,
        pageExternalId: page.externalId,
        name,
        mime: "application/octet-stream",
        size: asset.entry.uncompressedSize,
        createdAt: new Date().toISOString(),
        cover: false,
        links: [target],
      });
    }
  }

  const projects: PlannedProject[] = [];
  const projectByName = new Map<string, PlannedProject>();
  const issues: PlannedIssue[] = [];
  const labels = new Map<string, ExportLabel>();
  const members: ExportMember[] = [];
  const pendingParents = new Map<string, string>();
  const seenRows = new Set<string>();
  for (const [csvPath] of csvEntries) {
    const entry = entries.get(csvPath)!;
    if (entry.uncompressedSize > 64 * 1024 * 1024) {
      context.conflicts.add("csv", "CSV files larger than 64 MB were skipped", csvPath);
      continue;
    }
    const text = (await context.reader.read(entry, 64 * 1024 * 1024)).toString("utf8");
    const table = parseCsv(text);
    const mapping = mapCsvHeaders(table.headers);
    for (const header of mapping.unmapped) context.unmapped.add(csvPath, header, table.rows.length);
    for (const header of mapping.duplicated) {
      context.warnings.add(`Column "${header}" repeats a mapped field in ${csvPath} and was ignored.`);
    }
    if (mapping.columns.title === undefined) {
      context.conflicts.add("csv", "CSV files without a title column were skipped", csvPath);
      continue;
    }
    addCsvRows({
      context,
      table,
      mapping,
      csvPath,
      projectName: csvProjectName(csvPath),
      projects,
      projectByName,
      members,
      issues,
      labels,
      pendingParents,
      seenRows,
    });
  }
  resolveCsvParents(issues, pendingParents, context.conflicts);

  const unsupported = [...entries.keys()].filter(
    (name) => !/\.(md|markdown|csv)$/i.test(name) && !context.attachments.some((a) => a.zipPath === name)
  );
  if (unsupported.length > 0 && context.includeAttachments) {
    context.conflicts.add(
      "source",
      "Files that are neither Markdown, CSV nor linked from a document were skipped",
      unsupported.slice(0, 3).join(", ")
    );
  } else if (unsupported.length > 0) {
    context.warnings.add(`${unsupported.length} files were skipped because attachment import is off.`);
  }
  if (!context.includeAttachments) {
    context.warnings.add("Attachments are off; documents import without their files.");
  } else if (context.omittedAttachments > 0) {
    context.warnings.add(`${context.omittedAttachments} linked files were skipped because they exceed the size cap.`);
  }
  const effectiveFingerprint = fingerprintFor(input.fingerprint, {
    includeAttachments: context.includeAttachments,
    capBytes: context.capBytes,
    workspaceName: input.options.workspaceName ?? "",
  });
  const previous = await completedImportForFingerprint(effectiveFingerprint, context.actorId);
  return {
    kind: csvEntries.length > 0 && markdownEntries.length === 0 ? "csv" : "markdown",
    fingerprint: effectiveFingerprint,
    fileName: input.fileName,
    bytes: input.bytes,
    workspaceName: safeTitle(
      input.options.workspaceName ?? "",
      sourceStem(input.fileName) || "Imported workspace"
    ),
    workspaceKey: null,
    workspaceIcon: null,
    workspaceMembersSeeAllTasks: true,
    members,
    projects,
    labels: [...labels.values()],
    taskFields: [],
    issues,
    comments: [],
    pages,
    pageComments: [],
    attachments: context.attachments,
    conflicts: context.conflicts.list(),
    unmapped: context.unmapped.list(),
    ignored: [],
    warnings: [...context.warnings],
    counts: finishCounts({
      members: members.length,
      matchedMembers: members.length,
      projects: projects.length,
      labels: labels.size,
      taskFields: 0,
      tasks: issues.length,
      comments: 0,
      documents: pages.length,
      pageComments: 0,
      attachments: context.attachments.length,
      attachmentBytes: context.attachmentBytes,
    }),
    duplicateWorkspaceId: previous?.targetWorkspaceId ?? null,
    attachmentCapBytes: context.capBytes,
  };
}

// ---------------------------------------------------------------------------

export async function buildImportPlan(input: {
  sourcePath: string;
  fileName: string;
  bytes: number;
  fingerprint: string;
  options?: ImportOptions;
  actorId: string;
}): Promise<ImportPlan> {
  const options = input.options ?? {};
  const includeAttachments = options.includeAttachments ?? true;
  const capBytes = options.attachmentCapBytes && options.attachmentCapBytes > 0
    ? options.attachmentCapBytes
    : attachmentCapBytes();
  const reader = await ZipReader.open(input.sourcePath);
  try {
    const entries = importEntryMap(
      reader.list().filter((entry) => !isJunkEntry(entry.name))
    );
    const people = await loadPeople();
    const context: BuildContext = {
      reader,
      entries,
      people,
      conflicts: new ConflictList(),
      unmapped: new UnmappedList(),
      warnings: new Set(),
      includeAttachments,
      capBytes,
      attachmentBytes: 0,
      attachments: [],
      omittedAttachments: 0,
      actorId: input.actorId,
    };
    const canonicalEntry = entries.get(EXPORT_WORKSPACE_FILE);
    if (canonicalEntry) {
      if (canonicalEntry.uncompressedSize > 256 * 1024 * 1024) {
        throw new TacosError("The export's workspace.json is larger than 256 MB", 400);
      }
      let parsed: ExportWorkspaceJson;
      try {
        parsed = JSON.parse(
          (await reader.read(canonicalEntry, 256 * 1024 * 1024)).toString("utf8")
        ) as ExportWorkspaceJson;
      } catch {
        throw new TacosError("The export's workspace.json is not valid JSON", 400);
      }
      const plan = await planCanonical(context, parsed, {
        fileName: input.fileName,
        fingerprint: input.fingerprint,
        options,
      });
      return { ...plan, bytes: input.bytes };
    }
    return await planMarkdown(context, {
      fileName: input.fileName,
      fingerprint: input.fingerprint,
      bytes: input.bytes,
      options,
    });
  } finally {
    await reader.close();
  }
}

