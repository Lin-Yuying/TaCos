"use server";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/auth";
import { inspectEntity, listPersonalPins, setPersonalPin } from "@/lib/personal-entities";
import { changeIssueCollection, updateIssue, updateProject, TacosError } from "@/lib/issues";
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

export async function batchEntityAction(ws:string,kind:EntityKind,ids:string[],operation:string,value?:string) {
  return run(async()=>{
    const {user}=await requireWorkspace(ws);
    if(!ids.length||ids.length>100)throw new TacosError("Select between 1 and 100 items",400);
    const {deleteIssueAction,updateIssueAction,toggleProjectFavoriteAction,trashProjectAction}=await import("./actions");
    const {deletePageAction,togglePageFavoriteAction,setPageSharedAction}=await import("./pages-actions");
    const results=[];
    if(operation==="move"&&kind==="document") {
      const {movePages}=await import("@/lib/pages"),target=JSON.parse(value??"{}") as {parentId:string|null;tokens:Record<string,string>};
      await movePages(ws,user.id,ids,{parentId:target.parentId},target.tokens??{});revalidatePath(`/${ws}`,"layout");return ids.map(id=>({id,ok:true,error:undefined,deletedIds:undefined as string[]|undefined}));
    }
    const alreadyDeleted=new Set<string>();
    for(const id of [...new Set(ids)]) {
      try {
        if(alreadyDeleted.has(id)){results.push({id,ok:true,error:undefined,deletedIds:undefined});continue;}
        const entity=await inspectEntity(ws,user.id,kind,id);
        let result:{ok:boolean;error?:string;data?:unknown};
        if(operation==="pin"){await setPersonalPin(ws,user.id,kind,id,value!=="false");result={ok:true};}
        else if(operation==="trash") {
          if(!entity.capabilities.remove)throw new TacosError("You cannot delete this item",403);
          result=kind==="task"?await deleteIssueAction(ws,id):kind==="document"?await deletePageAction(ws,id):await trashProjectAction(ws,id);
        }else if(operation==="favorite"&&kind!=="task")result=entity.capabilities.isFavorite===(value!=="false")?{ok:true}:kind==="document"?await togglePageFavoriteAction(ws,id):await toggleProjectFavoriteAction(ws,id);
        else if((operation==="assignee"||operation==="label")&&kind==="task"){
          const change=JSON.parse(value??"{}") as {id:string;selected:boolean};
          if(typeof change.id!=="string"||typeof change.selected!=="boolean")throw new TacosError("Choose a member or label",400);
          await changeIssueCollection(ws,id,{kind:operation,value:change.id,selected:change.selected},{kind:"user",userId:user.id,displayName:user.displayName});result={ok:true};
        }
        else if(operation==="status"&&kind==="task") {
          const {STATUS_ORDER}=await import("@/lib/constants");
          if(!STATUS_ORDER.includes(value as never))throw new TacosError("Unknown status",400);
          result=await updateIssueAction(ws,id,{status:value as never});
        }else if(operation==="priority"&&kind==="task") result=await updateIssueAction(ws,id,{priority:Number(value) as 0|1|2|3|4});
        else if(operation==="date"&&kind==="task")result=await updateIssueAction(ws,id,{dueDate:value||null});
        else if(operation==="shared"&&kind==="document")result=await setPageSharedAction(ws,id,value==="true");
        else throw new TacosError("Unknown action",400);
        if(operation==="trash"&&result.ok&&Array.isArray(result.data))for(const child of result.data)alreadyDeleted.add(child);
        results.push({id,ok:result.ok,error:result.error,deletedIds:operation==="trash"&&Array.isArray(result.data)?result.data as string[]:undefined});
      }catch(error){results.push({id,ok:false,error:error instanceof Error?error.message:"Could not save. Retry."});}
    }
    revalidatePath(`/${ws}`,"layout");return results;
  });
}
