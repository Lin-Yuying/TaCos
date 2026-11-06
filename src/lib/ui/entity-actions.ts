export type EntityKind = "task" | "document" | "project";
export type EntityRef = { kind: EntityKind; id: string; title: string };
export type PersonalPin = EntityRef & { href: string; position: number; pinnedAt: string };
export type EntityCapabilities = { rename: boolean; remove: boolean; favorite: boolean; isFavorite: boolean };
export const PERSONAL_STATE_CHANGED = "tacos:personal-state";
export const ENTITY_RENAMED = "tacos:entity-renamed";
export function entityHref(workspaceId: string, entity: Pick<EntityRef, "kind" | "id">) {
  const ws = encodeURIComponent(workspaceId), id = encodeURIComponent(entity.id);
  return entity.kind === "task" ? `/${ws}?issue=${id}` : `/${ws}/${entity.kind === "document" ? "docs" : "projects"}/${id}`;
}
