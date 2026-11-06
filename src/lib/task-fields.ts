import { and, eq, inArray, isNull, count } from "drizzle-orm";
import { getDb } from "../db/client";
import { taskFieldValues, taskFields, workspaceMembers } from "../db/schema";
import { getIssueDetail, recordEvent, type MutationActor } from "./issues";
import { TacosError } from "./tacos-error";
import {
  FIELD_TYPES,
  normalizeFieldValue,
  type FieldType,
  type FieldValues,
  type TaskField,
} from "./task-view";

const MAX_FIELDS = 30;
const MAX_OPTIONS = 50;

type Row = typeof taskFields.$inferSelect;

function toField(row: Row): TaskField {
  return {
    id: row.id,
    name: row.name,
    type: row.type as FieldType,
    options: JSON.parse(row.options) as string[],
    createdBy: row.createdBy,
    disabledAt: row.disabledAt,
  };
}

function cleanOptions(options: string[] | undefined): string[] {
  const out: string[] = [];
  for (const option of options ?? []) {
    const value = option.trim().slice(0, 60);
    if (value && !out.includes(value)) out.push(value);
  }
  return out.slice(0, MAX_OPTIONS);
}

export async function listTaskFields(workspaceId: string, includeDisabled = false): Promise<TaskField[]> {
  const rows = await getDb()
    .select()
    .from(taskFields)
    .where(and(eq(taskFields.workspaceId, workspaceId), includeDisabled ? undefined : isNull(taskFields.disabledAt)))
    .orderBy(taskFields.createdAt);
  return rows.map(toField);
}

export async function createTaskField(
  workspaceId: string,
  viewerId: string,
  input: { name: string; type: string; options?: string[] }
): Promise<TaskField> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new TacosError("A field needs a name", 400);
  if (!(FIELD_TYPES as readonly string[]).includes(input.type)) throw new TacosError("Unknown field type", 400);
  const existing = await listTaskFields(workspaceId);
  if (existing.length >= MAX_FIELDS) throw new TacosError("This workspace has too many fields", 409);
  if (existing.some((field) => field.name.toLowerCase() === name.toLowerCase())) {
    throw new TacosError("A field with that name already exists", 409);
  }
  const options = input.type === "select" ? cleanOptions(input.options) : [];
  if (input.type === "select" && !options.length) throw new TacosError("A select field needs options", 400);
  const row = {
    id: crypto.randomUUID(),
    workspaceId,
    name,
    type: input.type,
    options: JSON.stringify(options),
    createdBy: viewerId,
    createdAt: new Date().toISOString(),
    disabledAt: null,
  };
  await getDb().insert(taskFields).values(row);
  return toField(row);
}

async function findField(workspaceId: string, fieldId: string): Promise<TaskField> {
  const [row] = await getDb()
    .select()
    .from(taskFields)
    .where(and(eq(taskFields.workspaceId, workspaceId), eq(taskFields.id, fieldId)))
    .limit(1);
  if (!row) throw new TacosError("Field not found", 404);
  return toField(row);
}

/** Its creator or a workspace admin; anyone may add one, so anyone's data is not at stake on a whim. */
export async function deleteTaskField(workspaceId: string, viewerId: string, fieldId: string): Promise<void> {
  const field = await findField(workspaceId, fieldId);
  const db = getDb();
  if (field.createdBy !== viewerId) {
    const [member] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, viewerId)))
      .limit(1);
    if (member?.role !== "admin") throw new TacosError("Only its creator or an admin can delete a field", 403);
  }
  await db.update(taskFields).set({disabledAt: new Date().toISOString()}).where(eq(taskFields.id, fieldId));
}

export async function listFieldValues(issueIds: string[]): Promise<FieldValues> {
  if (!issueIds.length) return {};
  const rows = await getDb().select({issueId:taskFieldValues.issueId, fieldId:taskFieldValues.fieldId, value:taskFieldValues.value}).from(taskFieldValues)
    .innerJoin(taskFields, eq(taskFields.id, taskFieldValues.fieldId))
    .where(and(inArray(taskFieldValues.issueId, issueIds), isNull(taskFields.disabledAt)));
  const out: FieldValues = {};
  for (const row of rows) (out[row.issueId] ??= {})[row.fieldId] = row.value;
  return out;
}

export async function setTaskFieldValue(
  workspaceId: string,
  issueId: string,
  fieldId: string,
  raw: string | null,
  viewerId: string,
  actor: MutationActor
): Promise<string | null> {
  const field = await findField(workspaceId, fieldId);
  if (field.disabledAt) throw new TacosError("This field is disabled. Restore it before editing.", 409);
  const detail = await getIssueDetail(workspaceId, issueId, viewerId);
  if (!detail) throw new TacosError("Issue not found", 404);
  const id = detail.issue.id;
  const value = normalizeFieldValue(field, raw);
  const db = getDb();
  const where = and(eq(taskFieldValues.issueId, id), eq(taskFieldValues.fieldId, fieldId));
  const [old] = await db.select({ value: taskFieldValues.value }).from(taskFieldValues).where(where).limit(1);
  if ((old?.value ?? null) === value) return value;
  if (value === null) {
    await db.delete(taskFieldValues).where(where);
  } else {
    await db
      .insert(taskFieldValues)
      .values({ issueId: id, fieldId, value })
      .onConflictDoUpdate({ target: [taskFieldValues.issueId, taskFieldValues.fieldId], set: { value } });
  }
  await recordEvent(id, "field_changed", { field: field.name, from: old?.value ?? null, to: value }, actor);
  return value;
}

export async function taskFieldImpact(workspaceId: string, fieldId: string): Promise<number> {
  await findField(workspaceId,fieldId);
  return getDb().select({value:count()}).from(taskFieldValues).where(eq(taskFieldValues.fieldId,fieldId)).get()?.value ?? 0;
}

export async function restoreTaskField(workspaceId: string, viewerId: string, fieldId: string): Promise<void> {
  const field = await findField(workspaceId,fieldId);
  const member = getDb().select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,viewerId))).get();
  if(field.createdBy !== viewerId && member?.role !== "admin") throw new TacosError("Only its creator or an admin can restore a field",403);
  await getDb().update(taskFields).set({disabledAt:null}).where(eq(taskFields.id,fieldId));
}

export async function updateTaskField(workspaceId:string,viewerId:string,fieldId:string,input:{name:string;options?:string[]}):Promise<TaskField>{
 const field=await findField(workspaceId,fieldId),db=getDb();const member=db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId,workspaceId),eq(workspaceMembers.userId,viewerId))).get();
 if(field.createdBy!==viewerId&&member?.role!=="admin")throw new TacosError("Only its creator or an admin can edit a field",403);
 const name=input.name.trim();if(!name||name.length>60)throw new TacosError("Enter a field name between 1 and 60 characters",400);
 if((await listTaskFields(workspaceId,true)).some(other=>other.id!==fieldId&&other.name.toLowerCase()===name.toLowerCase()))throw new TacosError("A field with that name already exists",409);
 const options=field.type==="select"?cleanOptions(input.options??field.options):[];if(field.type==="select"&&!options.length)throw new TacosError("A select field needs options",400);
 // Old option values remain stored and readable even when no longer offered for new edits.
 await db.update(taskFields).set({name,options:JSON.stringify(options)}).where(eq(taskFields.id,fieldId));return findField(workspaceId,fieldId);
}
