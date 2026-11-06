"use client";
import { useEffect, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { openCollabCache } from "@/lib/ui/collab-cache";
import * as Y from "yjs";
import { getCollabSessionAction } from "@/app/pages-actions";
import { useUI } from "@/components/ui-context";
export type CollabPeer = { clientId:number;name:string;color:string };
export type DocCollab = {status:"connecting"|"off";error?:string} | {status:"live"|"reconnecting";doc:Y.Doc;provider:HocuspocusProvider;user:{name:string;color:string};peers:CollabPeer[];pending:number;storageError?:string};
function socketUrl(){const scheme=location.protocol==="https:"?"wss":"ws";return `${scheme}://${location.hostname}:${Number(location.port||(scheme==="wss"?443:80))+1}`;}
export function useDocCollab(workspaceId:string,pageId:string):DocCollab {
  const {scope}=useUI();const [state,setState]=useState<DocCollab>({status:"connecting"});
  useEffect(()=>{
    let closed=false;let provider:HocuspocusProvider|null=null;let closeCache:(()=>void)|null=null;let doc:Y.Doc|null=null;
    const cacheKey=`tacos.collab.v1.${scope}.${pageId}`;
    void (async()=>{
      const result=await getCollabSessionAction(workspaceId,pageId).catch(()=>null);
      if(closed)return;
      let session=result?.ok?result.data:null;
      if(result?.ok&&!session){setState({status:"off"});return;}
      if(!session){try{session=JSON.parse(localStorage.getItem(cacheKey)??"null");}catch{session=null;}}
      if(!session){setState({status:"connecting",error:"Could not connect to collaboration. Retry."});return;}
      const {token,user}=session;
      try{localStorage.setItem(cacheKey,JSON.stringify(session));}catch{/* IndexedDB holds document updates. */}
      const currentDoc=new Y.Doc();doc=currentDoc;
      let storageError: string | undefined;
      const failed = () => { storageError = "Local storage is unavailable. Keep this page open until connected."; if (!closed) setState((previous) => ({...previous, storageError})); };
      try { closeCache = await openCollabCache(cacheKey,currentDoc,failed); } catch { failed(); }
      if(closed){closeCache?.();currentDoc.destroy();return;}
      const current=new HocuspocusProvider({url:socketUrl(),name:pageId,document:currentDoc,token:async()=>{
        const next=await getCollabSessionAction(workspaceId,pageId);
        return next.ok&&next.data?next.data.token:token;
      }});provider=current;
      let synced=false, connected=false;
      const show=()=>{
        if(closed)return;
        const peers:CollabPeer[]=[...(current.awareness?.getStates().entries()??[])].flatMap(([clientId,value])=>{
          const peer=(value as {user?:{name?:string;color?:string}}).user;
          return clientId!==current.awareness?.clientID&&peer?.name?[{clientId,name:peer.name,color:peer.color??"#888"}]:[];
        });
        if(!synced&&currentDoc.getXmlFragment("default").length===0)return;
        setState({status:synced&&connected?"live":"reconnecting",doc:currentDoc,provider:current,user,peers,pending:current.unsyncedChanges,storageError});
      };
      current.on("synced",()=>{synced=true;show();});current.on("status",({status}:{status:string})=>{connected=status==="connected";show();});current.on("awarenessChange",show);current.on("unsyncedChanges",show);
      current.on("authenticationFailed",()=>{if(!closed)setState({status:"connecting",error:"Collaboration access expired. Reload to sign in again."});});
      show();
    })().catch(()=>{if(!closed)setState({status:"connecting",error:"Could not connect to collaboration. Retry."});});
    return()=>{closed=true;provider?.destroy();closeCache?.();doc?.destroy();};
  },[workspaceId,pageId,scope]);return state;
}
