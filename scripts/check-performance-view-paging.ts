import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.TACOS_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),"tacos-view-pages-"));
async function main(){
 const {getDb}=await import("../src/db/client");const db=getDb().$client;
 const {queryTaskView}=await import("../src/lib/task-query");const {applyView,EMPTY_VIEW}=await import("../src/lib/task-view");
 const row=db.prepare("SELECT p.id,p.workspace_id AS ws,w.created_by AS user FROM projects p JOIN workspaces w ON w.id=p.workspace_id LIMIT 1").get() as {id:string;ws:string;user:string};
 const insert=db.prepare("INSERT INTO issues(id,workspace_id,project_id,number,identifier,title,description,status,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'todo',?,?,?)");
 db.transaction(()=>{for(let i=0;i<1025;i++)insert.run(`paging-${i}`,row.ws,row.id,10000+i,`PG-${i}`,`中文 ${i}`,`Full body ${i}`,i%7,"2026-01-01","2026-01-01");})();
 const query={projectId:row.id},full=await queryTaskView(row.ws,row.user,query,EMPTY_VIEW,0,undefined,true);
 const ids:string[]=[];for(let page=0;page*100<full.total;page++){const result=await queryTaskView(row.ws,row.user,query,EMPTY_VIEW,page,full.revision);assert(result.items.length<=100);assert(result.items.every(item=>item.description===""));ids.push(...result.items.map(item=>item.id));}
 assert.deepEqual(ids,full.items.map(item=>item.id));assert.equal(new Set(ids).size,ids.length);
 const view={filters:[{key:"title",op:"contains" as const,value:"中文"}],sort:[{key:"title",dir:"desc" as const}]};
 const sorted=await queryTaskView(row.ws,row.user,query,view,0,undefined,true,true);
 assert.deepEqual(sorted.items.map(item=>item.id),applyView(full.items,view,full.fields,full.values).map(item=>item.id));assert(sorted.items.every(item=>item.description.startsWith("Full body")));
 db.prepare("UPDATE issues SET title='changed' WHERE id='paging-0'").run();await assert.rejects(()=>queryTaskView(row.ws,row.user,query,EMPTY_VIEW,1,full.revision),/Tasks changed/);
 const field=db.prepare("INSERT INTO task_fields(id,workspace_id,name,type,created_by,created_at) VALUES('points',?,'Points','number',?,?)");field.run(row.ws,row.user,"2026-01-01");db.prepare("INSERT INTO task_field_values VALUES('paging-5','points','200')").run();
 const custom=await queryTaskView(row.ws,row.user,query,{filters:[{key:"field:points",op:"gt",value:"100"}],sort:[]});assert.deepEqual(custom.items.map(item=>item.id),["paging-5"]);
 db.prepare("UPDATE workspaces SET members_see_all_tasks=0 WHERE id=?").run(row.ws);const outsider=db.prepare("SELECT id FROM users WHERE id<>? LIMIT 1").get(row.user) as {id:string};db.prepare("DELETE FROM project_members WHERE project_id=? AND user_id=?").run(row.id,outsider.id);const hidden=await queryTaskView(row.ws,outsider.id,query);assert(!hidden.items.some(item=>item.id.startsWith("paging-")));
 console.log("check-performance-view-paging: pass (1025 tasks, complete pages/export, locale/custom filters, revision and permission checks)");
}main().catch(error=>{console.error(error);process.exit(1);});
