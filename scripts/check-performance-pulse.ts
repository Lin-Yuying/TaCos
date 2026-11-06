import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-pulse-"));
async function main() {
  const { getDb } = await import("../src/db/client");
  const { workspacePulse } = await import("../src/lib/issues");
  getDb();
  const other = new Database(path.join(process.env.TACOS_DATA_DIR!, "tacos.db"));
  const row = other.prepare("SELECT id,workspace_id FROM issues LIMIT 1").get() as {id:string;workspace_id:string};
  const before = await workspacePulse(row.workspace_id,"one");
  assert.equal(await workspacePulse(row.workspace_id,"one"),before);
  other.prepare("UPDATE issues SET title=title||' updated' WHERE id=?").run(row.id);
  assert.notEqual(await workspacePulse(row.workspace_id,"one"),before);
  const stable = await workspacePulse(row.workspace_id,"two");
  other.prepare("INSERT INTO notifications(id,workspace_id,user_id,issue_id,type,body,created_at) VALUES('n',?,'one',?,'assigned','test','now')").run(row.workspace_id,row.id);
  assert.equal(await workspacePulse(row.workspace_id,"two"),stable);
  const plan = other.prepare("EXPLAIN QUERY PLAN SELECT domain,revision FROM workspace_revisions WHERE workspace_id IN (?,?)").all(row.workspace_id,'@user:one') as {detail:string}[];
  assert(plan.some(p=>p.detail.includes("PRIMARY KEY")));
  assert(other.prepare("SELECT count(*) n FROM workspace_revisions").get());
  other.close();
  console.log("check-performance-pulse: pass (indexed reads, cross-connection updates, user isolation)");
}
main().catch(e=>{console.error(e);process.exit(1);});
