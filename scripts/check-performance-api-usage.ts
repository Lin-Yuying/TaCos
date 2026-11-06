import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
process.env.TACOS_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"tacos-key-usage-"));
async function main(){const {getDb}=await import("../src/db/client"),db=getDb().$client,lib=await import("../src/lib/issues"),usage=await import("../src/lib/api-key-usage");const row=db.prepare("SELECT id AS ws,created_by AS user FROM workspaces LIMIT 1").get() as {ws:string;user:string};const key=await lib.createApiKey(row.ws,"Usage fixture",row.user);await lib.verifyApiKey(key.key,{recordUse:false});assert.equal((await lib.listApiKeys(row.ws)).find(item=>item.id===key.record.id)?.lastUsedAt,null);
 const times=Array.from({length:200},(_,i)=>new Date(Date.UTC(2026,10,1,0,0,i)).toISOString());await Promise.all(times.map(at=>usage.recordApiKeyUsage(key.record.id,at)));assert.equal((await lib.listApiKeys(row.ws)).find(item=>item.id===key.record.id)?.lastUsedAt,times.at(-1));await usage.flushApiKeyUsage();assert.equal((db.prepare("SELECT last_used_at AS at FROM api_keys WHERE id=?").get(key.record.id) as {at:string}).at,times.at(-1));
 const later="2026-11-06T23:59:59.000Z";const child=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`const u=await import('./src/lib/api-key-usage.ts');await u.recordApiKeyUsage(${JSON.stringify(key.record.id)},${JSON.stringify(later)});process.exit(0);`],{cwd:process.cwd(),env:process.env,encoding:"utf8"});assert.equal(child.status,0,child.stderr);assert.equal((await lib.listApiKeys(row.ws)).find(item=>item.id===key.record.id)?.lastUsedAt,later);await usage.flushApiKeyUsage();assert.equal((db.prepare("SELECT last_used_at AS at FROM api_keys WHERE id=?").get(key.record.id) as {at:string}).at,later);await lib.revokeApiKey(row.ws,key.record.id,row.user);assert.equal(await lib.verifyApiKey(key.key),null);
 console.log("check-performance-api-usage: pass (200 durable uses, exact settings timestamp, orphan-process replay, introspection purity, immediate revocation)");}
main().catch(error=>{console.error(error);process.exit(1);});
