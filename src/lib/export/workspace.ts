import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  apiKeys,
  attachments,
  automationRules,
  comments,
  issueAssignees,
  issueDependencies,
  issueLabels,
  issues,
  labels,
  pageComments,
  pages,
  projects,
  taskFieldValues,
  taskFields,
  taskViews,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import { UPLOAD_DIR } from "@/lib/attachments";
import { DATA_DIR } from "@/lib/data-dir";
import {
  EXPORT_ATTACHMENTS_DIR,
  EXPORT_DOCS_DIR,
  EXPORT_KIND,
  EXPORT_MANIFEST_FILE,
  EXPORT_TASKS_FILE,
  EXPORT_WORKSPACE_FILE,
  TRANSFER_SCHEMA_VERSION,
  attachmentCapBytes,
  type ExportApiKey,
  type ExportAttachmentManifest,
  type ExportAutomationRule,
  type ExportComment,
  type ExportIssue,
  type ExportManifest,
  type ExportMember,
  type ExportPage,
  type ExportPageComment,
  type ExportProject,
  type ExportTaskView,
  type ExportWorkspaceInfo,
} from "@/lib/transfer/format";
import { ZipWriter } from "@/lib/transfer/zip";

export type ExportProgress = (phase: string, progress: number) => void;

export type ExportResult = {
  bytes: number;
  entries: number;
  fileName: string;
  counts: ExportManifest["counts"];
  attachments: ExportManifest["attachments"];
  workspace: { id: string; name: string; key: string };
};

type PageRow = typeof pages.$inferSelect;

const PAGE_BATCH = 500;

export function exportFileName(workspace: { name: string; key: string }): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const key = workspace.key.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 24) || "workspace";
  return `${key.toLowerCase()}-export-${stamp}.zip`;
}

function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 80);
  return cleaned || "Untitled";
}

/**
 * A page's ZIP path is its parent chain plus its title. Siblings that sanitize to the
 * same name get a numeric suffix, so two different documents never overwrite one file.
 */
function buildDocPaths(pageRows: PageRow[]): Map<string, string> {
  const byParent = new Map<string | null, PageRow[]>();
  const ids = new Set(pageRows.map((page) => page.id));
  for (const page of pageRows) {
    const parent = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(page);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  const used = new Map<string, Set<string>>();
  const result = new Map<string, string>();
  const visit = (parent: string | null, segments: string[], depth: number) => {
    if (depth > 32) return;
    const key = parent ?? "";
    const taken = used.get(key) ?? new Set<string>();
    used.set(key, taken);
    for (const page of byParent.get(parent) ?? []) {
      const base = safeSegment(page.title);
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
      taken.add(name.toLowerCase());
      const next = [...segments, name];
      result.set(page.id, `${EXPORT_DOCS_DIR}/${next.join("/")}.md`);
      visit(page.id, next, depth + 1);
    }
  };
  visit(null, [], 0);
  // A parent cycle would leave rows unseen; still give them a path rather than losing them.
  for (const page of pageRows) {
    if (!result.has(page.id)) result.set(page.id, `${EXPORT_DOCS_DIR}/${safeSegment(page.title)}-${page.id.slice(0, 8)}.md`);
  }
  return result;
}

function pageMarkdown(title: string, doc: string): string {
  const heading = title.replace(/[\r\n]+/g, " ").trim() || "Untitled";
  const body = doc.replace(/\r\n/g, "\n");
  return `# ${heading}\n\n${body}`;
}

function mimeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".zip": "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

function attachmentZipPath(id: string, name: string): string {
  return `${EXPORT_ATTACHMENTS_DIR}/${id}/${safeSegment(name)}`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function memberNameMap(rows: Array<{ userId: string; username: string }>): Map<string, string> {
  return new Map(rows.map((row) => [row.userId, row.username]));
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function* issueRecords(
  workspaceId: string,
  projectKeys: Map<string, string>,
  people: Map<string, string>,
  onCount: (count: number) => void
): AsyncGenerator<ExportIssue> {
  const db = getDb();
  let cursor: string | null = null;
  while (true) {
    const rows = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.workspaceId, workspaceId),
          isNull(issues.deletedAt),
          cursor ? gt(issues.id, cursor) : undefined
        )
      )
      .orderBy(asc(issues.id))
      .limit(PAGE_BATCH);
    if (rows.length === 0) break;
    const ids = rows.map((row) => row.id);
    const [assigneeRows, labelRows, fieldRows, dependencyRows] = await Promise.all([
      db
        .select({ issueId: issueAssignees.issueId, userId: issueAssignees.userId })
        .from(issueAssignees)
        .where(inArray(issueAssignees.issueId, ids)),
      db
        .select({ issueId: issueLabels.issueId, name: labels.name })
        .from(issueLabels)
        .innerJoin(labels, eq(labels.id, issueLabels.labelId))
        .where(inArray(issueLabels.issueId, ids)),
      db
        .select({
          issueId: taskFieldValues.issueId,
          name: taskFields.name,
          value: taskFieldValues.value,
        })
        .from(taskFieldValues)
        .innerJoin(taskFields, eq(taskFields.id, taskFieldValues.fieldId))
        .where(inArray(taskFieldValues.issueId, ids)),
      db
        .select({ issueId: issueDependencies.issueId, blockedById: issueDependencies.blockedById })
        .from(issueDependencies)
        .where(inArray(issueDependencies.issueId, ids)),
    ]);
    const assignees = new Map<string, string[]>();
    for (const row of assigneeRows) {
      const username = people.get(row.userId);
      if (!username) continue;
      assignees.set(row.issueId, [...(assignees.get(row.issueId) ?? []), username]);
    }
    const labelsByIssue = new Map<string, string[]>();
    for (const row of labelRows) {
      labelsByIssue.set(row.issueId, [...(labelsByIssue.get(row.issueId) ?? []), row.name]);
    }
    const fieldsByIssue = new Map<string, Record<string, string>>();
    for (const row of fieldRows) {
      fieldsByIssue.set(row.issueId, { ...(fieldsByIssue.get(row.issueId) ?? {}), [row.name]: row.value });
    }
    const blockedBy = new Map<string, string[]>();
    for (const row of dependencyRows) {
      blockedBy.set(row.issueId, [...(blockedBy.get(row.issueId) ?? []), row.blockedById]);
    }
    for (const row of rows) {
      onCount(1);
      yield {
        id: row.id,
        identifier: row.identifier,
        projectId: row.projectId,
        projectKey: projectKeys.get(row.projectId) ?? "",
        parentId: row.parentId ?? null,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        createdBy: (row.createdBy && people.get(row.createdBy)) || null,
        dueDate: row.dueDate ?? null,
        estimate: row.estimate ?? null,
        reminder: row.reminder ?? null,
        recurrence: row.recurrence ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        assignees: [...new Set(assignees.get(row.id) ?? [])].sort(),
        labels: [...new Set(labelsByIssue.get(row.id) ?? [])].sort(),
        fieldValues: fieldsByIssue.get(row.id) ?? {},
        blockedBy: blockedBy.get(row.id) ?? [],
      };
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE_BATCH) break;
  }
}

async function* commentRecords(
  workspaceId: string,
  people: Map<string, string>,
  onCount: (count: number) => void
): AsyncGenerator<ExportComment> {
  const db = getDb();
  let cursor: string | null = null;
  while (true) {
    const rows = await db
      .select({
        id: comments.id,
        issueId: comments.issueId,
        authorId: comments.authorId,
        agentAuthor: comments.agentAuthor,
        body: comments.body,
        parentId: comments.parentId,
        editedAt: comments.editedAt,
        resolvedAt: comments.resolvedAt,
        reviewState: comments.reviewState,
        via: comments.via,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(issues, eq(issues.id, comments.issueId))
      .where(
        and(
          eq(issues.workspaceId, workspaceId),
          isNull(issues.deletedAt),
          isNull(comments.deletedAt),
          cursor ? gt(comments.id, cursor) : undefined
        )
      )
      .orderBy(asc(comments.id))
      .limit(PAGE_BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      onCount(1);
      yield {
        id: row.id,
        issueId: row.issueId,
        author: (row.authorId && people.get(row.authorId)) || null,
        agentAuthor: row.agentAuthor ?? null,
        body: row.body,
        parentId: row.parentId ?? null,
        editedAt: row.editedAt ?? null,
        resolvedAt: row.resolvedAt ?? null,
        reviewState: row.reviewState ?? null,
        via: row.via,
        createdAt: row.createdAt,
      };
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE_BATCH) break;
  }
}

async function* pageCommentRecords(
  workspaceId: string,
  people: Map<string, string>,
  onCount: (count: number) => void
): AsyncGenerator<ExportPageComment> {
  const db = getDb();
  let cursor: string | null = null;
  while (true) {
    const rows = await db
      .select()
      .from(pageComments)
      .where(
        and(
          eq(pageComments.workspaceId, workspaceId),
          isNull(pageComments.deletedAt),
          cursor ? gt(pageComments.id, cursor) : undefined
        )
      )
      .orderBy(asc(pageComments.id))
      .limit(PAGE_BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      onCount(1);
      yield {
        id: row.id,
        pageId: row.pageId,
        author: people.get(row.authorId) ?? null,
        body: row.body,
        parentId: row.parentId ?? null,
        quote: row.quote ?? null,
        resolvedAt: row.resolvedAt ?? null,
        editedAt: row.editedAt ?? null,
        deletedAt: row.deletedAt ?? null,
        via: row.via,
        createdAt: row.createdAt,
      };
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE_BATCH) break;
  }
}

async function* tasksCsv(
  workspaceId: string,
  projectKeys: Map<string, string>,
  projectNames: Map<string, string>,
  people: Map<string, string>
): AsyncGenerator<string> {
  yield "identifier,title,description,status,priority,project,assignees,labels,due_date,estimate,parent,created_at\n";
  const db = getDb();
  let cursor: string | null = null;
  while (true) {
    const rows = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.workspaceId, workspaceId),
          isNull(issues.deletedAt),
          cursor ? gt(issues.id, cursor) : undefined
        )
      )
      .orderBy(asc(issues.id))
      .limit(PAGE_BATCH);
    if (rows.length === 0) break;
    const ids = rows.map((row) => row.id);
    const parentIds = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => Boolean(id)))];
    const [assigneeRows, labelRows, parents] = await Promise.all([
      db
        .select({ issueId: issueAssignees.issueId, userId: issueAssignees.userId })
        .from(issueAssignees)
        .where(inArray(issueAssignees.issueId, ids)),
      db
        .select({ issueId: issueLabels.issueId, name: labels.name })
        .from(issueLabels)
        .innerJoin(labels, eq(labels.id, issueLabels.labelId))
        .where(inArray(issueLabels.issueId, ids)),
      parentIds.length
        ? db
            .select({ id: issues.id, identifier: issues.identifier })
            .from(issues)
            .where(inArray(issues.id, parentIds))
        : Promise.resolve([] as Array<{ id: string; identifier: string }>),
    ]);
    const assignees = new Map<string, string[]>();
    for (const row of assigneeRows) {
      const username = people.get(row.userId);
      if (username) assignees.set(row.issueId, [...(assignees.get(row.issueId) ?? []), username]);
    }
    const taskLabels = new Map<string, string[]>();
    for (const row of labelRows) {
      taskLabels.set(row.issueId, [...(taskLabels.get(row.issueId) ?? []), row.name]);
    }
    const parentIdentifier = new Map(parents.map((row) => [row.id, row.identifier]));
    for (const row of rows) {
      yield [
        csvCell(row.identifier),
        csvCell(row.title),
        csvCell(row.description),
        csvCell(row.status),
        csvCell(row.priority),
        csvCell(projectNames.get(row.projectId) ?? projectKeys.get(row.projectId) ?? ""),
        csvCell((assignees.get(row.id) ?? []).sort().join("; ")),
        csvCell((taskLabels.get(row.id) ?? []).sort().join("; ")),
        csvCell(row.dueDate ?? ""),
        csvCell(row.estimate ?? ""),
        csvCell(row.parentId ? parentIdentifier.get(row.parentId) ?? "" : ""),
        csvCell(row.createdAt),
      ].join(",") + "\n";
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < PAGE_BATCH) break;
  }
}

/**
 * Writes the canonical archive. Every large body streams into the ZIP: issue and
 * comment rows page in batches, documents are read one at a time, attachments are
 * piped from disk. Memory stays proportional to one row or one file.
 */
export async function writeWorkspaceExport(
  workspaceId: string,
  outputPath: string,
  options: { includeAttachments?: boolean; attachmentCapBytes?: number; onProgress?: ExportProgress } = {}
): Promise<ExportResult> {
  const progress = (phase: string, percent: number) => options.onProgress?.(phase, percent);
  const includeAttachments = options.includeAttachments ?? true;
  const capBytes = options.attachmentCapBytes && options.attachmentCapBytes > 0 ? options.attachmentCapBytes : attachmentCapBytes();
  const db = getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace || workspace.deletedAt) throw new TacosError("Workspace not found", 404);
  const exportedAt = new Date().toISOString();

  progress("Collecting workspace", 2);
  const memberRows = await db
    .select({
      userId: workspaceMembers.userId,
      username: users.username,
      displayName: users.displayName,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt), asc(users.username));
  const people = memberNameMap(memberRows);
  const members: ExportMember[] = memberRows.map((row) => ({
    username: row.username,
    displayName: row.displayName,
    role: row.role === "admin" ? "admin" : "member",
    createdAt: row.createdAt,
  }));

  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.createdAt));
  const projectKeys = new Map(projectRows.map((row) => [row.id, row.key]));
  const projectNames = new Map(projectRows.map((row) => [row.id, row.name]));
  const projectExport: ExportProject[] = projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.key,
    color: row.color,
    icon: row.icon ?? null,
    description: row.description,
    doc: row.doc,
    createdBy: (row.createdBy && people.get(row.createdBy)) || null,
    createdAt: row.createdAt,
  }));

  const labelRows = await db
    .select()
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.createdAt));
  const fieldRows = await db
    .select()
    .from(taskFields)
    .where(eq(taskFields.workspaceId, workspaceId))
    .orderBy(asc(taskFields.createdAt));

  const pageRows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)))
    .orderBy(asc(pages.position), asc(pages.createdAt));
  const docPaths = buildDocPaths(pageRows);
  const pageIds = new Set(pageRows.map((page) => page.id));
  const pageExport: ExportPage[] = pageRows.map((row) => ({
    id: row.id,
    parentId: row.parentId && pageIds.has(row.parentId) ? row.parentId : null,
    projectId: row.projectId && projectKeys.has(row.projectId) ? row.projectId : null,
    title: row.title,
    icon: row.icon ?? null,
    markdownPath: docPaths.get(row.id)!,
    shared: row.shared === 1,
    shareLevel: row.shareLevel,
    position: row.position,
    createdBy: people.get(row.createdBy) ?? "",
    templateName: row.templateName ?? null,
    coverAttachmentId: row.cover ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const apiKeyRows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(asc(apiKeys.createdAt));
  const apiKeyExport: ExportApiKey[] = apiKeyRows.map((row) => ({
    name: row.name,
    scopes: parseJson<string[] | null>(row.scopes, null),
    projectKeys: parseJson<string[]>(row.projectIds, [])
      .map((id) => projectKeys.get(id))
      .filter((key): key is string => Boolean(key)),
    createdAt: row.createdAt,
    revokedAt: row.revokedAt ?? null,
    expiresAt: row.expiresAt ?? null,
  }));

  const viewRows = await db
    .select()
    .from(taskViews)
    .where(and(eq(taskViews.workspaceId, workspaceId), eq(taskViews.shared, 1)))
    .orderBy(asc(taskViews.createdAt));
  const taskViewExport: ExportTaskView[] = viewRows.map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    projectId: row.projectId ?? null,
    definition: parseJson<unknown>(row.definition, {}),
    shared: true,
    createdAt: row.createdAt,
  }));

  const ruleRows = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.workspaceId, workspaceId))
    .orderBy(asc(automationRules.createdAt));
  const automationExport: ExportAutomationRule[] = ruleRows.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    trigger: parseJson<unknown>(row.trigger, {}),
    conditions: parseJson<unknown>(row.conditions, []),
    actions: parseJson<unknown>(row.actions, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  const attachmentRows = await db
    .select({
      id: attachments.id,
      workspaceId: attachments.workspaceId,
      pageId: attachments.pageId,
      uploaderId: attachments.uploaderId,
      name: attachments.name,
      size: attachments.size,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .innerJoin(pages, eq(pages.id, attachments.pageId))
    .where(
      and(
        eq(attachments.workspaceId, workspaceId),
        eq(attachments.complete, 1),
        eq(pages.workspaceId, workspaceId),
        isNull(pages.deletedAt)
      )
    )
    .orderBy(asc(attachments.createdAt));

  const [taskCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(issues)
    .where(and(eq(issues.workspaceId, workspaceId), isNull(issues.deletedAt)));
  const [commentCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(comments)
    .innerJoin(issues, eq(issues.id, comments.issueId))
    .where(and(eq(issues.workspaceId, workspaceId), isNull(issues.deletedAt), isNull(comments.deletedAt)));
  const [pageCommentCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(pageComments)
    .where(and(eq(pageComments.workspaceId, workspaceId), isNull(pageComments.deletedAt)));

  const workspaceInfo: ExportWorkspaceInfo = {
    name: workspace.name,
    key: workspace.key,
    icon: workspace.icon ?? null,
    membersSeeAllTasks: workspace.membersSeeAllTasks === 1,
    createdAt: workspace.createdAt,
  };

  const writer = new ZipWriter(outputPath, { timestamp: new Date() });
  const attachmentManifest: ExportAttachmentManifest = {
    schemaVersion: TRANSFER_SCHEMA_VERSION,
    workspaceId,
    attachments: [],
  };
  let attachmentIncluded = 0;
  let attachmentOmitted = 0;
  let includedBytes = 0;
  let omittedBytes = 0;
  let missingFiles = 0;
  try {
    progress("Writing workspace data", 8);
    async function* workspaceJson(): AsyncGenerator<string> {
      yield `{"schemaVersion":${TRANSFER_SCHEMA_VERSION},"kind":${json(EXPORT_KIND)},"exportedAt":${json(exportedAt)}`;
      yield `,"workspace":${json(workspaceInfo)}`;
      yield `,"members":${json(members)}`;
      yield `,"projects":${json(projectExport)}`;
      yield `,"labels":${json(labelRows.map((row) => ({ id: row.id, name: row.name, color: row.color })))}`;
      yield `,"taskFields":${json(fieldRows.map((row) => ({ id: row.id, name: row.name, type: row.type, options: parseJson<string[]>(row.options, []), disabledAt: row.disabledAt ?? null })))}`;
      yield `,"issues":[`;
      let first = true;
      for await (const issue of issueRecords(workspaceId, projectKeys, people, () => {})) {
        yield `${first ? "" : ","}${json(issue)}`;
        first = false;
      }
      yield `]`;
      yield `,"comments":[`;
      first = true;
      for await (const comment of commentRecords(workspaceId, people, () => {})) {
        yield `${first ? "" : ","}${json(comment)}`;
        first = false;
      }
      yield `]`;
      yield `,"pages":${json(pageExport)}`;
      yield `,"pageComments":[`;
      first = true;
      for await (const comment of pageCommentRecords(workspaceId, people, () => {})) {
        yield `${first ? "" : ","}${json(comment)}`;
        first = false;
      }
      yield `]`;
      yield `,"apiKeys":${json(apiKeyExport)}`;
      yield `,"taskViews":${json(taskViewExport)}`;
      yield `,"automationRules":${json(automationExport)}`;
      yield `}`;
    }
    await writer.addStream(EXPORT_WORKSPACE_FILE, workspaceJson());
    progress("Writing workspace data", 25);

    // Documents: one file each, read one at a time so a 1 GB workspace never lands in RAM.
    let docIndex = 0;
    for (const page of pageRows) {
      const [row] = await db.select({ doc: pages.doc }).from(pages).where(eq(pages.id, page.id)).limit(1);
      const zipPath = docPaths.get(page.id)!;
      await writer.addBuffer(zipPath, pageMarkdown(page.title, row?.doc ?? ""));
      docIndex += 1;
      progress("Writing documents", 25 + Math.round((docIndex / Math.max(1, pageRows.length)) * 25));
    }
    if (pageRows.length === 0) progress("Writing documents", 50);

    await writer.addStream(EXPORT_TASKS_FILE, tasksCsv(workspaceId, projectKeys, projectNames, people));
    progress("Writing task CSV", 58);

    // Attachments default on with a cap; omitted files are named in the manifest.
    const totalAttachmentBytes = attachmentRows.reduce((sum, row) => sum + row.size, 0);
    for (const row of attachmentRows) {
      if (!includeAttachments || includedBytes + row.size > capBytes) {
        attachmentOmitted += 1;
        omittedBytes += row.size;
        continue;
      }
      const file = path.join(UPLOAD_DIR, row.id);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(file);
      } catch {
        missingFiles += 1;
        attachmentOmitted += 1;
        omittedBytes += row.size;
        continue;
      }
      if (!stat.isFile()) {
        missingFiles += 1;
        attachmentOmitted += 1;
        omittedBytes += row.size;
        continue;
      }
      const zipPath = attachmentZipPath(row.id, row.name);
      await writer.addStream(zipPath, fs.createReadStream(file));
      attachmentManifest.attachments.push({
        id: row.id,
        pageId: row.pageId,
        name: row.name,
        mime: mimeFor(row.name),
        size: stat.size,
        path: zipPath,
        createdAt: row.createdAt,
      });
      attachmentIncluded += 1;
      includedBytes += stat.size;
      const done = totalAttachmentBytes === 0 ? 1 : Math.min(1, includedBytes / Math.max(1, Math.min(capBytes, totalAttachmentBytes)));
      progress("Writing attachments", 60 + Math.round(done * 35));
    }
    await writer.addBuffer(
      `${EXPORT_ATTACHMENTS_DIR}/manifest.json`,
      JSON.stringify(attachmentManifest, null, 2)
    );
    if (attachmentRows.length === 0) progress("Writing attachments", 95);

    const counts: ExportManifest["counts"] = {
      members: members.length,
      projects: projectExport.length,
      labels: labelRows.length,
      taskFields: fieldRows.length,
      tasks: Number(taskCountRow?.n ?? 0),
      comments: Number(commentCountRow?.n ?? 0),
      documents: pageRows.length,
      pageComments: Number(pageCommentCountRow?.n ?? 0),
      apiKeys: apiKeyExport.length,
      attachments: attachmentIncluded,
    };
    const omittedTotal = attachmentOmitted + missingFiles;
    const attachmentSummary: ExportManifest["attachments"] = {
      included: includeAttachments,
      capBytes,
      totalBytes: totalAttachmentBytes,
      includedCount: attachmentIncluded,
      omittedCount: omittedTotal,
      omittedBytes,
    };
    const manifest: ExportManifest = {
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      kind: EXPORT_KIND,
      exportedAt,
      workspace: { id: workspace.id, name: workspace.name, key: workspace.key },
      counts,
      attachments: attachmentSummary,
      files: {
        workspace: EXPORT_WORKSPACE_FILE,
        tasks: EXPORT_TASKS_FILE,
        docs: EXPORT_DOCS_DIR,
        attachments: EXPORT_ATTACHMENTS_DIR,
      },
    };
    await writer.addBuffer(EXPORT_MANIFEST_FILE, JSON.stringify(manifest, null, 2));
    progress("Finishing archive", 98);
    const finished = await writer.finish();
    progress("Done", 100);
    const result: ExportResult = {
      bytes: finished.bytes,
      entries: finished.entries,
      fileName: path.basename(outputPath),
      counts,
      attachments: { ...attachmentSummary, omittedCount: attachmentOmitted + missingFiles },
      workspace: { id: workspace.id, name: workspace.name, key: workspace.key },
    };
    return result;
  } catch (error) {
    writer.abort();
    await fs.promises.rm(outputPath, { force: true });
    throw error;
  }
}

export function exportOutputPath(jobId: string): string {
  return path.join(DATA_DIR, "exports", `${jobId}.zip`);
}

export function newExportJobId(): string {
  return crypto.randomUUID();
}
