import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
process.env.TACOS_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"tacos-cleanup-perf-"));
async function main(){
 const {getDb}=await import("../src/db/client"),db=getDb().$client;const cleanup=await import("../src/lib/permanent-cleanup"),pages=await import("../src/lib/pages"),lib=await import("../src/lib/issues");
 const p=db.prepare("SELECT p.id,p.workspace_id AS ws,w.created_by AS user FROM projects p JOIN workspaces w ON w.id=p.workspace_id LIMIT 1").get() as {id:string;ws:string;user:string};
 const insert=db.prepare("INSERT INTO pages(id,workspace_id,parent_id,project_id,title,doc,created_by,created_at,updated_at,deleted_at,trash_root) VALUES(?,?,?,?,?,'',?,'2026-01-01','2026-01-01','2026-01-01','cleanup-root')");
 db.transaction(()=>{insert.run("cleanup-root",p.ws,null,p.id,"Root",p.user);for(let i=0;i<115;i++)insert.run(`cleanup-child-${i}`,p.ws,"cleanup-root",p.id,`Child ${i}`,p.user);})();
 db.exec("CREATE TRIGGER inject_cleanup_failure BEFORE DELETE ON pages WHEN (SELECT completed FROM maintenance_jobs WHERE id='page:cleanup-root')>=100 BEGIN SELECT RAISE(ABORT,'fixture interrupted'); END");
 await assert.rejects(()=>cleanup.purgePageRecords(p.ws,"cleanup-root"),/fixture interrupted/);assert(db.prepare("SELECT id FROM pages WHERE id='cleanup-root'").get());await assert.rejects(()=>pages.restorePage(p.ws,"cleanup-root",p.user),/Permanent deletion/);
 db.exec("DROP TRIGGER inject_cleanup_failure");
 const resumed=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`const m=await import('./src/lib/permanent-cleanup.ts');await m.purgePageRecords(${JSON.stringify(p.ws)},'cleanup-root');`],{cwd:process.cwd(),env:process.env,encoding:"utf8"});assert.equal(resumed.status,0,resumed.stderr);assert.equal((db.prepare("SELECT count(*) AS n FROM pages WHERE trash_root='cleanup-root'").get() as {n:number}).n,0);
 // A second writer adds a reference between committed deletion batches.
 db.transaction(()=>{insert.run("cleanup-root",p.ws,null,p.id,"Root",p.user);for(let i=0;i<115;i++)insert.run(`cleanup-child-${i}`,p.ws,"cleanup-root",p.id,`Child ${i}`,p.user);})();
 db.prepare("INSERT INTO pages(id,workspace_id,title,doc,created_by,created_at,updated_at) VALUES('concurrent-reference',?,'Survivor','',?,'a','a')").run(p.ws,p.user);
 db.prepare("INSERT INTO attachments(id,workspace_id,page_id,uploader_id,name,size,complete,created_at) VALUES('concurrent-attachment',?,'cleanup-child-114',?,'image.png',12,1,'a')").run(p.ws,p.user);
 db.prepare("DELETE FROM maintenance_jobs WHERE id='page:cleanup-root'").run();
 const changed=new Promise<void>(resolve=>{const tick=()=>{const job=db.prepare("SELECT completed FROM maintenance_jobs WHERE id='page:cleanup-root'").get() as {completed:number}|undefined;if((job?.completed??0)>=100){db.prepare("UPDATE pages SET doc='![image](/api/files/concurrent-attachment)' WHERE id='concurrent-reference'").run();resolve();}else setImmediate(tick);};setImmediate(tick);});
 await cleanup.purgePageRecords(p.ws,"cleanup-root");await changed;
 assert.equal((db.prepare("SELECT page_id AS id FROM attachments WHERE id='concurrent-attachment'").get() as {id:string}).id,"retained:cleanup-child-114");
 db.prepare("INSERT INTO maintenance_jobs(id,owner,lease_until,state,completed,updated_at) VALUES(?, 'other-process',?,'running',0,'fixture')").run(`project:${p.id}`,Date.now()+30000);await assert.rejects(()=>cleanup.purgeProjectRecords(p.ws,p.id),/already running/);db.prepare("DELETE FROM maintenance_jobs WHERE id=?").run(`project:${p.id}`);
 // A document attached to a project remains a workspace record when the project is purged.
 await pages.createPage(p.ws,p.user,{title:"Independent document",projectId:p.id});await lib.trashProject(p.ws,p.id,p.user);await cleanup.purgeProjectRecords(p.ws,p.id);const kept=db.prepare("SELECT project_id FROM pages WHERE title='Independent document'").get() as {project_id:string|null};assert.equal(kept.project_id,null);
 const ws="expired-fixture";db.prepare("INSERT INTO workspaces(id,name,key,created_by,created_at,deleted_at) VALUES(?,'Expired','EX',?,'2026-01-01',?)").run(ws,p.user,new Date(Date.now()-31*86400000).toISOString());db.prepare("INSERT INTO pages(id,workspace_id,title,created_by,created_at,updated_at) VALUES('expired-page',?,'Expired',?,'a','a')").run(ws,p.user);await cleanup.purgeWorkspaceRecords(ws);assert(!db.prepare("SELECT id FROM workspaces WHERE id=?").get(ws));assert(db.prepare("SELECT id FROM workspaces WHERE id=?").get(p.ws));assert(db.prepare("SELECT id FROM users WHERE id=?").get(p.user));
 console.log("check-performance-cleanup: pass (failed batch root retained, fresh-process resume, restore rejection, leases, ownership, 30-day boundary)");
}main().catch(error=>{console.error(error);process.exit(1);});
