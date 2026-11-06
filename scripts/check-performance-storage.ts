import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { gunzipSync } from "node:zlib";
async function main(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"tacos-storage-perf-"));process.env.TACOS_DATA_DIR=path.join(root,"data");process.env.TACOS_RUNNER_DIR=path.join(root,"runner");
 const {createLogStream,maintainLogs}=await import("../electron/log-stream.mjs");const dir=path.join(root,"logs");const file=path.join(dir,"active.log"),stream=createLogStream(file);const write=(text:string)=>new Promise<void>((resolve,reject)=>stream.write(text,error=>error?reject(error):resolve()));
 await write("before\n");await fs.utimes(file,0,0);for(let i=0;i<6;i++)await fs.writeFile(path.join(dir,`recent-${i}.log`),"recent");
 // Independent module instance has no knowledge of the first instance's active Set.
 const foreign=await import(new URL("../electron/log-stream.mjs?independent=1",import.meta.url).href);await foreign.maintainLogs(dir);assert.equal(await fs.readFile(file,"utf8"),"before\n");await write("after\n");stream.end();await once(stream,"finish");await maintainLogs(dir);await fs.utimes(file,0,0);for(let i=6;i<12;i++)await fs.writeFile(path.join(dir,`recent-${i}.log`),"recent");await maintainLogs(dir);assert.equal(gunzipSync(await fs.readFile(file+".gz")).toString(),"before\nafter\n");
 const spool=await import("../src/runner/event-spool");await assert.rejects(()=>fs.stat(spool.eventSpoolDir()));const batch=JSON.stringify({server:"http://original",sequence:1,runId:"run-a",events:[{type:"delta",text:"full"}]});const pending=await spool.saveEventBatch("run-a",1,batch);assert.equal((await fs.stat(pending)).mode&0o077,0);await spool.recoverEventBatches("http://other",async()=>{throw new Error("must not replay to another server");});assert.equal(await fs.readFile(pending,"utf8"),batch);await spool.recoverEventBatches("http://original",async body=>{assert.equal(body,batch);return {ok:true,sequence:1};});await assert.rejects(()=>fs.stat(pending));
 const aborted=await spool.saveEventBatch("run-b",2,batch);await spool.archiveEventBatch(aborted);assert.equal(gunzipSync(await fs.readFile(aborted+".gz")).toString(),batch);
 const {UPLOAD_DIR}=await import("../src/lib/attachments");await fs.mkdir(UPLOAD_DIR,{recursive:true});const {imagePreview}=await import("../src/lib/image-preview");for(const [name,input] of [["small",{width:80,height:60,channels:4 as const,background:{r:30,g:100,b:160,alpha:0.2}}],["large",{width:3000,height:2000,channels:3 as const,background:"white"}]] as const){const original=await sharp({create:input}).png().toBuffer();await fs.writeFile(path.join(UPLOAD_DIR,name),original);const preview=await imagePreview(name),metadata=await sharp(preview).metadata();assert(metadata.width!<=2048&&metadata.height!<=2048);assert.deepEqual(await fs.readFile(path.join(UPLOAD_DIR,name)),original);if(name==="small")assert(metadata.hasAlpha);}
 await fs.writeFile(path.join(UPLOAD_DIR,"huge"),await sharp({create:{width:7000,height:6000,channels:3,background:"white"}}).png().toBuffer());await assert.rejects(()=>imagePreview("huge"));assert((await fs.stat(path.join(UPLOAD_DIR,"huge"))).size>0);
 console.log("check-performance-storage: pass (cross-instance log protection, full spool replay/archive, preview bounds/alpha/original preservation)");
}main().catch(error=>{console.error(error);process.exit(1);});
