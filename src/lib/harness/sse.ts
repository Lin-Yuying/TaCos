import type { ApprovalDecision, TurnEvent } from "./types";
const ENCODER = new TextEncoder();
function browserDecision(decision: ApprovalDecision): "accept" | "decline" | "accept-turn" {
  return decision === "allow" ? "accept" : decision === "allow_turn" ? "accept-turn" : "decline";
}
/** Pull one event at a time: a slow reader stops pulling the upstream iterator. */
export function turnEventsToSse(events: AsyncIterable<TurnEvent>): ReadableStream<Uint8Array> {
  const iterator=events[Symbol.asyncIterator]();let stopped=false;
  const frame=(payload:unknown)=>`data: ${JSON.stringify(payload)}\n\n`;
  return new ReadableStream<Uint8Array>({
    async pull(controller){
      if(stopped)return;
      try {
        const next=await iterator.next();if(stopped)return;
        const event=next.value;
        let chunk:string;
        if(next.done || event.type==="done")chunk="data: [DONE]\n\n";
        else if(event.type==="error")chunk=frame({error:{message:event.message}});
        else if(event.type==="delta")chunk=frame({choices:[{delta:{content:event.text}}]});
        else if(event.type==="step")chunk=frame({tacos:{type:"step",step:{key:event.id,kind:event.kind??"info",title:event.title,detail:event.detail,status:event.status}}});
        else if(event.type==="approval")chunk=frame({tacos:{type:"approval",request:{requestId:event.requestId,tool:event.tool,message:event.message,description:event.description??null,params:event.params==null?null:typeof event.params==="string"?event.params:JSON.stringify(event.params,null,2)}}});
        else chunk=frame({tacos:{type:"approval_done",requestId:event.requestId,decision:browserDecision(event.decision)}});
        controller.enqueue(ENCODER.encode(chunk));
        if(next.done || event.type==="done" || event.type==="error") {stopped=true;controller.close();await iterator.return?.();}
      }catch(error){if(!stopped){stopped=true;controller.enqueue(ENCODER.encode(frame({error:{message:error instanceof Error?error.message:"The harness turn failed."}})));controller.close();await iterator.return?.();}}
    },
    async cancel(){stopped=true;await iterator.return?.();},
  },{highWaterMark:64*1024,size:chunk=>chunk.byteLength});
}
