"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import { inspectEntity, listPersonalPins, setPersonalPin } from "@/lib/personal-entities";
import { updateIssue, updateProject, TacosError } from "@/lib/issues";
import { updatePage } from "@/lib/pages";
import type { EntityKind } from "@/lib/ui/entity-actions";
import type { ActionResult } from "./actions";
async function run<T>(work: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, data: await work() }; } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" }; }
}
export async function inspectEntityAction(ws: string, kind: EntityKind, id: string) {
  return run(async () => { const { user } = await requireWorkspace(ws); return inspectEntity(ws, user.id, kind, id); });
}
export async function listPinsAction(ws: string) {
  return run(async () => { const { user } = await requireWorkspace(ws); return listPersonalPins(ws, user.id); });
}
export async function setPinAction(ws: string, kind: EntityKind, id: string, pinned: boolean) {
  return run(async () => { const { user } = await requireWorkspace(ws); await setPersonalPin(ws, user.id, kind, id, pinned); return listPersonalPins(ws, user.id); });
}
export async function renameEntityAction(ws: string, kind: EntityKind, id: string, title: string, expected: string) {
  return run(async () => {
    const { user } = await requireWorkspace(ws);
    const current = await inspectEntity(ws, user.id, kind, id);
    if (!current.capabilities.rename) throw new TacosError("You cannot rename this item", 403);
    if (current.title !== expected) throw new TacosError("The name changed elsewhere. Cancel to load the current name, or retry after reviewing it.", 409);
    if (kind === "document") return (await updatePage(ws, id, user.id, {title})).title;
    if (kind === "project") return (await updateProject(ws, id, {name: title}, user.id)).name;
    return (await updateIssue(ws, id, {title}, {kind:"user", userId:user.id, displayName:user.displayName})).issue.title;
  }).then((result) => { if (result.ok) revalidatePath(`/${ws}`, "layout"); return result; });
}
