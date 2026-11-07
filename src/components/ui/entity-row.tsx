"use client";
import { MoveDocument } from "./move-document";
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useParams } from "next/navigation";
import * as Context from "@radix-ui/react-context-menu";
import { MoreHorizontal, Pin } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { usePins, useUIActions } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import { inspectEntityAction, renameEntityAction, setPinAction } from "@/app/entity-actions";
import { deleteIssueAction, restoreIssueAction, toggleProjectFavoriteAction, trashProjectAction, restoreProjectAction } from "@/app/actions";
import { createPageAction, deletePageAction, restorePageAction, togglePageFavoriteAction } from "@/app/pages-actions";
import { announceDocsDeleted } from "@/components/tab-events";
import { ENTITY_RENAMED, PERSONAL_STATE_CHANGED, entityHref, type EntityKind, type EntityCapabilities } from "@/lib/ui/entity-actions";

// placement: "reserve" keeps room for the actions button, "overlay" and "corner" show it over the row on hover.
export function EntityRow({ kind, id, title, children, placement = "reserve" }: { kind: EntityKind; id: string; title: string; children: ReactNode; placement?: "reserve" | "overlay" | "corner" }) {
  const { workspaceId } = useParams<{workspaceId: string}>();
  const { confirm, toast } = useUIActions();
  const { keys } = usePins();
  const router = useRouter(); const t = useT();
  const [moveOpen,setMoveOpen]=useState(false);
  const [cap, setCap] = useState<EntityCapabilities | null>(null);
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(title), [expected, setExpected] = useState(title);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const pinned = keys.has(`${kind}:${id}`);
  const inspecting = useRef<ReturnType<typeof inspectEntityAction> | null>(null);
  async function inspect() {
    const request = inspecting.current ??= inspectEntityAction(workspaceId, kind, id);
    try {
    const result = await request;
    if (result.ok) { setCap(result.data.capabilities); if (!editing) { setDraft(result.data.title); setExpected(result.data.title); } return result.data; }
    setError(result.error); return null;
    } catch { setError(t("Could not save. Retry.")); return null; } finally { if (inspecting.current === request) inspecting.current = null; }
  }
  async function rename() { const next = await inspect(); if (next?.capabilities.rename) { setDraft(next.title); setExpected(next.title); setEditing(true); setError(null); } }
  async function save() {
    if (busy) return;
    const max = kind === "document" ? 120 : kind === "project" ? 50 : 500;
    if (!draft.trim() || draft.trim().length > max) { setError(t("Enter a name between 1 and {max} characters", {max})); return; }
    setBusy(true); setError(null);
    try {
      const result = await renameEntityAction(workspaceId, kind, id, draft.trim(), expected);
      if (!result.ok) { setError(result.error); return; }
      setEditing(false); window.dispatchEvent(new CustomEvent(ENTITY_RENAMED, {detail:{kind,id,title:result.data}})); router.refresh();
    } catch { setError(t("Could not save. Retry.")); } finally { setBusy(false); }
  }
  async function run(action: () => Promise<{ok: boolean; error?: string}>) {
    if (busy) return; setBusy(true); setError(null);
    try { const result = await action(); if (!result.ok) setError(result.error ?? t("Something went wrong")); else { window.dispatchEvent(new Event(PERSONAL_STATE_CHANGED)); router.refresh(); } }
    catch { setError(t("Could not save. Retry.")); } finally { setBusy(false); }
  }
  async function remove() {
    if (!(await confirm(t("Move “{title}” to Trash?", {title}), { body: t("You can restore it from the Trash."), action: t("Move to Trash") }))) return;
    await run(async () => {
      const result = kind === "document" ? await deletePageAction(workspaceId, id) : kind === "project" ? await trashProjectAction(workspaceId, id) : await deleteIssueAction(workspaceId, id);
      if (result.ok) {
        if (kind === "document" && Array.isArray(result.data)) announceDocsDeleted(result.data);
        toast(t("Moved to Trash"), { label:t("Undo"), run: async () => {
          const restored = kind === "document" ? await restorePageAction(workspaceId,id) : kind === "project" ? await restoreProjectAction(workspaceId,id) : await restoreIssueAction(workspaceId,id);
          if (!restored.ok) toast(t(restored.error)); else router.refresh();
        }});
      }
      return result;
    });
  }
  const actions = [
    {label:t("Rename"), disabled:!cap?.rename || busy, run:rename},
    ...(kind === "document" ? [{label:t("Move document"),disabled:!cap?.rename||busy,run:async()=>setMoveOpen(true)}] : []),
    {label:t("Copy link"), disabled:busy, run:async () => { try { await navigator.clipboard.writeText(new URL(entityHref(workspaceId,{kind,id}),location.origin).href); toast(t("Copied")); } catch { setError(t("Could not copy. Retry.")); } }},
    ...(kind === "document" ? [{label:t("New subpage"),disabled:!cap?.rename || busy,run:() => run(async () => { const result=await createPageAction(workspaceId,{parentId:id}); if(result.ok) router.push(entityHref(workspaceId,{kind,id:result.data.id})); return result; })}] : []),
    {label:t(pinned ? "Unpin" : "Pin"), disabled:busy, run:() => run(() => setPinAction(workspaceId,kind,id,!pinned))},
    ...(kind !== "task" ? [{label:t(cap?.isFavorite ? "Remove from favorites" : "Add to favorites"), disabled:!cap?.favorite || busy, run:() => run(() => kind === "document" ? togglePageFavoriteAction(workspaceId,id) : toggleProjectFavoriteAction(workspaceId,id))}] : []),
    {label:t("Move to Trash"),disabled:!cap?.remove || busy,run:remove,danger:true},
  ];
  return <>{moveOpen&&<MoveDocument workspaceId={workspaceId} id={id} onClose={()=>setMoveOpen(false)}/>}<Context.Root onOpenChange={(open) => { if (open) void inspect(); }}>
    <Context.Trigger asChild disabled={editing}><div className="density-entity group/entity relative min-w-0" onContextMenuCapture={(e) => { if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) e.stopPropagation(); }} onKeyDown={(e) => { if (e.key === "F2" && !editing) { e.preventDefault(); e.stopPropagation(); void rename(); } }}>
      {editing ? <div className="flex min-h-8 items-center gap-2 p-1"><input aria-label={t("Name")} autoFocus value={draft} disabled={busy} onFocus={(e) => e.target.select()} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
        e.stopPropagation(); if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); void save(); }
        if (e.key === "Escape") { setEditing(false); setError(null); }
      }} className="h-[34px] rounded-lg px-2.5 min-w-0 flex-1 border border-border-strong bg-bg text-body"/><button disabled={busy} onClick={() => void save()} className="text-small">{t(busy ? "Saving…" : "Save")}</button><button disabled={busy} onClick={() => {setEditing(false);setError(null);}} className="text-small">{t("Cancel")}</button></div> : <div className={placement === "reserve" ? "pr-8" : ""}>{children}</div>}
      {!editing && <div className={`absolute opacity-0 transition-opacity focus-within:opacity-100 group-hover/entity:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100 ${placement === "corner" ? "right-1 top-1 rounded-md bg-bg" : "right-0.5 top-1/2 -translate-y-1/2"}`} onClick={(e) => e.stopPropagation()}>
        <Menu onOpenChange={(open) => {if(open) void inspect();}} width={240} triggerClassName="flex h-7 w-7 items-center justify-center rounded text-faint hover:bg-elevated focus-visible:text-text" trigger={<span aria-label={t("More actions")}><MoreHorizontal size={14}/></span>}>
          {(close) => <>{!cap && <p className="p-2 text-small text-faint">{t("Loading…")}</p>}{actions.map((action) => <Fragment key={action.label}>{action.danger&&<div className="my-1 h-px bg-border"/>}<MenuItem disabled={action.disabled} danger={action.danger} onSelect={() => {close();void action.run();}}>{action.label}</MenuItem></Fragment>)}</>}
        </Menu>
      </div>}
      {pinned && !editing && <Pin aria-label={t("Pinned")} size={10} className="pointer-events-none absolute right-7 top-1 text-accent"/>}
      {error && <p role="alert" className="px-2 text-small text-danger">{t(error)}</p>}
    </div></Context.Trigger>
    <Context.Portal><Context.Content collisionPadding={8} onEscapeKeyDown={(e) => e.stopPropagation()} className="z-[90] max-h-[80dvh] min-w-52 overflow-y-auto rounded-lg border border-border bg-overlay p-1 shadow-xl">
      {!cap && <p className="p-2 text-small text-faint">{t("Loading…")}</p>}
      {actions.map((action) => <Fragment key={action.label}>{action.danger&&<Context.Separator className="my-1 h-px bg-border"/>}<Context.Item disabled={action.disabled} onSelect={() => void action.run()} className={`cursor-default rounded px-2 py-1.5 text-body outline-none data-[highlighted]:bg-elevated data-[disabled]:text-faint ${action.danger ? "text-danger" : "text-text"}`}>{action.label}</Context.Item></Fragment>)}
    </Context.Content></Context.Portal>
  </Context.Root></>;
}

export function usePinned<T extends {id: string}>(items: T[], kind: EntityKind): T[] {
  const { pins } = usePins(); const order = useMemo(()=>new Map(pins.filter((pin) => pin.kind === kind).map((pin,index) => [pin.id,index])),[pins,kind]);
  return useMemo(() => [...items].sort((a,b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)), [items, order]);
}
