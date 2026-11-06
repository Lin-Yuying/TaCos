import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
const zip=promisify(gzip);
export const eventSpoolDir=()=>path.join(process.env.TACOS_RUNNER_DIR||path.join(os.homedir(),".tacos","runner"),"pending-events");
let bytes=0;
let initialization:Promise<void>|undefined;
const ready=()=>initialization??=(async()=>{await fs.mkdir(eventSpoolDir(),{recursive:true,mode:0o700});for(const name of await fs.readdir(eventSpoolDir()))if(/\.json(?:\.gz)?$/.test(name))bytes+=(await fs.stat(path.join(eventSpoolDir(),name))).size;})();
export async function checkEventSpoolCapacity(){await ready();if(bytes>=(Number(process.env.TACOS_RUNNER_SPOOL_MB)||256)*1024*1024)throw new Error(`Pending run diagnostics reached the disk budget. Export and clear files in ${eventSpoolDir()} before starting more work.`);}
export async function saveEventBatch(runId:string,sequence:number,body:string){await ready();if(!/^[\w-]+$/.test(runId)||!Number.isSafeInteger(sequence)||sequence<0)throw new Error("Invalid event batch");const file=path.join(eventSpoolDir(),`${runId}-${sequence}.json`),size=Buffer.byteLength(body),old=await fs.stat(file).catch(()=>null);const temporary=`${file}.tmp`;await fs.writeFile(temporary,body,{mode:0o600});await fs.rename(temporary,file);bytes+=size-(old?.size??0);return file;}
export async function acknowledgeEventBatch(file:string){await ready();const stat=await fs.stat(file).catch(()=>null);await fs.rm(file,{force:true});bytes-=stat?.size??0;}
export async function archiveEventBatch(file:string){const content=await fs.readFile(file),compressed=await zip(content);await fs.writeFile(`${file}.gz`,compressed,{mode:0o600});await fs.rm(file,{force:true});bytes+=compressed.length-content.length;}
/** Replays only to the original server. Terminal runs become downloadable local diagnostics. */
export async function recoverEventBatches(server:string,send:(body:string)=>Promise<{ok:boolean;cancelled?:boolean;sequence?:number}>){
 await ready();
 const names=(await fs.readdir(eventSpoolDir())).filter(name=>/^[\w-]+-\d+\.json$/.test(name)).sort((a,b)=>Number(a.match(/-(\d+)\.json$/)?.[1])-Number(b.match(/-(\d+)\.json$/)?.[1]));
 for(const name of names){const file=path.join(eventSpoolDir(),name),body=await fs.readFile(file,"utf8");let batch;try{batch=JSON.parse(body);}catch{continue;}if(batch.server!==server)continue;
  try{const result=await send(body);if(!result.ok)continue;if(result.cancelled)await archiveEventBatch(file);else if(result.sequence===batch.sequence)await acknowledgeEventBatch(file);}catch{/* Offline: keep the exact original batch for the next restart. */}
 }
}
