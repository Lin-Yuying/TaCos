import * as Y from "yjs";

/** Keep Yjs updates, rather than Markdown snapshots, so offline edits can merge. */
export async function openCollabCache(key: string, doc: Y.Doc, onError: () => void): Promise<() => void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(key, 1);
    let ended = false;
    const timeout = setTimeout(() => { ended = true; reject(new Error("Local document storage is unavailable")); }, 4000);
    request.onupgradeneeded = () => request.result.createObjectStore("updates", { autoIncrement: true });
    request.onsuccess = () => { clearTimeout(timeout); if (ended) request.result.close(); else resolve(request.result); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); ended = true; reject(new Error("Local document storage is blocked")); };
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("updates", "readonly");
      const read = transaction.objectStore("updates").getAll();
      read.onsuccess = () => { for (const update of read.result) Y.applyUpdate(doc, update, "local-cache"); };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const store = (_update?: Uint8Array, origin?: unknown) => {
    if (closed || origin === "local-cache") return;
    try {
      const transaction = db.transaction("updates", "readwrite");
      const updates = transaction.objectStore("updates");
      const read = updates.getAll();
      read.onsuccess = () => {
        for (const update of read.result) Y.applyUpdate(doc, update, "local-cache");
        updates.clear();
        updates.add(Y.encodeStateAsUpdate(doc));
      };
      transaction.onerror = onError;
      transaction.onabort = onError;
    } catch { onError(); }
  };
  doc.on("update", store);
  store();
  db.onversionchange = () => { closed = true; db.close(); onError(); };
  return () => { closed = true; doc.off("update", store); db.close(); };
}
