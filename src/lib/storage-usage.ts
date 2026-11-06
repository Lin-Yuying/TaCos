import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { getDb } from "@/db/client";
import { DATA_DIR } from "./data-dir";
import { harnessLogDir } from "./harness/turn-log";
export async function directoryUsage(root:string){let logical=0,physical=0,files=0;const seen=new Set<string>(),stack=[root];
 while(stack.length){const dir=stack.pop()!;let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
  for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isDirectory())stack.push(file);else if(entry.isFile()){const stat=await fs.stat(file);logical+=stat.size;files++;const identity=`${stat.dev}:${stat.ino}`;if(!seen.has(identity)){seen.add(identity);physical+=stat.blocks*512;}if(files%100===0)await yieldTurn();}}
 }return {logical,physical,files};
}
async function size(file:string){try{return (await fs.stat(file)).size;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return 0;throw error;}}
export async function storageUsage(workspaceId:string,host:boolean){const db=getDb().$client;
 const attachments=db.prepare("SELECT count(*) AS files,coalesce(sum(size),0) AS bytes,coalesce(sum(CASE WHEN complete=0 THEN size ELSE 0 END),0) AS unfinishedBytes FROM attachments WHERE workspace_id=?").get(workspaceId) as {files:number;bytes:number;unfinishedBytes:number};
 const logical=db.prepare(`SELECT (SELECT coalesce(sum(length(doc)+length(coalesce(doc_compressed,''))),0) FROM page_versions WHERE workspace_id=?) AS history,(SELECT coalesce(sum(length(state)),0) FROM page_collab WHERE page_id IN (SELECT id FROM pages WHERE workspace_id=?)) AS collaboration,(SELECT coalesce(sum(length(payload)+length(coalesce(payload_compressed,''))),0) FROM agent_runs WHERE workspace_id=?) AS runs`).get(workspaceId,workspaceId,workspaceId) as {history:number;collaboration:number;runs:number};
 const jobs=db.prepare("SELECT id,state,completed,error,updated_at AS updatedAt FROM maintenance_jobs WHERE id=? OR id IN (SELECT 'project:'||id FROM projects WHERE workspace_id=?) OR id IN (SELECT 'page:'||id FROM pages WHERE workspace_id=?) ORDER BY updated_at DESC LIMIT 50").all(`workspace:${workspaceId}`,workspaceId,workspaceId) as {id:string;state:string;completed:number;error:string|null;updatedAt:string}[];
 if(!host)return {attachments,logical,jobs,host:null};
 const pageSize=Number(db.pragma("page_size",{simple:true})),pages=Number(db.pragma("page_count",{simple:true})),free=Number(db.pragma("freelist_count",{simple:true}));
 const [main,wal,uploads,backups,logs]=await Promise.all([size(path.join(DATA_DIR,"tacos.db")),size(path.join(DATA_DIR,"tacos.db-wal")),directoryUsage(path.join(DATA_DIR,"uploads")),directoryUsage(process.env.TACOS_BACKUP_DIR??path.join(path.dirname(DATA_DIR),"backups")),directoryUsage(path.dirname(harnessLogDir()))]);
 return {attachments,logical,jobs,host:{main,wal,effectivePages:(pages-free)*pageSize,freePages:free*pageSize,uploads,backups,logs}};
}
