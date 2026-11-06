// Workspace-level page templates: a saved title and Markdown body a new document can
// start from. Anyone in the workspace may use one; the owner or an admin curates them.
// A page keeps the template's name as a snapshot, so deleting the template changes
// nothing for documents already created from it.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { pageTemplates, workspaceMembers, workspaces } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import { getProject, nowIso } from "@/lib/issues";
import { createPage, getPage, pageAuthor, type DocPage } from "@/lib/pages";

export type PageTemplate = {
  id: string;
  name: string;
  title: string;
  doc: string;
  icon: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PageTemplateInput = {
  name: string;
  title: string;
  doc: string;
  icon?: string | null;
};

export type TemplateVariables = { date: string; author: string; project: string };

const TEMPLATE_NAME_MAX = 80;
const TEMPLATE_TITLE_MAX = 120;
const TEMPLATE_DOC_MAX = 100_000;

function managerOf(workspaceId: string, userId: string): boolean {
  const db = getDb();
  const workspace = db
    .select({ createdBy: workspaces.createdBy })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (workspace?.createdBy === userId) return true;
  const member = db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .get();
  return member?.role === "admin";
}

export function canManagePageTemplates(workspaceId: string, userId: string): boolean {
  return managerOf(workspaceId, userId);
}

function toTemplate(row: typeof pageTemplates.$inferSelect): PageTemplate {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    doc: row.doc,
    icon: row.icon,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanInput(input: PageTemplateInput): PageTemplateInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const doc = typeof input.doc === "string" ? input.doc : "";
  if (!name) throw new TacosError("Enter a template name", 400);
  if (name.length > TEMPLATE_NAME_MAX)
    throw new TacosError(`Template names are at most ${TEMPLATE_NAME_MAX} characters`, 400);
  if (!title) throw new TacosError("A template needs a page title", 400);
  if (title.length > TEMPLATE_TITLE_MAX)
    throw new TacosError(`Template titles are at most ${TEMPLATE_TITLE_MAX} characters`, 400);
  if (doc.length > TEMPLATE_DOC_MAX)
    throw new TacosError(`Template text is at most ${TEMPLATE_DOC_MAX.toLocaleString("en-US")} characters`, 400);
  const icon = (input.icon ?? "").trim();
  if (icon.length > 8) throw new TacosError("Pick a single emoji as the template icon", 400);
  return { name, title, doc, icon: icon || null };
}

export function listPageTemplates(workspaceId: string): PageTemplate[] {
  return getDb()
    .select()
    .from(pageTemplates)
    .where(eq(pageTemplates.workspaceId, workspaceId))
    .orderBy(pageTemplates.name)
    .all()
    .map(toTemplate);
}

export function createPageTemplate(
  workspaceId: string,
  userId: string,
  input: PageTemplateInput
): PageTemplate {
  if (!managerOf(workspaceId, userId))
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  const clean = cleanInput(input);
  const id = crypto.randomUUID();
  const at = nowIso();
  getDb()
    .insert(pageTemplates)
    .values({
      id,
      workspaceId,
      name: clean.name,
      title: clean.title,
      doc: clean.doc ?? "",
      icon: clean.icon ?? null,
      createdBy: userId,
      createdAt: at,
      updatedAt: at,
    })
    .run();
  return listPageTemplates(workspaceId).find((template) => template.id === id)!;
}

export function updatePageTemplate(
  workspaceId: string,
  userId: string,
  id: string,
  input: PageTemplateInput
): PageTemplate {
  if (!managerOf(workspaceId, userId))
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  const existing = getDb()
    .select({ id: pageTemplates.id })
    .from(pageTemplates)
    .where(and(eq(pageTemplates.id, id), eq(pageTemplates.workspaceId, workspaceId)))
    .get();
  if (!existing) throw new TacosError("Template not found", 404);
  const clean = cleanInput(input);
  getDb()
    .update(pageTemplates)
    .set({
      name: clean.name,
      title: clean.title,
      doc: clean.doc ?? "",
      icon: clean.icon ?? null,
      updatedAt: nowIso(),
    })
    .where(and(eq(pageTemplates.id, id), eq(pageTemplates.workspaceId, workspaceId)))
    .run();
  return listPageTemplates(workspaceId).find((template) => template.id === id)!;
}

export function deletePageTemplate(workspaceId: string, userId: string, id: string): void {
  if (!managerOf(workspaceId, userId))
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  const existing = getDb()
    .select({ id: pageTemplates.id })
    .from(pageTemplates)
    .where(and(eq(pageTemplates.id, id), eq(pageTemplates.workspaceId, workspaceId)))
    .get();
  if (!existing) throw new TacosError("Template not found", 404);
  getDb()
    .delete(pageTemplates)
    .where(and(eq(pageTemplates.id, id), eq(pageTemplates.workspaceId, workspaceId)))
    .run();
}

/**
 * The three variables a template can rely on. A project-scoped page fills `project`;
 * outside a project it becomes empty, so a template still creates a valid page.
 * Unknown placeholders stay as written instead of guessing a value.
 */
export function fillPageTemplate(text: string, variables: TemplateVariables): string {
  return text.replace(/\{(date|author|project)\}/g, (_whole, key: keyof TemplateVariables) => variables[key]);
}

export async function createPageFromTemplate(
  workspaceId: string,
  viewerId: string,
  templateId: string,
  options: { parentId?: string | null; projectId?: string | null } = {}
): Promise<DocPage> {
  const template = getDb()
    .select()
    .from(pageTemplates)
    .where(and(eq(pageTemplates.id, templateId), eq(pageTemplates.workspaceId, workspaceId)))
    .get();
  if (!template) throw new TacosError("Template not found", 404);

  const parentId = options.parentId ?? null;
  const parent = parentId ? await getPage(workspaceId, parentId, viewerId) : null;
  if (parentId && !parent) throw new TacosError("Parent page not found", 404);
  const projectId = parent ? parent.projectId : options.projectId ?? null;
  const project = projectId ? await getProject(workspaceId, projectId) : null;
  if (projectId && !project) throw new TacosError("Project not found", 404);
  const author = await pageAuthor(viewerId);
  const variables: TemplateVariables = {
    date: new Date().toISOString().slice(0, 10),
    author: author?.displayName ?? "",
    project: project?.name ?? "",
  };

  return createPage(workspaceId, viewerId, {
    parentId,
    projectId,
    title: fillPageTemplate(template.title, variables).trim().slice(0, TEMPLATE_TITLE_MAX),
    doc: fillPageTemplate(template.doc, variables),
    template: { id: template.id, name: template.name },
  });
}
