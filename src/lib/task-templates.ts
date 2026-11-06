// Workspace-level task templates: a reusable draft for the composer. Anyone in the
// workspace can use one; the owner or a workspace admin curates them.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { taskTemplates, workspaceMembers, workspaces } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import type { Priority } from "@/lib/constants";

export type TaskTemplate = {
  id: string;
  name: string;
  title: string;
  description: string;
  priority: Priority;
  labelNames: string[];
  fieldValues: Record<string, string>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskTemplateInput = {
  name: string;
  title: string;
  description?: string;
  priority?: Priority;
  labelNames?: string[];
  fieldValues?: Record<string, string>;
};

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
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    )
    .get();
  return member?.role === "admin";
}

export function canManageTaskTemplates(workspaceId: string, userId: string): boolean {
  return managerOf(workspaceId, userId);
}

function toTemplate(row: typeof taskTemplates.$inferSelect): TaskTemplate {
  let labelNames: string[] = [];
  let fieldValues: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.labelNames);
    if (Array.isArray(parsed)) labelNames = parsed.filter((name): name is string => typeof name === "string");
  } catch {
    // A damaged template still shows its title; the list text is just what it has.
  }
  try {
    const parsed = JSON.parse(row.fieldValues);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fieldValues = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      );
    }
  } catch {
    // ditto
  }
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    priority: row.priority as Priority,
    labelNames,
    fieldValues,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanInput(input: TaskTemplateInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!name) throw new TacosError("Enter a template name", 400);
  if (name.length > 80) throw new TacosError("Template names are at most 80 characters", 400);
  if (!title) throw new TacosError("A template needs a title", 400);
  if (title.length > 500) throw new TacosError("Title must be at most 500 characters");
  const description =
    typeof input.description === "string" ? input.description.slice(0, 20_000) : "";
  const priority = Number.isInteger(input.priority) && Number(input.priority) >= 0 && Number(input.priority) <= 4
    ? (input.priority as Priority)
    : 0;
  const labelNames = [...new Set((input.labelNames ?? []).map((label) => label.trim()).filter(Boolean))].slice(0, 20);
  const fieldValues: Record<string, string> = {};
  for (const [fieldId, value] of Object.entries(input.fieldValues ?? {})) {
    if (typeof value === "string" && fieldId.length <= 100) fieldValues[fieldId] = value.slice(0, 2000);
  }
  return { name, title, description, priority, labelNames, fieldValues };
}

export function listTaskTemplates(workspaceId: string): TaskTemplate[] {
  return getDb()
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.workspaceId, workspaceId))
    .all()
    .map(toTemplate);
}

export function createTaskTemplate(
  workspaceId: string,
  userId: string,
  input: TaskTemplateInput
): TaskTemplate {
  if (!managerOf(workspaceId, userId)) {
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  }
  const clean = cleanInput(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDb()
    .insert(taskTemplates)
    .values({
      id,
      workspaceId,
      name: clean.name,
      title: clean.title,
      description: clean.description,
      priority: clean.priority,
      labelNames: JSON.stringify(clean.labelNames),
      fieldValues: JSON.stringify(clean.fieldValues),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return listTaskTemplates(workspaceId).find((template) => template.id === id)!;
}

export function updateTaskTemplate(
  workspaceId: string,
  userId: string,
  id: string,
  input: TaskTemplateInput
): TaskTemplate {
  if (!managerOf(workspaceId, userId)) {
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  }
  const existing = getDb()
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.id, id), eq(taskTemplates.workspaceId, workspaceId)))
    .get();
  if (!existing) throw new TacosError("Template not found", 404);
  const clean = cleanInput(input);
  getDb()
    .update(taskTemplates)
    .set({
      name: clean.name,
      title: clean.title,
      description: clean.description,
      priority: clean.priority,
      labelNames: JSON.stringify(clean.labelNames),
      fieldValues: JSON.stringify(clean.fieldValues),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(taskTemplates.id, id))
    .run();
  return listTaskTemplates(workspaceId).find((template) => template.id === id)!;
}

export function deleteTaskTemplate(workspaceId: string, userId: string, id: string) {
  if (!managerOf(workspaceId, userId)) {
    throw new TacosError("Only the workspace owner or an admin can manage templates", 403);
  }
  const existing = getDb()
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.id, id), eq(taskTemplates.workspaceId, workspaceId)))
    .get();
  if (!existing) throw new TacosError("Template not found", 404);
  getDb().delete(taskTemplates).where(eq(taskTemplates.id, id)).run();
}
