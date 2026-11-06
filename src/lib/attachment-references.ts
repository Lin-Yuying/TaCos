import { getDb } from "@/db/client";
import { unpackText } from "./compressed-text";
import { setImmediate as yieldTurn } from "node:timers/promises";
import * as Y from "yjs";
import { getPage } from "./pages";
import { findVisibleIssueRow, getOverviewAccess, getProject } from "./issues";
import { canSeeThread } from "./agent-threads";

/** A retained file inherits access from a still-existing reference, never from workspace membership alone.
 * The inventory is only a candidate index: recheck both current content and permissions on every read.
 */
export async function canReadRetainedAttachment(workspaceId:string,viewerId:string,attachmentId:string):Promise<boolean>{
 const db=getDb().$client;
 const member=db.prepare("SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND w.deleted_at IS NULL").get(workspaceId,viewerId);
 if(!member)return false;
 const sources=db.prepare("SELECT source FROM attachment_references WHERE attachment_id=?").iterate(attachmentId) as Iterable<{source:string}>;
 for(const {source} of sources){
  const colon=source.indexOf(":"),kind=source.slice(0,colon),id=source.slice(colon+1);
  if(kind==="pages"||kind==="collaboration"){
   const page=await getPage(workspaceId,id,viewerId);if(!page)continue;
   if(kind==="pages"&&(page.doc.includes(attachmentId)||page.cover?.includes(attachmentId)))return true;
   if(kind==="collaboration"){
    const state=db.prepare("SELECT state FROM page_collab WHERE page_id=?").get(id) as {state:Buffer}|undefined;
    if(state){const doc=new Y.Doc();try{Y.applyUpdate(doc,state.state);for(const name of doc.share.keys())doc.getXmlFragment(name);if(JSON.stringify(doc.toJSON()).includes(attachmentId))return true;}finally{doc.destroy();}}
   }
  }else if(kind==="page_versions"||kind==="page_comments"){
   const row=kind==="page_versions"
    ?db.prepare("SELECT page_id AS pageId,doc AS body,doc_compressed AS compressed FROM page_versions WHERE workspace_id=? AND id=?").get(workspaceId,id) as {pageId:string;body:string;compressed:string|null}|undefined
    :db.prepare("SELECT page_id AS pageId,body,NULL AS compressed FROM page_comments WHERE workspace_id=? AND id=?").get(workspaceId,id) as {pageId:string;body:string;compressed:null}|undefined;
   if(row&&await getPage(workspaceId,row.pageId,viewerId)&&(await unpackText(row.body,row.compressed)).includes(attachmentId))return true;
  }else if(kind==="projects"||kind==="overview_doc_edits"){
   const row=kind==="projects"
    ?db.prepare("SELECT id AS projectId,doc AS body FROM projects WHERE workspace_id=? AND id=? AND deleted_at IS NULL").get(workspaceId,id) as {projectId:string;body:string}|undefined
    :db.prepare("SELECT p.id AS projectId,e.doc_before||e.doc_after AS body FROM overview_doc_edits e JOIN projects p ON p.id=e.project_id WHERE p.workspace_id=? AND e.id=? AND p.deleted_at IS NULL").get(workspaceId,id) as {projectId:string;body:string}|undefined;
   if(row&&row.body.includes(attachmentId)&&await getProject(workspaceId,row.projectId,viewerId)&&(await getOverviewAccess(workspaceId,row.projectId,viewerId)).canView)return true;
  }else if(kind==="comments"){
   const row=db.prepare("SELECT c.issue_id AS issueId,c.body FROM comments c JOIN issues i ON i.id=c.issue_id WHERE i.workspace_id=? AND c.id=?").get(workspaceId,id) as {issueId:string;body:string}|undefined;
   if(row&&row.body.includes(attachmentId)&&await findVisibleIssueRow(workspaceId,row.issueId,viewerId))return true;
  }else if(kind==="agent_messages"||kind==="agent_runs"){
   const row=kind==="agent_messages"
    ?db.prepare("SELECT m.thread_id AS threadId,m.content AS body,NULL AS compressed FROM agent_messages m JOIN agent_threads t ON t.id=m.thread_id WHERE t.workspace_id=? AND m.id=?").get(workspaceId,id) as {threadId:string;body:string;compressed:null}|undefined
    :db.prepare("SELECT thread_id AS threadId,payload AS body,payload_compressed AS compressed FROM agent_runs WHERE workspace_id=? AND id=?").get(workspaceId,id) as {threadId:string;body:string;compressed:string|null}|undefined;
   if(row&&await canSeeThread(workspaceId,viewerId,row.threadId)&&(await unpackText(row.body,row.compressed)).includes(attachmentId))return true;
  }
 }
 return false;
}

/** Reference inventory includes retained history and Trash; unknown offline references stay protected. */
export function attachmentReferenceRevision(workspaceId:string){return JSON.stringify(getDb().$client.prepare("SELECT domain,revision FROM workspace_revisions WHERE workspace_id=? ORDER BY domain").all(workspaceId));}
export async function auditAttachmentReferences(workspaceId:string){
 const db=getDb().$client,revision=()=>attachmentReferenceRevision(workspaceId);
 const before=revision(),attachments=db.prepare("SELECT id,page_id AS pageId,size,complete FROM attachments WHERE workspace_id=?").all(workspaceId) as {id:string;pageId:string;size:number;complete:number}[],ids=new Set(attachments.map(row=>row.id));
 const found=new Map<string,Set<string>>();
 const remember=(source:string,text:string)=>{for(const match of text.matchAll(/[A-Za-z0-9_-]{8,}/g)){const id=match[0];if(ids.has(id)){const refs=found.get(id)??new Set<string>();refs.add(source);found.set(id,refs);}}};
 for(const [table,columns,where] of [
  ["pages","doc,cover","workspace_id=?"],["page_versions","doc,doc_compressed","workspace_id=?"],
  ["projects","doc","workspace_id=?"],["overview_doc_edits","doc_before,doc_after","project_id IN (SELECT id FROM projects WHERE workspace_id=?)"],
  ["page_comments","body","workspace_id=?"],["comments","body","issue_id IN (SELECT id FROM issues WHERE workspace_id=?)"],
  ["agent_messages","content","thread_id IN (SELECT id FROM agent_threads WHERE workspace_id=?)"],["agent_runs","payload,payload_compressed","workspace_id=?"]
 ]){
  let cursor="";while(true){const rows=db.prepare(`SELECT id,${columns} FROM ${table} WHERE ${where} AND id>? ORDER BY id LIMIT 100`).all(workspaceId,cursor) as Record<string,string|null>[];if(!rows.length)break;
   for(const row of rows){if(row.doc_compressed)remember(`${table}:${row.id}`,await unpackText(row.doc??"",row.doc_compressed));if(row.payload_compressed)remember(`${table}:${row.id}`,await unpackText(row.payload??"",row.payload_compressed));for(const [column,text] of Object.entries(row))if(text&&column!=="id"&&!column.endsWith("compressed"))remember(`${table}:${row.id}`,text);cursor=row.id!;}await yieldTurn();
  }
 }
 const states=db.prepare("SELECT page_id AS id,state FROM page_collab WHERE page_id IN (SELECT id FROM pages WHERE workspace_id=?)").all(workspaceId) as {id:string;state:Buffer}[];
 for(const row of states){const doc=new Y.Doc();try{Y.applyUpdate(doc,row.state);for(const name of doc.share.keys())doc.getXmlFragment(name);remember(`collaboration:${row.id}`,JSON.stringify(doc.toJSON()));}finally{doc.destroy();}await yieldTurn();}
 db.transaction(()=>{if(revision()!==before)throw new Error("Content changed during the scan. Retry.");db.prepare("DELETE FROM attachment_references WHERE attachment_id IN (SELECT id FROM attachments WHERE workspace_id=?)").run(workspaceId);const insert=db.prepare("INSERT INTO attachment_references(attachment_id,source) VALUES(?,?)");for(const [id,sources] of found)for(const source of sources)insert.run(id,source);db.prepare("INSERT INTO attachment_reference_checks(workspace_id,checked_at) VALUES(?,?) ON CONFLICT(workspace_id) DO UPDATE SET checked_at=excluded.checked_at").run(workspaceId,new Date().toISOString());
  db.prepare("DELETE FROM attachment_reclaim_candidates WHERE attachment_id NOT IN (SELECT id FROM attachments) OR attachment_id IN (SELECT attachment_id FROM attachment_references)").run();
  // Only files whose original owner has already been permanently deleted may enter automatic reclamation.
  db.prepare("INSERT OR IGNORE INTO attachment_reclaim_candidates SELECT id,? FROM attachments WHERE workspace_id=? AND page_id LIKE 'retained:%' AND NOT EXISTS(SELECT 1 FROM attachment_references r WHERE r.attachment_id=attachments.id)").run(new Date().toISOString(),workspaceId);
 }).immediate();
 return {revision:before,files:attachments.length,referenced:found.size,protectedFiles:attachments.filter(row=>row.complete&&!found.has(row.id)).length,protectedBytes:attachments.filter(row=>row.complete&&!found.has(row.id)).reduce((sum,row)=>sum+row.size,0)};
}

export const RETAINED_ATTACHMENT_GRACE_MS=7*86400000;
export async function reclaimRetainedAttachments(workspaceId:string,now=Date.now()){
 const checked=await auditAttachmentReferences(workspaceId),db=getDb().$client;
 return db.transaction(()=>{
  if(attachmentReferenceRevision(workspaceId)!==checked.revision)throw new Error("Content changed during the scan. Retry.");
  const rows=db.prepare("SELECT a.id FROM attachments a JOIN attachment_reclaim_candidates c ON c.attachment_id=a.id WHERE a.workspace_id=? AND a.page_id LIKE 'retained:%' AND c.unreferenced_since<=? AND NOT EXISTS(SELECT 1 FROM attachment_references r WHERE r.attachment_id=a.id) LIMIT 100").all(workspaceId,new Date(now-RETAINED_ATTACHMENT_GRACE_MS).toISOString()) as {id:string}[];
  for(const {id} of rows){db.prepare("INSERT OR IGNORE INTO file_cleanup(id,created_at) VALUES(?,?)").run(id,new Date(now).toISOString());db.prepare("DELETE FROM attachments WHERE id=?").run(id);db.prepare("DELETE FROM attachment_reclaim_candidates WHERE attachment_id=?").run(id);}
  return rows.length;
 }).immediate();
}
