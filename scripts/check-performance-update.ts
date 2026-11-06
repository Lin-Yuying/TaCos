import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
async function main(){if(process.platform!=="darwin"){console.log("check-performance-update: skipped (requires macOS ditto)");return;}const {prepare}=require("../electron/mac-update.js");const root=await fs.mkdtemp(path.join(os.tmpdir(),"tacos-update-perf-")),bytes=Buffer.from("invalid zip fixture"),info={version:"2.4.0",files:[{url:"TaCos-arm64.zip",sha512:crypto.createHash("sha512").update(bytes).digest("base64"),size:bytes.length}]};const stages:string[]=[];
 const args={userData:root,info,arch:"arm64",net:{fetch:async()=>new Response(bytes)},log:()=>{},onProgress:()=>{},onStage:(stage:string)=>stages.push(stage)};await assert.rejects(()=>prepare(args));assert(stages.includes("downloading")&&stages.includes("unpacking"));await assert.rejects(()=>fs.stat(path.join(root,"pending-update/2.4.0/unpacked")));
 const abort=new AbortController();abort.abort();await assert.rejects(()=>prepare({...args,signal:abort.signal}));
 const statfs=fs.statfs;try{fs.statfs=(async()=>({bavail:0,bsize:4096})) as unknown as typeof statfs;await assert.rejects(()=>prepare(args),/Free disk space/);}finally{fs.statfs=statfs;}
 console.log("check-performance-update: pass (real macOS unpack failure, abort, low disk preflight; no app replacement)");}
main().catch(error=>{console.error(error);process.exit(1);});
