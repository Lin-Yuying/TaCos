import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  attachments,
  comments,
  issues as issuesTable,
  notifications,
  pageComments,
  pages,
  projects,
  taskFields as taskFieldsTable,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import {
  addDependency,
  createIssue,
  createLabel,
  createProject,
  createWorkspace,
  deriveProjectKey,
  type MutationActor,
} from "@/lib/issues";
import { createPage, splitImportedMarkdown } from "@/lib/pages";
import { purgeWorkspaceRecords } from "@/lib/permanent-cleanup";
import { createTaskField } from "@/lib/task-fields";
import { UPLOAD_DIR } from "@/lib/attachments";
import { TacosError } from "@/lib/tacos-error";
import type { ImportCounts, ImportPlan, PlannedProject } from "@/lib/transfer/format";
import { ZipReader, type ZipSourceEntry } from "@/lib/transfer/zip";
import { importEntryMap } from "./zip-paths";

export type ImportActor = { id: string; username: string; displayName: string };

export type ImportApplied = {
  workspaceId: string;
  workspaceName: string;
  workspaceKey: string;
  counts: ImportCounts;
  warnings: string[];
};

function actorFor(user: ImportActor): MutationActor {
  return { kind: "user", userId: user.id, displayName: user.displayName };
}

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function keyBase(name: string, preferred: string | null): string {
  const source = (preferred || name).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = (source.length >= 2 ? source : `${source}WS`).slice(0, 10);
  return base.padEnd(2, "W");
}

async function uniqueWorkspaceKey(name: string, preferred: string | null): Promise<string> {
  const db = getDb();
  const rows = await db.select({ key: workspaces.key }).from(workspaces);
  const taken = new Set(rows.map((row) => row.key.toUpperCase()));
  const preferredKey = keyBase(name, preferred);
  const base = preferred
    ? preferredKey
    : deriveProjectKey(name, taken).slice(0, 10);
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    const suffix = String(n);
    key = `${base.slice(0, Math.max(2, 10 - suffix.length))}${suffix}`;
    if (key.length > 10) key = key.slice(0, 10);
  }
  return key;
}

async function memberMap(plan: ImportPlan, actor: ImportActor): Promise<Map<string, ImportActor>> {
  const usernames = new Set(plan.members.map((member) => member.username));
  for (const issue of plan.issues) {
    for (const username of issue.assignees) usernames.add(username);
    if (issue.createdBy) usernames.add(issue.createdBy);
  }
  for (const page of plan.pages) if (page.createdBy) usernames.add(page.createdBy);
  const map = new Map<string, ImportActor>();
  map.set(actor.username.toLowerCase(), actor);
  if (usernames.size === 0) return map;
  const rows = await getDb()
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users);
  for (const row of rows) {
    if (usernames.has(row.username)) map.set(row.username.toLowerCase(), row);
  }
  return map;
}

function userFor(
  username: string | null,
  map: Map<string, ImportActor>,
  fallback: ImportActor
): ImportActor {
  return (username && map.get(username.toLowerCase())) || fallback;
}

/** The owner/admin starts the workspace; the imported admin members keep their role. */
async function addMembers(plan: ImportPlan, workspaceId: string, actor: ImportActor): Promise<void> {
  const map = await memberMap(plan, actor);
  const db = getDb();
  const seen = new Set<string>([actor.id]);
  for (const member of plan.members) {
    const person = map.get(member.username.toLowerCase());
    if (!person || seen.has(person.id)) continue;
    seen.add(person.id);
    try {
      await db.insert(workspaceMembers).values({
        workspaceId,
        userId: person.id,
        role: member.role === "admin" ? "admin" : "member",
        createdAt: isoOrNull(member.createdAt) ?? new Date().toISOString(),
      });
    } catch {
      // Already a member (the importing owner can also appear in the export).
    }
  }
}

async function copyAttachments(input: {
  plan: ImportPlan;
  reader: ZipReader;
  workspaceId: string;
  actor: ImportActor;
  pageIdByExternal: Map<string, string>;
  pageDoc: Map<string, string>;
  onProgress: (progress: number) => void;
}): Promise<{ copied: number; omitted: number }> {
  const db = getDb();
  const entries = importEntryMap(input.reader.list());
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  let copied = 0;
  let omitted = 0;
  let index = 0;
  for (const item of input.plan.attachments) {
    index += 1;
    const pageId = input.pageIdByExternal.get(item.pageExternalId);
    const entry = entries.get(item.zipPath.replace(/\\/g, "/"));
    if (!pageId || !entry) {
      omitted += 1;
      continue;
    }
    const id = crypto.randomUUID();
    const dest = path.join(UPLOAD_DIR, id);
    try {
      await pipeline(Readable.from(input.reader.stream(entry)), fs.createWriteStream(dest));
      await db.insert(attachments).values({
        id,
        workspaceId: input.workspaceId,
        pageId,
        uploaderId: input.actor.id,
        name: item.name.slice(0, 200) || entry.name.split("/").pop() || "file",
        size: entry.uncompressedSize,
        complete: 1,
        createdAt: isoOrNull(item.createdAt) ?? new Date().toISOString(),
      });
    } catch {
      await fs.promises.rm(dest, { force: true });
      omitted += 1;
      continue;
    }
    copied += 1;
    if (item.cover) {
      await db.update(pages).set({ cover: id }).where(eq(pages.id, pageId));
    }
    // Rewrite the links that pointed at this file, so images open inside TaCos.
    const replacements: Array<{ from: string; to: string }> = item.links.map((link) => ({
      from: link,
      to: `/api/files/${id}`,
    }));
    replacements.push({ from: `/api/files/${item.externalId}`, to: `/api/files/${id}` });
    const doc = input.pageDoc.get(item.pageExternalId);
    if (doc) {
      let next = doc;
      for (const replacement of replacements) {
        if (replacement.from) next = next.split(replacement.from).join(replacement.to);
      }
      if (next !== doc) {
        input.pageDoc.set(item.pageExternalId, next);
        await db.update(pages).set({ doc: next }).where(eq(pages.id, pageId));
      }
    }
    input.onProgress(Math.round((index / Math.max(1, input.plan.attachments.length)) * 100));
  }
  return { copied, omitted };
}

/**
 * Materializes a plan into a brand-new workspace. The row is created hidden
 * (`deleted_at` set) so a member never sees a half-imported team; the caller clears
 * that on success and rolls the whole workspace back on failure.
 */
export async function applyImportPlan(input: {
  plan: ImportPlan;
  sourcePath: string;
  actor: ImportActor;
  onWorkspaceCreated?: (workspaceId: string) => void | Promise<void>;
  onProgress?: (phase: string, progress: number) => void;
}): Promise<ImportApplied> {
  const { plan, actor } = input;
  const progress = (phase: string, percent: number) =>
    input.onProgress?.(phase, Math.max(0, Math.min(100, percent)));
  if (plan.projects.length === 0 && plan.issues.length === 0 && plan.pages.length === 0) {
    throw new TacosError("Nothing to import: the source has no tasks, documents or projects", 400);
  }
  const db = getDb();
  const name = plan.workspaceName.trim().slice(0, 120) || "Imported workspace";
  const key = await uniqueWorkspaceKey(name, plan.workspaceKey);
  const warnings = [...plan.warnings];
  let workspaceId: string | null = null;
  try {
    progress("Creating workspace", 2);
    const createdWorkspace = await createWorkspace({ name, key, adminUserId: actor.id });
    workspaceId = createdWorkspace.id;
    // Hide it until the last row lands. requireWorkspace and the switcher filter this.
    await db
      .update(workspaces)
      .set({
        deletedAt: new Date().toISOString(),
        deletedBy: actor.id,
        icon: plan.workspaceIcon,
        membersSeeAllTasks: plan.workspaceMembersSeeAllTasks ? 1 : 0,
      })
      .where(eq(workspaces.id, workspaceId));
    await input.onWorkspaceCreated?.(workspaceId);
    await addMembers(plan, workspaceId, actor);
    const members = await memberMap(plan, actor);
    const mutationActor = actorFor(actor);

    progress("Creating projects", 5);
    const projectIdByExternal = new Map<string, string>();
    const projectKeyById = new Map<string, string>();
    for (const project of plan.projects) {
      const creator = userFor(project.createdBy, members, actor);
      const created = await createProjectForImport(workspaceId, project, creator.id);
      projectIdByExternal.set(project.externalId, created.id);
      projectKeyById.set(created.id, created.key);
    }
    const fallbackProject = plan.projects[0] ? projectIdByExternal.get(plan.projects[0].externalId) : undefined;
    if (plan.issues.length > 0 && !fallbackProject) {
      throw new TacosError("The import has tasks but no project to put them in", 400);
    }

    progress("Creating task fields", 8);
    const fieldIdByName = new Map<string, string>();
    for (const field of plan.taskFields) {
      try {
        const created = await createTaskField(workspaceId, actor.id, {
          name: field.name,
          type: field.type,
          options: field.options,
        });
        fieldIdByName.set(field.name.toLowerCase(), created.id);
        if (field.disabledAt) {
          await db.update(taskFieldsTable).set({ disabledAt: field.disabledAt }).where(eq(taskFieldsTable.id, created.id));
        }
      } catch (error) {
        warnings.push(`Field "${field.name}" was skipped: ${error instanceof Error ? error.message : "invalid field"}`);
      }
    }

    progress("Creating labels", 10);
    for (const label of plan.labels) {
      try {
        await createLabel(workspaceId, { name: label.name, color: label.color });
      } catch {
        // A label with the same name already exists; createIssue reuses it.
      }
    }

    progress("Creating tasks", 14);
    const issueByExternal = new Map<string, { id: string; identifier: string }>();
    const pending = [...plan.issues];
    const knownIssues = new Set(pending.map((issue) => issue.externalId));
    let processed = 0;
    while (pending.length > 0) {
      let index = pending.findIndex(
        (issue) =>
          !issue.parentExternalId ||
          issueByExternal.has(issue.parentExternalId) ||
          !knownIssues.has(issue.parentExternalId)
      );
      if (index < 0) {
        index = 0;
        warnings.push(`Task "${pending[0].title}" has a parent loop; it was imported as a top-level task.`);
      }
      const issue = pending.splice(index, 1)[0];
      const projectId = projectIdByExternal.get(issue.projectExternalId) ?? fallbackProject;
      const projectKey = projectId ? projectKeyById.get(projectId) : undefined;
      if (!projectKey) {
        warnings.push(`Task "${issue.title}" was skipped because its project is missing.`);
        continue;
      }
      const creator = userFor(issue.createdBy, members, actor);
      const assigneeIds = [
        ...new Set(
          issue.assignees
            .map((username) => members.get(username.toLowerCase())?.id)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const fieldValues: Record<string, string> = {};
      for (const [fieldName, value] of Object.entries(issue.fieldValues)) {
        const fieldId = fieldIdByName.get(fieldName.toLowerCase());
        if (fieldId) fieldValues[fieldId] = value;
      }
      try {
        const detail = await createIssue(
          workspaceId,
          {
            title: issue.title,
            description: issue.description,
            status: issue.status as never,
            priority: issue.priority as never,
            project: projectKey,
            parent: issue.parentExternalId ? issueByExternal.get(issue.parentExternalId)?.identifier ?? null : null,
            assigneeIds,
            labelNames: issue.labels,
            dueDate: issue.dueDate,
            estimate: issue.estimate,
            recurrence: issue.recurrence as never,
            fieldValues,
          },
          actorFor(creator)
        );
        issueByExternal.set(issue.externalId, { id: detail.issue.id, identifier: detail.issue.identifier });
        const created = isoOrNull(issue.createdAt);
        const updated = isoOrNull(issue.updatedAt);
        if (created || updated) {
          await db
            .update(issuesTable)
            .set({
              ...(created ? { createdAt: created } : {}),
              ...(updated ? { updatedAt: updated } : {}),
            })
            .where(eq(issuesTable.id, detail.issue.id));
        }
      } catch (error) {
        throw new TacosError(
          `Task "${issue.title}" could not be imported (${error instanceof Error ? error.message : "invalid task"}). The workspace was rolled back.`,
          400
        );
      }
      processed += 1;
      if (processed % 10 === 0) {
        progress("Creating tasks", 14 + Math.round((processed / Math.max(1, plan.issues.length)) * 36));
      }
    }

    progress("Creating task links", 52);
    for (const issue of plan.issues) {
      const source = issueByExternal.get(issue.externalId);
      if (!source) continue;
      for (const blockedById of issue.blockedBy) {
        const blocker = issueByExternal.get(blockedById);
        if (!blocker) continue;
        try {
          await addDependency(workspaceId, source.identifier, blocker.identifier, actor.id, mutationActor);
        } catch (error) {
          throw new TacosError(
            `Dependency ${source.identifier} → ${blocker.identifier} could not be imported (${error instanceof Error ? error.message : "invalid dependency"}). The workspace was rolled back.`,
            400
          );
        }
      }
    }

    progress("Writing comments", 56);
    await importTaskComments(plan, workspaceId, issueByExternal, members, actor, (done) => {
      progress("Writing comments", 56 + Math.round((done / Math.max(1, plan.comments.length)) * 8));
    });

    progress("Creating documents", 66);
    const pageIdByExternal = new Map<string, string>();
    const pageDoc = new Map<string, string>();
    let copied = { copied: 0, omitted: 0 };
    const reader = await ZipReader.open(input.sourcePath);
    try {
      const pendingPages = [...plan.pages];
      const knownPages = new Set(pendingPages.map((page) => page.externalId));
      let pageIndex = 0;
      while (pendingPages.length > 0) {
        let index = pendingPages.findIndex(
          (page) => !page.parentExternalId || pageIdByExternal.has(page.parentExternalId) || !knownPages.has(page.parentExternalId)
        );
        if (index < 0) {
          index = 0;
          warnings.push(`Document "${pendingPages[0].title}" has a parent loop; it was imported at the top level.`);
        }
        const page = pendingPages.splice(index, 1)[0];
        let doc = page.doc ?? "";
        if (page.doc === null && page.markdownPath) {
          const entry = reader.list().find((candidate) => !candidate.directory && candidate.name.replace(/\\/g, "/") === page.markdownPath);
          if (!entry) {
            warnings.push(`Document "${page.title}" was skipped because its Markdown file is missing.`);
            continue;
          }
          const content = (await reader.read(entry, 8 * 1024 * 1024)).toString("utf8");
          doc = splitImportedMarkdown(page.title, content).doc;
        }
        const creator = userFor(page.createdBy, members, actor);
        try {
          const created = await createPage(
            workspaceId,
            actor.id,
            {
              parentId: page.parentExternalId ? pageIdByExternal.get(page.parentExternalId) ?? null : null,
              projectId: page.projectExternalId ? projectIdByExternal.get(page.projectExternalId) ?? null : null,
              title: page.title,
              doc,
            },
            { via: "web" }
          );
          pageIdByExternal.set(page.externalId, created.id);
          pageDoc.set(page.externalId, doc);
          const createdAt = isoOrNull(page.createdAt);
          const updatedAt = isoOrNull(page.updatedAt);
          await db
            .update(pages)
            .set({
              icon: page.icon,
              shared: page.shared ? 1 : 0,
              shareLevel: page.shareLevel,
              position: page.position,
              templateName: page.templateName,
              createdBy: creator.id,
              ...(createdAt ? { createdAt } : {}),
              ...(updatedAt ? { updatedAt } : {}),
            })
            .where(eq(pages.id, created.id));
        } catch (error) {
          throw new TacosError(
            `Document "${page.title}" could not be imported (${error instanceof Error ? error.message : "invalid document"}). The workspace was rolled back.`,
            400
          );
        }
        pageIndex += 1;
        if (pageIndex % 10 === 0) {
          progress("Creating documents", 66 + Math.round((pageIndex / Math.max(1, plan.pages.length)) * 12));
        }
      }

      progress("Copying attachments", 80);
      copied = await copyAttachments({
        plan,
        reader,
        workspaceId,
        actor,
        pageIdByExternal,
        pageDoc,
        onProgress: (percent) => progress("Copying attachments", 80 + Math.round(percent * 0.12)),
      });
      if (copied.omitted > 0) warnings.push(`${copied.omitted} attachments could not be copied and were skipped.`);

      progress("Writing document comments", 93);
      await importPageComments(plan, workspaceId, pageIdByExternal, members, actor);
    } finally {
      await reader.close();
    }

    // Importing history must not look like a fresh conversation in anyone's Inbox.
    await db.delete(notifications).where(eq(notifications.workspaceId, workspaceId));

    progress("Finishing", 97);
    await db
      .update(workspaces)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(workspaces.id, workspaceId));

    return {
      workspaceId,
      workspaceName: name,
      workspaceKey: key,
      counts: {
        members: plan.members.length,
        matchedMembers: plan.counts.matchedMembers,
        projects: plan.projects.length,
        labels: plan.labels.length,
        taskFields: plan.taskFields.length,
        tasks: issueByExternal.size,
        comments: plan.comments.length,
        documents: pageIdByExternal.size,
        pageComments: plan.pageComments.length,
        attachments: copied.copied,
        attachmentBytes: plan.counts.attachmentBytes,
      },
      warnings: [...new Set(warnings)],
    };
  } catch (error) {
    if (workspaceId) {
      await rollbackImportedWorkspace(workspaceId).catch((rollbackError) => {
        console.error("Import rollback failed:", rollbackError);
      });
    }
    throw error;
  }
}

// The workspace and its data are deleted through the same purge path used by the
// recycle bin. Backdating makes an unfinished import eligible immediately.
export async function rollbackImportedWorkspace(workspaceId: string): Promise<void> {
  const db = getDb();
  const [workspace] = await db
    .select({ id: workspaces.id, deletedBy: workspaces.deletedBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return;
  const past = new Date(Date.now() - 31 * 86_400_000).toISOString();
  await db
    .update(workspaces)
    .set({ deletedAt: past, deletedBy: workspace.deletedBy ?? "import" })
    .where(eq(workspaces.id, workspaceId));
  await purgeWorkspaceRecords(workspaceId);
}

async function importTaskComments(
  plan: ImportPlan,
  workspaceId: string,
  issueByExternal: Map<string, { id: string; identifier: string }>,
  members: Map<string, ImportActor>,
  actor: ImportActor,
  tick: (done: number) => void
): Promise<void> {
  const db = getDb();
  const commentIdByExternal = new Map<string, string>();
  const pending = [...plan.comments];
  let done = 0;
  while (pending.length > 0) {
    let index = pending.findIndex(
      (comment) => !comment.parentExternalId || commentIdByExternal.has(comment.parentExternalId)
    );
    if (index < 0) index = 0;
    const comment = pending.splice(index, 1)[0];
    const issue = issueByExternal.get(comment.issueExternalId);
    if (!issue) continue;
    const author = comment.agentAuthor ? null : userFor(comment.author, members, actor);
    const id = crypto.randomUUID();
    await db.insert(comments).values({
      id,
      issueId: issue.id,
      authorId: author?.id ?? null,
      agentAuthor: comment.agentAuthor,
      body: comment.body,
      parentId: comment.parentExternalId ? commentIdByExternal.get(comment.parentExternalId) ?? null : null,
      editedAt: isoOrNull(comment.editedAt),
      resolvedAt: isoOrNull(comment.resolvedAt),
      reviewState: comment.reviewState,
      via: comment.via === "api" || comment.via === "mcp" ? comment.via : "you",
      createdAt: isoOrNull(comment.createdAt) ?? new Date().toISOString(),
    });
    commentIdByExternal.set(comment.externalId, id);
    done += 1;
    if (done % 25 === 0) tick(done);
  }
  tick(done);
}

async function importPageComments(
  plan: ImportPlan,
  workspaceId: string,
  pageIdByExternal: Map<string, string>,
  members: Map<string, ImportActor>,
  actor: ImportActor
): Promise<void> {
  const db = getDb();
  const byExternal = new Map<string, string>();
  const pending = [...plan.pageComments];
  while (pending.length > 0) {
    let index = pending.findIndex(
      (comment) => !comment.parentExternalId || byExternal.has(comment.parentExternalId)
    );
    if (index < 0) index = 0;
    const comment = pending.splice(index, 1)[0];
    const pageId = pageIdByExternal.get(comment.pageExternalId);
    if (!pageId) continue;
    const author = userFor(comment.author, members, actor);
    const id = crypto.randomUUID();
    await db.insert(pageComments).values({
      id,
      pageId,
      workspaceId,
      authorId: author.id,
      body: comment.body,
      quote: comment.quote,
      prefix: "",
      suffix: "",
      via: comment.via === "api" || comment.via === "mcp" ? comment.via : "you",
      resolvedAt: isoOrNull(comment.resolvedAt),
      editedAt: isoOrNull(comment.editedAt),
      createdAt: isoOrNull(comment.createdAt) ?? new Date().toISOString(),
    });
    byExternal.set(comment.externalId, id);
  }
}

async function createProjectForImport(
  workspaceId: string,
  project: PlannedProject,
  creatorId: string
): Promise<{ id: string; key: string }> {
  const created = await createProject({
    workspaceId,
    name: project.name,
    description: project.description,
    createdBy: creatorId,
  });
  const db = getDb();
  const preferred = project.key?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || created.key;
  const siblings = await db
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  const duplicateKey = siblings.some(
    (row) => row.id !== created.id && row.key.toUpperCase() === preferred.toUpperCase()
  );
  await db
    .update(projects)
    .set({
      key: duplicateKey ? created.key : preferred,
      ...(project.color && /^#[0-9a-fA-F]{6}$/.test(project.color) ? { color: project.color } : {}),
      icon: project.icon,
      doc: project.doc,
      createdBy: creatorId,
    })
    .where(eq(projects.id, created.id));
  return { id: created.id, key: duplicateKey ? created.key : preferred };
}
