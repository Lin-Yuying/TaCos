import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { personalEntityState, workspaces } from "@/db/schema";
import { getIssueDetail, getOverviewAccess, getProject, listFavoriteProjects, TacosError } from "@/lib/issues";
import { getPage, pageLevel, isPageFavorite } from "@/lib/pages";
import { entityHref, type EntityKind, type EntityCapabilities, type PersonalPin } from "@/lib/ui/entity-actions";

export async function inspectEntity(ws: string, user: string, kind: EntityKind, id: string): Promise<{ title: string; capabilities: EntityCapabilities }> {
  if (kind === "document") {
    const page = await getPage(ws, id, user);
    if (!page) throw new TacosError("Document not found", 404);
    return { title: page.title, capabilities: { rename: await pageLevel(page, user) === "edit", remove: page.createdBy === user, favorite: true, isFavorite: await isPageFavorite(id, user) } };
  }
  if (kind === "project") {
    const project = await getProject(ws, id);
    if (!project) throw new TacosError("Project not found", 404);
    const access = await getOverviewAccess(ws, id, user);
    return { title: project.name, capabilities: { rename: access.canEdit, remove: project.createdBy === user || getDb().select().from(workspaces).where(eq(workspaces.id, ws)).get()?.createdBy === user, favorite: true, isFavorite: (await listFavoriteProjects(ws, user)).some((p) => p.id === id) } };
  }
  if (kind !== "task") throw new TacosError("Unknown object type", 400);
  const detail = await getIssueDetail(ws, id, user);
  if (!detail) throw new TacosError("Task not found", 404);
  return { title: detail.issue.title, capabilities: { rename: true, remove: true, favorite: false, isFavorite: false } };
}

export async function listPersonalPins(ws: string, user: string): Promise<PersonalPin[]> {
  const rows = getDb().select().from(personalEntityState).where(and(eq(personalEntityState.workspaceId, ws), eq(personalEntityState.userId, user), isNotNull(personalEntityState.pinnedAt))).orderBy(personalEntityState.position).all();
  const out: PersonalPin[] = [];
  for (const row of rows) {
    try {
      const kind = row.entityType as EntityKind;
      const { title } = await inspectEntity(ws, user, kind, row.entityId);
      out.push({ kind, id: row.entityId, title, href: entityHref(ws, {kind, id: row.entityId}), position: row.position, pinnedAt: row.pinnedAt! });
    } catch (err) { if (!(err instanceof TacosError) || ![403,404].includes(err.status)) throw err; }
  }
  return out;
}
export async function setPersonalPin(ws: string, user: string, kind: EntityKind, id: string, pinned: boolean) {
  await inspectEntity(ws, user, kind, id);
  const key = { userId: user, workspaceId: ws, entityType: kind, entityId: id };
  const now = pinned ? new Date().toISOString() : null;
  getDb().insert(personalEntityState).values({ ...key, pinnedAt: now, position: Date.now() }).onConflictDoUpdate({ target: [personalEntityState.userId, personalEntityState.workspaceId, personalEntityState.entityType, personalEntityState.entityId], set: { pinnedAt: now } }).run();
}
