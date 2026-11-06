import * as Y from "yjs";
export type CacheInfo={key:string;bytes:number;updates:number;synced:boolean;updatedAt:string|null};
export type CacheMetadata={synced:boolean;updatedAt:string};
export function openCacheDatabase(key:string):Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 let finished=false;const timeout=setTimeout(()=>{finished=true;reject(new Error("Document cache did not open. Close other document tabs and retry."));},4000);
 const request=indexedDB.open(key,2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("updates"))request.result.createObjectStore("updates",{autoIncrement:true});if(!request.result.objectStoreNames.contains("meta"))request.result.createObjectStore("meta");};request.onsuccess=()=>{clearTimeout(timeout);if(finished){request.result.close();return;}finished=true;request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>{clearTimeout(timeout);finished=true;reject(request.error);};request.onblocked=()=>{clearTimeout(timeout);finished=true;reject(new Error("Close other document tabs and retry."));};
});}
async function inspect(key:string):Promise<CacheInfo>{const db=await openCacheDatabase(key);try{return await new Promise((resolve,reject)=>{
 const transaction=db.transaction(["updates","meta"],"readonly");let bytes=0,updates=0,metadata:CacheMetadata|undefined;
 const cursor=transaction.objectStore("updates").openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){bytes+=row.value.byteLength;updates++;row.continue();}};
 const meta=transaction.objectStore("meta").get("state");meta.onsuccess=()=>{metadata=meta.result;};transaction.oncomplete=()=>resolve({key,bytes,updates,synced:metadata?.synced===true,updatedAt:metadata?.updatedAt??null});transaction.onabort=transaction.onerror=()=>reject(transaction.error);
 });}finally{db.close();}}
export async function listCollabCaches(scope:string){const prefix=`tacos.collab.v1.${scope}.`,keys=new Set<string>();
 if(indexedDB.databases)for(const db of await indexedDB.databases())if(db.name?.startsWith(prefix))keys.add(db.name);
 for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))keys.add(key);}
 const rows:CacheInfo[]=[];for(const key of keys)rows.push(await inspect(key));return rows;
}
export async function exportCollabCache(key:string){const db=await openCacheDatabase(key);try{const updates=await new Promise<Uint8Array[]>((resolve,reject)=>{const request=db.transaction("updates","readonly").objectStore("updates").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const doc=new Y.Doc();try{for(const update of updates)Y.applyUpdate(doc,update);return new Blob([Y.encodeStateAsUpdate(doc) as BlobPart],{type:"application/octet-stream"});}finally{doc.destroy();}}finally{db.close();}}
/** The exclusive lock fails immediately while any tab is editing this cache. */
export async function clearSyncedCollabCache(key:string){
 if(!navigator.locks)throw new Error("This browser cannot safely check open document tabs. Export the cache instead.");
 await navigator.locks.request(key,{mode:"exclusive",ifAvailable:true},async lock=>{
  if(!lock)throw new Error("Close this document in every tab, then retry.");
  const db=await openCacheDatabase(key);try{await new Promise<void>((resolve,reject)=>{
   const transaction=db.transaction(["updates","meta"],"readwrite"),request=transaction.objectStore("meta").get("state");let unsafe=false;
   request.onsuccess=()=>{if(request.result?.synced!==true){unsafe=true;transaction.abort();return;}transaction.objectStore("updates").clear();};
   transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(unsafe?new Error("Unsynced document edits are protected. Reconnect and sync first."):transaction.error);
  });}finally{db.close();}
 });
}
