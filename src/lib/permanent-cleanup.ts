import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { getDb } from "@/db/client";
import { cancelLiveRun } from "./runner/hub";
import { TacosError } from "./tacos-error";
import { UPLOAD_DIR } from "./attachments";
const BATCH=100,LEASE_MS=30000;
function queueFiles(where:string,params:unknown[],preserveReferences=false){const db=getDb().$client;
 const eligible=preserveReferences?`(${where}) AND NOT EXISTS(SELECT 1 FROM attachment_references r WHERE r.attachment_id=attachments.id)`:where;
 db.prepare(`INSERT OR IGNORE INTO file_cleanup(id,created_at) SELECT id,? FROM attachments WHERE ${eligible}`).run(new Date().toISOString(),...params);
 db.prepare(`DELETE FROM attachment_references WHERE attachment_id IN (SELECT id FROM attachments WHERE ${eligible})`).run(...params);
 db.prepare(`DELETE FROM attachments WHERE ${eligible}`).run(...params);
 db.prepare("DELETE FROM attachment_reclaim_candidates WHERE attachment_id NOT IN (SELECT id FROM attachments)").run();
 if(preserveReferences)db.prepare(`UPDATE attachments SET page_id='retained:'||page_id WHERE ${where}`).run(...params);
}
function cancelRuns(where:string,ids:string[]){const rows=getDb().$client.prepare(`SELECT id FROM agent_runs WHERE ${where} AND status IN ('queued','running')`).all(...ids) as {id:string}[];for(const row of rows)cancelLiveRun(row.id);}
export function deleteTaskRecords(ids:string[]){if(!ids.length)return;const db=getDb().$client,q=ids.map(()=>"?").join(",");
 cancelRuns(`issue_id IN (${q})`,ids);
 for(const [table,column] of [["task_field_values","issue_id"],["issue_assignees","issue_id"],["issue_labels","issue_id"],["blockers","issue_id"],["comments","issue_id"],["events","issue_id"],["notifications","issue_id"]])db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM issue_dependencies WHERE issue_id IN (${q}) OR blocked_by_id IN (${q})`).run(...ids,...ids);
 db.prepare(`DELETE FROM personal_entity_state WHERE entity_type='task' AND entity_id IN (${q})`).run(...ids);
 db.prepare(`UPDATE agent_threads SET focus_issue_id=NULL WHERE focus_issue_id IN (${q})`).run(...ids);
 db.prepare(`UPDATE agent_runs SET issue_id=NULL,status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END WHERE issue_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM issues WHERE id IN (${q})`).run(...ids);
}
export function deletePageRecords(ids:string[]){if(!ids.length)return;const db=getDb().$client,q=ids.map(()=>"?").join(",");
 for(const id of ids){db.prepare("DELETE FROM attachment_references WHERE source IN (?,?) OR source IN (SELECT 'page_versions:'||id FROM page_versions WHERE page_id=?) OR source IN (SELECT 'page_comments:'||id FROM page_comments WHERE page_id=?)").run(`pages:${id}`,`collaboration:${id}`,id,id);}
 queueFiles(`page_id IN (${q})`,ids,true);
 for(const table of ["page_collab","page_access","page_favorites","page_comments","page_versions"])db.prepare(`DELETE FROM ${table} WHERE page_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM page_links WHERE (source_kind='page' AND source_id IN (${q})) OR target_page_id IN (${q})`).run(...ids,...ids);
 db.prepare(`DELETE FROM personal_entity_state WHERE entity_type='document' AND entity_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM project_resources WHERE page_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM notifications WHERE page_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM pages WHERE id IN (${q})`).run(...ids);
}
export function deleteThreadRecords(ids:string[]){if(!ids.length)return;const db=getDb().$client,q=ids.map(()=>"?").join(",");
 cancelRuns(`thread_id IN (${q})`,ids);
 for(const id of ids)db.prepare("DELETE FROM attachment_references WHERE source IN (SELECT 'agent_messages:'||id FROM agent_messages WHERE thread_id=?) OR source IN (SELECT 'agent_runs:'||id FROM agent_runs WHERE thread_id=?)").run(id,id);
 queueFiles(`page_id IN (${q})`,ids.map(id=>`thread:${id}`),true);
 db.prepare(`DELETE FROM runner_event_batches WHERE run_id IN (SELECT id FROM agent_runs WHERE thread_id IN (${q}))`).run(...ids);
 for(const table of ["agent_steps","agent_messages","agent_thread_flags"])db.prepare(`DELETE FROM ${table} WHERE thread_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM agent_runs WHERE thread_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM agent_threads WHERE id IN (${q})`).run(...ids);
}
function deleteProjects(ids:string[]){if(!ids.length)return;const db=getDb().$client,q=ids.map(()=>"?").join(",");
 for(const table of ["project_members","favorites","project_grants","overview_comments","overview_doc_edits","overview_doc_edit_views","project_resources"])db.prepare(`DELETE FROM ${table} WHERE project_id IN (${q})`).run(...ids);
 // Documents and conversations keep their workspace ownership and history.
 db.prepare(`UPDATE pages SET project_id=NULL WHERE project_id IN (${q})`).run(...ids);
 db.prepare(`UPDATE agent_threads SET project_id='' WHERE project_id IN (${q})`).run(...ids);
 db.prepare(`DELETE FROM personal_entity_state WHERE entity_type='project' AND entity_id IN (${q})`).run(...ids);
 for(const id of ids){const row=db.prepare("SELECT workspace_id AS workspaceId FROM projects WHERE id=?").get(id) as {workspaceId:string}|undefined;if(!row)continue;for(const route of [`/${row.workspaceId}/projects/${id}`,`/${row.workspaceId}/projects/${id}/issues`])db.prepare("DELETE FROM personal_task_views WHERE workspace_id=? AND (scope=? OR substr(scope,1,length(?)+1)=?||'?')").run(row.workspaceId,route,route,route);}

 db.prepare(`DELETE FROM projects WHERE id IN (${q})`).run(...ids);
}
/** Every batch commits independently; the remaining source rows are the recovery cursor. */
async function leased(key:string,work:(renew:(completed?:number)=>void)=>Promise<void>){const db=getDb().$client,owner=crypto.randomUUID(),now=Date.now();
 const taken=db.prepare(`INSERT INTO maintenance_jobs(id,owner,lease_until,state,completed,error,updated_at) VALUES(?,?,?,'running',0,NULL,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until,state='running',error=NULL,updated_at=excluded.updated_at WHERE maintenance_jobs.lease_until<?`).run(key,owner,now+LEASE_MS,new Date(now).toISOString(),now);
 if(!taken.changes)throw new TacosError("Cleanup is already running. Retry shortly.",409);
 const renew=(completed=0)=>{const result=db.prepare("UPDATE maintenance_jobs SET lease_until=?,completed=completed+?,updated_at=? WHERE id=? AND owner=?").run(Date.now()+LEASE_MS,completed,new Date().toISOString(),key,owner);if(!result.changes)throw new Error("Cleanup lease changed");};
 try{await work(renew);db.prepare("UPDATE maintenance_jobs SET state='done',lease_until=0,updated_at=? WHERE id=? AND owner=?").run(new Date().toISOString(),key,owner);}catch(error){db.prepare("UPDATE maintenance_jobs SET state='failed',lease_until=0,error=?,updated_at=? WHERE id=? AND owner=?").run(String(error),new Date().toISOString(),key,owner);throw error;}
}
export async function purgeWorkspaceRecords(workspaceId:string){await leased(`workspace:${workspaceId}`,async renew=>{const db=getDb().$client;
 const expired=()=>Boolean(db.prepare("SELECT id FROM workspaces WHERE id=? AND deleted_at IS NOT NULL AND deleted_at<=?").get(workspaceId,new Date(Date.now()-30*86400000).toISOString()));
 if(!expired())return;
 for(const [table,remove] of [["issues",deleteTaskRecords],["pages",deletePageRecords],["agent_threads",deleteThreadRecords],["projects",deleteProjects]] as const){
  while(true){const more=db.transaction(()=>{if(!expired())return false;const rows=db.prepare(`SELECT id FROM ${table} WHERE workspace_id=? LIMIT ?`).all(workspaceId,BATCH) as {id:string}[];remove(rows.map(row=>row.id));renew(rows.length);return rows.length===BATCH;}).immediate();if(!more)break;await nextTurn();}
 }
 db.transaction(()=>{renew();if(!expired())return;cancelRuns("workspace_id=?",[workspaceId]);db.prepare("DELETE FROM runner_event_batches WHERE run_id IN (SELECT id FROM agent_runs WHERE workspace_id=?)").run(workspaceId);queueFiles("workspace_id=?",[workspaceId]);for(const table of ["attachment_reference_checks","agent_runs","personal_entity_state","personal_task_views","ai_settings","task_fields","page_versions","page_comments","labels","notifications","join_codes","api_keys","workspace_members"])db.prepare(`DELETE FROM ${table} WHERE workspace_id=?`).run(workspaceId);
  db.prepare("DELETE FROM workspaces WHERE id=?").run(workspaceId);db.prepare("DELETE FROM workspace_revisions WHERE workspace_id=?").run(workspaceId);
 }).immediate();await processFileCleanup();});}
export async function purgePageRecords(workspaceId:string,pageId:string){await leased(`page:${pageId}`,async renew=>{const db=getDb().$client;
 const {auditAttachmentReferences,attachmentReferenceRevision}=await import("./attachment-references");let checked=(await auditAttachmentReferences(workspaceId)).revision;
 while(true){if(attachmentReferenceRevision(workspaceId)!==checked)checked=(await auditAttachmentReferences(workspaceId)).revision;
 const more=db.transaction(()=>{renew();if(attachmentReferenceRevision(workspaceId)!==checked)throw new TacosError("Content changed during the scan. Retry.",409);const root=db.prepare("SELECT id FROM pages WHERE workspace_id=? AND id=? AND deleted_at IS NOT NULL").get(workspaceId,pageId);if(!root)return false;
  // Keep the root visible in Trash until every child batch has committed.
  const rows=db.prepare("SELECT id FROM pages WHERE workspace_id=? AND trash_root=? AND id<>? LIMIT ?").all(workspaceId,pageId,pageId,BATCH) as {id:string}[];
  if(!rows.length){deletePageRecords([pageId]);renew(1);return false;}deletePageRecords(rows.map(row=>row.id));renew(rows.length);checked=attachmentReferenceRevision(workspaceId);return true;
 }).immediate();if(!more)break;await nextTurn();}await processFileCleanup();});}
export async function purgeProjectRecords(workspaceId:string,projectId:string){await leased(`project:${projectId}`,async renew=>{const db=getDb().$client;
 while(true){const more=db.transaction(()=>{renew();const rows=db.prepare("SELECT id FROM issues WHERE workspace_id=? AND project_id=? LIMIT ?").all(workspaceId,projectId,BATCH) as {id:string}[];deleteTaskRecords(rows.map(row=>row.id));renew(rows.length);return rows.length===BATCH;}).immediate();if(!more)break;await nextTurn();}
 db.transaction(()=>{renew();deleteProjects([projectId]);}).immediate();});}
export async function processFileCleanup(){const db=getDb().$client;const rows=db.prepare("SELECT id FROM file_cleanup LIMIT 100").all() as {id:string}[];
 for(const {id} of rows){if(!/^[\w-]+$/.test(id))continue;try{await fs.rm(path.join(UPLOAD_DIR,id),{force:true});await fs.rm(path.join(UPLOAD_DIR,`${id}.json`),{force:true});await fs.rm(path.join(UPLOAD_DIR,`${id}.preview.webp`),{force:true});db.prepare("DELETE FROM file_cleanup WHERE id=?").run(id);}catch(error){db.prepare("UPDATE file_cleanup SET error=? WHERE id=?").run(String(error),id);}}
}
let timer:ReturnType<typeof setInterval>|null=null,busy=false;
export function startStorageMaintenance(){if(timer)return;const tick=async()=>{if(busy)return;busy=true;try{const rows=getDb().$client.prepare("SELECT id FROM workspaces WHERE deleted_at IS NOT NULL AND deleted_at<? LIMIT 1").all(new Date(Date.now()-30*86400000).toISOString()) as {id:string}[];for(const row of rows)await purgeWorkspaceRecords(row.id);
 const jobs=getDb().$client.prepare("SELECT id FROM maintenance_jobs WHERE state<>'done' AND lease_until<? ORDER BY updated_at LIMIT 1").all(Date.now()) as {id:string}[];
 for(const job of jobs){const [kind,id]=job.id.split(":");if(kind==="page"){const row=getDb().$client.prepare("SELECT workspace_id AS ws FROM pages WHERE id=? AND deleted_at IS NOT NULL").get(id) as {ws:string}|undefined;if(row)await purgePageRecords(row.ws,id);}if(kind==="project"){const row=getDb().$client.prepare("SELECT workspace_id AS ws FROM projects WHERE id=? AND deleted_at IS NOT NULL").get(id) as {ws:string}|undefined;if(row)await purgeProjectRecords(row.ws,id);}}
 const retained=getDb().$client.prepare("SELECT DISTINCT a.workspace_id AS ws FROM attachments a LEFT JOIN attachment_reference_checks c ON c.workspace_id=a.workspace_id WHERE a.page_id LIKE 'retained:%' AND (c.checked_at IS NULL OR c.checked_at<?) LIMIT 1").get(new Date(Date.now()-3600000).toISOString()) as {ws:string}|undefined;
 if(retained){const {reclaimRetainedAttachments}=await import("./attachment-references");await reclaimRetainedAttachments(retained.ws);}
 await processFileCleanup();const {compressPageHistory}=await import("./pages");await compressPageHistory();const {compressRunArchives}=await import("./runner/hub");await compressRunArchives();}catch(error){console.error("Storage maintenance:",error);}finally{busy=false;}};void tick();timer=setInterval(()=>void tick(),60000);timer.unref?.();}
