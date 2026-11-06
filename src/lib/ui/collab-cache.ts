import * as Y from "yjs";

import { openCacheDatabase } from "./collab-cache-management";
export type CollabCacheHandle=(()=>void)&{markSynced:()=>void};
/** Keep Yjs updates, rather than Markdown snapshots, so offline edits can merge. */
export async function openCollabCache(key:string,doc:Y.Doc,onError:()=>void):Promise<CollabCacheHandle>{
 let release=()=>{};
 if(navigator.locks)await new Promise<void>((resolve,reject)=>{void navigator.locks.request(key,{mode:"shared"},()=>new Promise<void>(finish=>{release=finish;resolve();})).catch(reject);});
 let db:IDBDatabase;try{db=await openCacheDatabase(key);}catch(error){release();throw error;}
  let count=0,bytes=0,marked=false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("updates", "readonly");
      const read = transaction.objectStore("updates").getAll();
      read.onsuccess = () => { count=read.result.length;for (const update of read.result){bytes+=update.byteLength;Y.applyUpdate(doc, update, "local-cache");} };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) { db.close();release(); throw error; }
  let closed = false;
  const store = (update: Uint8Array, origin?: unknown) => {
    if (closed || origin === "local-cache") return;
    try {
      const transaction = db.transaction(["updates","meta"], "readwrite");
      const updates = transaction.objectStore("updates");
      updates.add(update);marked=false;
      transaction.objectStore("meta").put({synced:false,updatedAt:new Date().toISOString()},"state");
      count++; bytes += update.byteLength;
      if (count >= 128 || bytes >= 1024 * 1024) {
        // Read and compact inside the same transaction: another tab's committed
        // updates cannot be overwritten by this tab's older live document.
        const read = updates.getAll();
        read.onsuccess = () => {
          const merged=new Y.Doc();for(const update of read.result)Y.applyUpdate(merged,update);
          const checkpoint = Y.encodeStateAsUpdate(merged);merged.destroy();
          updates.clear(); updates.add(checkpoint);
          Y.applyUpdate(doc, checkpoint, "local-cache");
        };
        count = 0; bytes = 0;
      }
      transaction.onerror = onError;
      transaction.onabort = onError;
    } catch { onError(); }
  };
  doc.on("update", store);
  store(Y.encodeStateAsUpdate(doc));
  db.onversionchange = () => { closed = true; db.close();release(); onError(); };
  const close=()=>{closed=true;doc.off("update",store);db.close();release();};
  close.markSynced=()=>{if(closed||marked)return;marked=true;
   // A provider acknowledgement covers this tab's document. Prove that it also
   // covers every update persisted by other tabs before calling the cache synced.
   const acknowledged=Y.encodeStateAsUpdate(doc);
   try{const transaction=db.transaction(["updates","meta"],"readwrite"),read=transaction.objectStore("updates").getAll();
    read.onsuccess=()=>{const merged=new Y.Doc({gc:false});try{Y.applyUpdate(merged,acknowledged);const before=Y.encodeStateAsUpdate(merged);for(const update of read.result)Y.applyUpdate(merged,update);const after=Y.encodeStateAsUpdate(merged),synced=before.length===after.length&&before.every((byte,index)=>byte===after[index]);if(!synced)marked=false;transaction.objectStore("meta").put({synced,updatedAt:new Date().toISOString()},"state");}finally{merged.destroy();}};
    transaction.onerror=transaction.onabort=()=>{marked=false;onError();};
   }catch{marked=false;onError();}
  };
  return close;
}
