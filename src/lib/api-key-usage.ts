import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "@/db/client";
import { DATA_DIR } from "./data-dir";
const dir=path.join(DATA_DIR,"key-usage");
const journal=path.join(dir,`${process.pid}-${crypto.randomUUID()}.jsonl`);
let chain=Promise.resolve(),timer:ReturnType<typeof setTimeout>|null=null;
type Use={id:string;at:string};
function decode(text:string):Use[]{return text.split("\n").flatMap(line=>{try{const row=JSON.parse(line) as Use;return typeof row.id==="string"&&typeof row.at==="string"?[row]:[];}catch{return [];}});}
function apply(rows:Use[]){const latest=new Map<string,string>();for(const row of rows)if(row.at>(latest.get(row.id)??""))latest.set(row.id,row.at);
 const db=getDb().$client;db.transaction(()=>{const update=db.prepare("UPDATE api_keys SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)");for(const [id,at] of latest)update.run(at,id,at);}).immediate();}
export function flushApiKeyUsage():Promise<void>{
 if(timer)clearTimeout(timer);timer=null;
 const operation=chain.then(async()=>{await fs.mkdir(dir,{recursive:true});const ready=`${journal}.${crypto.randomUUID()}.ready`;try{await fs.rename(journal,ready);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  for(const name of await fs.readdir(dir)){
   const pid=Number(name.split("-")[0]);let orphan=false;try{process.kill(pid,0);}catch(error){orphan=(error as NodeJS.ErrnoException).code==="ESRCH";}
   if(!name.endsWith(".ready")&&!orphan)continue;
   const file=path.join(dir,name);try{apply(decode(await fs.readFile(file,"utf8")));await fs.rm(file,{force:true});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  }
 });chain=operation.catch(()=>{});return operation;
}
/** Persist each true event before returning; only the folded SQLite write is delayed. */
export async function recordApiKeyUsage(id:string,at:string):Promise<void>{
 const operation=chain.then(async()=>{await fs.mkdir(dir,{recursive:true});await fs.appendFile(journal,JSON.stringify({id,at})+"\n",{mode:0o600});});chain=operation.catch(()=>{});
 try{await operation;}catch{apply([{id,at}]);}
 if(!timer){timer=setTimeout(()=>{void flushApiKeyUsage().catch(error=>console.error("Key usage:",error));},1000);timer.unref?.();}
}
/** Infrequent settings reads include unflushed journals from every process. */
export async function pendingApiKeyUsage():Promise<Map<string,string>>{
 await chain;const latest=new Map<string,string>();let names:string[];try{names=await fs.readdir(dir);}catch{return latest;}
 // Rename is not a commit: retry enumeration if a flush moved an active file.
 for(let attempt=0;attempt<5;attempt++){
  let moved=false;
  for(const name of names){try{for(const row of decode(await fs.readFile(path.join(dir,name),"utf8")))if(row.at>(latest.get(row.id)??""))latest.set(row.id,row.at);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")moved=true;else throw error;}}
  if(!moved)break;names=await fs.readdir(dir);
 }
 return latest;
}
