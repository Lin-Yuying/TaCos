import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-queries-"));
async function main() {
 const lib=await import("../src/lib/issues");
 const {getDb}=await import("../src/db/client");getDb();
 const db=new Database(path.join(process.env.TACOS_DATA_DIR!,"tacos.db"));
 const project=db.prepare("SELECT id,workspace_id,name,key FROM projects LIMIT 1").get() as {id:string;workspace_id:string;name:string;key:string};
 const statuses=["in_progress","todo","done","canceled"];
 const insert=db.prepare("INSERT INTO issues(id,workspace_id,project_id,number,identifier,title,status,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
 db.transaction(()=>{for(let i=0;i<1000;i++)insert.run('query-'+i,project.workspace_id,project.id,1000+i,'QUERY-'+i,'Query '+i,statuses[i%4],i%7,'2026-01-01','2026-01-01');})();
 const ws=project.workspace_id;
 const all=await lib.listIssues(ws);
 const expected=all.map(x=>x.id);
 assert.equal((await lib.findIssueRow(ws,'query-10'))?.identifier,'QUERY-10');
 assert.equal((await lib.findIssueRow(ws,'QuErY-11'))?.id,'query-11');
 assert.equal((await lib.findIssueRow(ws,project.name+'-1010'))?.id,'query-10');
 const found:string[]=[];let cursor:string|undefined;
 do{const page=await lib.listIssuesPage(ws,{limit:73,cursor});assert.equal(page.total,all.length);found.push(...page.items.map(x=>x.id));cursor=page.nextCursor??undefined;}while(cursor);
 assert.deepEqual(found,expected);assert.equal(new Set(found).size,found.length);
 for(const [query,args,index] of [
  ['SELECT MAX(number) FROM issues WHERE project_id=?',[project.id],'issues_project_number_idx'],
  ['SELECT MAX(position) FROM issues WHERE workspace_id=?',[ws],'issues_workspace_position_idx'],
 ] as const){const plans=db.prepare('EXPLAIN QUERY PLAN '+query).all(...args) as {detail:string}[];assert(plans.some(p=>p.detail.includes(index)));console.log(plans.map(p=>p.detail).join('; '));}
 db.close();console.log('check-performance-queries: pass (1000 tasks, stable full pagination, indexed maxima)');
}
main().catch(e=>{console.error(e);process.exit(1);});
