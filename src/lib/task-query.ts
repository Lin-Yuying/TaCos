import { getDb } from "@/db/client";
import { listIssues, listIssuesPage, listProjects, listMembers, workspaceRevisions, TacosError, type ListFilters } from "./issues";
import { listTaskFields, listFieldValues } from "./task-fields";
import { applyView, EMPTY_VIEW, isManualOrder, type TaskView } from "./task-view";
export type TaskQuery = Pick<ListFilters,"status"|"q"|"label"|"projectId"|"assigneeId"|"agent">;
async function revision(ws:string,user:string){const values=await workspaceRevisions(ws,user);return JSON.stringify(Object.entries(values).filter(([domain])=>["tasks","projects","permissions","personal"].includes(domain)).sort());}
const viewSnapshots=new Map<string,string[]>();
function cacheSnapshot(key:string,ids:string[]){viewSnapshots.set(key,ids);let entries=[...viewSnapshots.values()].reduce((n,rows)=>n+rows.length,0);while(viewSnapshots.size>16||entries>200000){const first=viewSnapshots.keys().next().value!;entries-=viewSnapshots.get(first)!.length;viewSnapshots.delete(first);}}
/** Custom field and locale sorting use the same comparator as saved browser views. */
export async function queryTaskView(ws:string,user:string,query:TaskQuery,view:TaskView=EMPTY_VIEW,page=0,expected?:string,all=false,includeBody=false){
 if(!Number.isSafeInteger(page)||page<0||page>1_000_000||!Array.isArray(view.filters)||!Array.isArray(view.sort)||view.filters.length>100||view.sort.length>30)throw new TacosError("Invalid task view",400);
 const stamp=await revision(ws,user);if(expected&&expected!==stamp)throw new TacosError("Tasks changed. Refresh the view before continuing.",409);
 const filters:ListFilters={status:query.status,q:query.q,label:query.label,projectId:query.projectId,assigneeId:query.assigneeId,agent:query.agent,viewerId:user,summary:!includeBody};
 const fields=await listTaskFields(ws);
 const pins=getDb().$client.prepare("SELECT entity_id AS id FROM personal_entity_state WHERE workspace_id=? AND user_id=? AND entity_type='task' AND pinned_at IS NOT NULL ORDER BY position,entity_id").all(ws,user) as {id:string}[];
 let items:Awaited<ReturnType<typeof listIssues>>,total:number,values;
 if(!all&&!view.filters.length&&!view.sort.length&&!pins.length){
  const result=await listIssuesPage(ws,{...filters,limit:100,offset:page*100});items=result.items;total=result.total;values=await listFieldValues(items.map(item=>item.id));
 }else{
  const key=JSON.stringify([ws,user,stamp,filters,view]),cached=!all?viewSnapshots.get(key):undefined;
  if(cached){const ids=cached.slice(page*100,(page+1)*100),rank=new Map(ids.map((id,index)=>[id,index]));items=(await listIssues(ws,{...filters,ids})).sort((a,b)=>rank.get(a.id)!-rank.get(b.id)!);total=cached.length;values=await listFieldValues(ids);}
  else{const source=await listIssues(ws,filters),fieldValues=await listFieldValues(source.map(item=>item.id)),rank=new Map(pins.map((pin,index)=>[pin.id,index]));
   const shown=applyView(source,view,fields,fieldValues).sort((a,b)=>(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity));
   if(!all)cacheSnapshot(key,shown.map(item=>item.id));
   total=shown.length;items=all?shown:shown.slice(page*100,(page+1)*100);values=Object.fromEntries(items.map(item=>[item.id,fieldValues[item.id]??{}]));
  }
 }
 if(stamp!==await revision(ws,user))throw new TacosError("Tasks changed. Refresh the view before continuing.",409);
 return {items,total,values,fields,revision:stamp,page};
}
export async function taskViewChoices(ws:string,user:string){const [projects,members]=await Promise.all([listProjects(ws,user),listMembers(ws)]);return {projects:projects.map(project=>project.name),members:members.map(member=>({id:member.id,displayName:member.displayName}))};}
