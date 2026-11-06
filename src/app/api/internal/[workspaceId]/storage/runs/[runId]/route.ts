import { requireWorkspace } from "@/lib/auth";
import { getDb } from "@/db/client";
import { readRunPayload } from "@/lib/runner/hub";
import { unpackText } from "@/lib/compressed-text";
export async function GET(_request:Request,{params}:{params:Promise<{workspaceId:string;runId:string}>}){
 try{const {workspaceId,runId}=await params,{user}=await requireWorkspace(workspaceId),db=getDb().$client;
  const run=db.prepare("SELECT id,status,error,created_at,finished_at FROM agent_runs WHERE id=? AND user_id=? AND workspace_id=?").get(runId,user.id,workspaceId);
  if(!run)return Response.json({error:"Run not found"},{status:404});
  const payload=await readRunPayload(user.id,runId);
  async function* chunks(){yield JSON.stringify({run,payload}).slice(0,-1)+',"batches":[';let sequence=-1,first=true;
   while(true){const batch=db.prepare("SELECT sequence,body,body_compressed,accepted FROM runner_event_batches WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 1").get(runId,sequence) as {sequence:number;body:string;body_compressed:string|null;accepted:number}|undefined;if(!batch)break;
    yield (first?"":",")+JSON.stringify({sequence:batch.sequence,accepted:Boolean(batch.accepted),events:JSON.parse(await unpackText(batch.body,batch.body_compressed))});first=false;sequence=batch.sequence;
   }yield "]}";
  }
  const iterator=chunks(),encoder=new TextEncoder();return new Response(new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));}catch(error){controller.error(error);}},async cancel(){await iterator.return();}}),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="run-${runId}.json"`,"Cache-Control":"no-store"}});
 }catch{return Response.json({error:"Archive is not available"},{status:403});}
}
